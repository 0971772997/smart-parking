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
//
// LUONG CHINH (tu v15): MA QR CUA CONG - admin hien ma tren man hinh dat tai cong, TAI XE quet bang app
//   SPG1.<id bai base64url>.<E|X>.<het han epoch base36>.<nonce>.<chu ky>
//   - Tu doi moi RULES.gate.gateQrTtlSeconds -> anh chup ma cu khong dung de "mo cong tu xa" duoc.
//   - Tai xe quet -> POST /api/gates/checkin { token } -> may chu tim dat cho cua tai xe o bai do,
//     kiem tra nhu khi nhan vien quet -> mo barie.
const crypto = require('crypto');
const { RULES } = require('./booking');
const { sessionFee, holdFeeOf, startGateSession, closeSession, notify, vnd } = require('./sessions');

const VERSION = 'SP1';
const GATE_VERSION = 'SPG1'; // ma QR cua CONG (admin hien tai cong, tai xe quet) - xem issueGate
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

  // Ma QR hien tai cong (cho tai xe quet). Chu ky co tien to rieng -> khong doi lan voi ma dat cho.
  const gsig = (body) => sig(`gate|${body}`);
  // gate: 'any' (mac dinh - 1 ma chung cho ca vao va ra, may chu tu chon cong) | 'entry' | 'exit'
  function issueGate(lotId, gate = 'any', ttlSeconds = RULES.gate.gateQrTtlSeconds) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = crypto.randomBytes(6).toString('base64url');
    const lot64 = Buffer.from(String(lotId)).toString('base64url');
    const body = [GATE_VERSION, lot64, gate === 'any' ? 'G' : GATE_CODE[gate], exp.toString(36), nonce].join('.');
    return { token: `${body}.${gsig(body)}`, lotId, gate, nonce, expiresAt: new Date(exp * 1000), ttlSeconds };
  }

  // -> { ok: true, lotId, gate, nonce, expiresAt } | { ok: false, error: 'qr_invalid' | 'qr_expired', ... }
  function verifyGate(raw) {
    const parts = String(raw || '').trim().split('.');
    if (parts.length !== 6 || parts[0] !== GATE_VERSION) return { ok: false, error: 'qr_invalid' };
    const [, lot64, g, expS, nonce, s] = parts;
    const expected = Buffer.from(gsig(parts.slice(0, 5).join('.')));
    const got = Buffer.from(s);
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return { ok: false, error: 'qr_invalid' };
    const lotId = Buffer.from(lot64, 'base64url').toString('utf8');
    const exp = parseInt(expS, 36);
    // G = ma chung -> gate null: may chu tu chon cong vao / ra theo dat cho cua tai xe
    const gate = g === 'G' ? null : CODE_GATE[g];
    if ((g !== 'G' && !gate) || !lotId || !Number.isSafeInteger(exp)) return { ok: false, error: 'qr_invalid' };
    const base = { lotId, gate, nonce, expiresAt: new Date(exp * 1000) };
    // Du phong 10s: man hinh cong vua doi ma dung luc tai xe dang quet
    if (exp + 10 < Date.now() / 1000) return { ok: false, error: 'qr_expired', ...base };
    return { ok: true, ...base };
  }

  return { issue, verify, issueGate, verifyGate };
}

// Luot do gan nhat cua dat cho (kem thanh toan) -> de kiem tra cong ra
async function lastSession(db, reservationId) {
  return db.one(
    `SELECT ps.*, p.id AS payment_id, COALESCE(ps.hourly_rate, l.price_per_hour) AS price_per_hour,
            COALESCE(r.hold_fee, 0) AS resv_hold_fee, COALESCE(r.extend_count, 0) AS hold_extensions
     FROM parking_sessions ps LEFT JOIN payments p ON p.session_id = ps.id
     JOIN slots s ON s.id = ps.slot_id JOIN parking_lots l ON l.id = s.lot_id
     LEFT JOIN reservations r ON r.id = ps.reservation_id
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

// Dieu kien phi o cong ra: xe phai da roi o (phien da chot phi) va da thanh toan
//   - Vao bai nhung chua do o nao: mien phi neu ra trong RULES.session.noParkGraceMinutes, qua thi tinh phi tu luc vao
//   -> null | { error: 'still_parked' | 'payment_required', sessionId, fee }
async function exitBlock(db, reservationId) {
  const s = await lastSession(db, reservationId);
  if (!s || s.payment_id) return null;
  if (!s.ended_at) {
    if (s.parked_at) return { error: 'still_parked', sessionId: s.id, fee: null };
    const fee = sessionFee({ startedAt: s.started_at, pricePerHour: s.price_per_hour, plannedEndAt: s.planned_end_at,
      parked: false, holdFee: holdFeeOf(s) });
    return fee.total > 0 ? { error: 'payment_required', sessionId: s.id, fee: fee.total } : null;
  }
  if ((s.fee || 0) > 0) return { error: 'payment_required', sessionId: s.id, fee: s.fee };
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
  if (scan.gate === 'entry') {
    scan.session = await startGateSession(db, scan.reservation_id); // bat dau phien gui xe
  } else {
    // Ket thuc phien gui xe: chot phi neu chua (vao bai roi ra luon), ghi luc ra cong
    const s = await db.one(
      'SELECT id, ended_at FROM parking_sessions WHERE reservation_id = $1 AND exited_at IS NULL', [scan.reservation_id]);
    if (s) {
      if (!s.ended_at) await closeSession(db, s.id);
      const done = await db.one(
        `UPDATE parking_sessions SET exited_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [s.id]);
      await notify(db, { userId: done.user_id, sessionId: done.id, reservationId: scan.reservation_id, type: 'exited',
        key: `s${done.id}:exit`, title: 'Kết thúc phiên gửi xe',
        body: `Xe đã ra bãi. Tổng phí ${vnd(done.fee)}. Cảm ơn bạn đã sử dụng SmartPark!`, data: { fee: done.fee } });
      scan.session = done;
    }
  }
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
