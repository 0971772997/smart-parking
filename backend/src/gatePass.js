// MA QR QUA CONG (vao / ra bai) cho luot dat cho
//
// Noi dung QR:  SP1.<id dat cho base36>.<E|X>.<het han epoch base36>.<nonce>.<chu ky>
//   E = cong vao (entry), X = cong ra (exit). Chu ky = HMAC-SHA256 (cat 16 ky tu base64url = 96 bit).
//   - Ngan han (RULES.gate.qrTtlSeconds): app tu xin ma moi truoc khi het han -> anh chup man hinh cu vo dung.
//   - Khong chua thong tin ca nhan; may chu tra cuu dat cho bang id roi kiem tra lai moi dieu kien.
//   - Moi dat cho chi duoc VAO 1 lan va RA 1 lan (unique index uq_gate_scan_once) -> chong dung lai ma.
//
// Luong: tai xe mo app -> GET /api/reservations/:id/pass -> hien QR
//        nhan vien quet -> POST /api/gates/scan -> kiem tra -> lenh open_gate toi ESP32 -> ack ok = xac nhan
const crypto = require('crypto');
const { RULES } = require('./booking');

const VERSION = 'SP1';
const GATE_CODE = { entry: 'E', exit: 'X' };
const CODE_GATE = { E: 'entry', X: 'exit' };

function createGatePass(secret) {
  // Khoa rieng cho QR (khong dung truc tiep khoa JWT)
  const key = crypto.createHmac('sha256', String(secret)).update('gate-pass-v1').digest();
  const sig = (body) => crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, 16);

  function issue(reservationId, gate, ttlSeconds = RULES.gate.qrTtlSeconds) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = crypto.randomBytes(6).toString('base64url'); // 8 ky tu
    const body = [VERSION, reservationId.toString(36), GATE_CODE[gate], exp.toString(36), nonce].join('.');
    return { token: `${body}.${sig(body)}`, gate, nonce, expiresAt: new Date(exp * 1000), ttlSeconds };
  }

  // -> { ok: true, reservationId, gate, nonce, expiresAt } | { ok: false, error: 'qr_invalid' | 'qr_expired', ... }
  function verify(raw) {
    const token = String(raw || '').trim();
    const parts = token.split('.');
    if (parts.length !== 6 || parts[0] !== VERSION) return { ok: false, error: 'qr_invalid' };
    const [, rid, g, expS, nonce, s] = parts;
    const body = parts.slice(0, 5).join('.');
    const expected = Buffer.from(sig(body));
    const got = Buffer.from(s);
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return { ok: false, error: 'qr_invalid' };
    const reservationId = parseInt(rid, 36);
    const exp = parseInt(expS, 36);
    const gate = CODE_GATE[g];
    if (!gate || !Number.isSafeInteger(reservationId) || !Number.isSafeInteger(exp)) return { ok: false, error: 'qr_invalid' };
    const base = { reservationId, gate, nonce, expiresAt: new Date(exp * 1000) };
    // Du phong 5s cho do tre khi quet
    if (exp + 5 < Date.now() / 1000) return { ok: false, error: 'qr_expired', ...base };
    return { ok: true, ...base };
  }

  return { issue, verify };
}

// Luot do gan nhat cua dat cho (kem thanh toan) -> de kiem tra cong ra
async function lastSession(db, reservationId) {
  return db.one(
    `SELECT ps.id, ps.ended_at, ps.fee, p.id AS payment_id
     FROM parking_sessions ps LEFT JOIN payments p ON p.session_id = ps.id
     WHERE ps.reservation_id = $1 ORDER BY ps.started_at DESC LIMIT 1`, [reservationId]);
}

// Cong tiep theo cua dat cho theo trang thai (khong can truy van) -> 'entry' | 'exit' | null
//   entry: dang giu cho (active, con gio), chua qua cong vao
//   exit : da qua cong vao hoac xe da vao o (fulfilled), chua ra, trong RULES.gate.exitWithinHours ke tu luc dat
function nextGate(r, now = Date.now()) {
  if (!r || r.exited_at) return null;
  if (r.status === 'active' && !r.entered_at && r.expires_at && new Date(r.expires_at) > now) return 'entry';
  const fresh = now - new Date(r.created_at).getTime() < RULES.gate.exitWithinHours * 3600 * 1000;
  if (fresh && (r.entered_at || r.status === 'fulfilled')) return 'exit';
  return null;
}

// Ly do khong qua duoc cong 'gate' (null = duoc phep, tru dieu kien phi o cong ra)
function gateBlock(r, gate) {
  const next = nextGate(r);
  if (next === gate) return null;
  if (r.exited_at) return 'already_exited';
  if (gate === 'entry') {
    if (r.entered_at || r.status === 'fulfilled') return 'already_entered';
    if (r.status === 'active') return 'reservation_expired';
    return 'reservation_not_active';
  }
  // gate === 'exit'
  if (r.status === 'active') return 'not_entered';
  if (r.status === 'fulfilled') return 'pass_expired';
  return 'reservation_not_active';
}

// Dieu kien phi o cong ra: xe phai da roi o (luot do da dong) va da thanh toan
//   -> null | { error: 'still_parked' | 'payment_required', sessionId, fee }
async function exitBlock(db, reservationId) {
  const s = await lastSession(db, reservationId);
  if (!s) return null; // vao bai nhung chua do o nao -> ra mien phi
  if (!s.ended_at) return { error: 'still_parked', sessionId: s.id, fee: null };
  if (!s.payment_id && (s.fee || 0) > 0) return { error: 'payment_required', sessionId: s.id, fee: s.fee };
  return null;
}

// Xac nhan barie DA MO (ack ok tu ESP32) cho 1 lan quet. Idempotent: goi tu route (ack dung han)
// va tu sync khi ack den tre (sau khi route da bao device_timeout). -> lan quet da xac nhan | null
async function confirmScan(db, requestId) {
  let scan;
  try {
    scan = await db.one(
      `UPDATE gate_scans SET result = 'granted', error = NULL, confirmed_at = COALESCE(confirmed_at, now())
       WHERE request_id = $1 AND (result = 'pending' OR (result = 'denied' AND error = 'device_timeout'))
       RETURNING *`, [requestId]);
  } catch (e) {
    if (e.code === '23505') return null; // da co lan quet khac duoc xac nhan cho cung cong
    throw e;
  }
  if (!scan || !scan.reservation_id) return scan;
  const col = scan.gate === 'entry' ? 'entered_at' : 'exited_at';
  await db.query(`UPDATE reservations SET ${col} = COALESCE(${col}, now()), updated_at = now() WHERE id = $1`,
    [scan.reservation_id]);
  if (scan.gate === 'exit') {
    // Qua cong vao nhung roi bai ma chua do -> tra o dang giu
    const r = await db.one(
      `UPDATE reservations SET status = 'cancelled', error = 'left_without_parking', updated_at = now()
       WHERE id = $1 AND status = 'active' RETURNING slot_id`, [scan.reservation_id]);
    if (r) {
      await db.query(`UPDATE slots SET state = 'free', updated_at = now() WHERE id = $1 AND state = 'reserved'`, [r.slot_id]);
      scan.releasedSlot = true;
    }
  }
  return scan;
}

module.exports = { createGatePass, nextGate, gateBlock, exitBlock, confirmScan };
