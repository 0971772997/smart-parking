// QUY TAC DAT CHO (giu cho / het han / xac nhan) - dung chung cho route va app (GET /api/reservations/rules)
//
// Vong doi 1 dat cho:
//   pending  --(ESP32 ack ok)-->  active (= DA XAC NHAN, o duoc giu, LED vang)
//   pending  --(ESP32 tu choi / khong phan hoi)-->  failed
//   active   --(xe vao dung o)-->  fulfilled  (mo luot do, tinh phi tu luc xe vao)
//   active   --(nguoi dung huy)-->  cancelled  (mien phi, khong tinh vi pham)
//   active   --(het gio giu cho ma xe chua den)-->  expired  (= "khong den", tinh 1 lan vi pham)
//   Qua cong bang ma QR (src/gatePass.js): entered_at / exited_at. Da qua cong vao thi khong bi tinh "khong den".
const crypto = require('crypto');
const { emitPush } = require('./notifyHub');

const RULES = {
  maxActivePerUser: 1,                                         // moi tai khoan chi 1 dat cho dang hieu luc
  hold: { min: 5, max: 120, default: 15, options: [15, 30, 45, 60] },          // phut giu cho cho xe den
  duration: { min: 30, max: 1440, default: 120, options: [60, 120, 180, 240, 480] }, // thoi luong gui du kien (phut)
  // gia han giu cho: toi da 2 lan, moi lan <= 30 phut, MOI LAN +5.000d (cong vao phi gui xe, tra khi ra cong)
  extend: { maxTimes: 2, min: 5, max: 30, options: [10, 15, 30], fee: 5000 },
  graceSeconds: 60,          // qua gio giu cho them 60s (cho do tre MQTT) server moi tu danh dau het han
  pendingTimeoutSeconds: 60, // 'pending' qua 60s (server loi giua chung) -> failed
  noShow: { limit: 3, windowDays: 7, suspendHours: 24 },   // 3 lan khong den trong 7 ngay -> khoa dat cho 24 gio
  // Ma QR qua cong: song 120s (app tu lam moi), ma ra bai dung duoc trong 48 gio ke tu luc dat
  // gateQrTtlSeconds: ma QR hien o cong (tai xe tu quet) doi sau 60s
  gate: { qrTtlSeconds: 120, refreshBeforeSeconds: 20, exitWithinHours: 48, gateQrTtlSeconds: 60 },
  // Phien gui xe (src/sessions.js): bat dau khi barie cong vao mo, phi tinh tu luc vao bai
  session: {
    extend: { options: [30, 60, 120], maxTimes: 5, maxTotalMinutes: 1440 }, // gia han thoi gian gui du kien
    overtimeGraceMinutes: 5,  // qua gio du kien > 5 phut moi tinh phu phi
    overtimeRate: 0.5,        // phu phi = 50% gia/gio cho moi gio (bat dau) qua gio du kien
    nearEndMinutes: 15,       // bao truoc khi het gio gui du kien
    noParkGraceMinutes: 15,   // vao bai roi ra luon (chua do o nao) trong 15 phut -> mien phi
    noParkAlertMinutes: 20,   // vao bai qua 20 phut chua do o nao -> nhac tai xe
    reparkWindowMinutes: 2,   // cam bien bao xe roi o roi thay lai trong 2 phut (chap chon / lui xe) -> noi tiep phien
  },
};

// Ma dat cho de doi chieu tai cong, vd DC-7KQ2XA (bo 0/O/1/I de de doc)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.randomBytes(6);
  return 'DC-' + Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// Phi du kien = so gio (lam tron len, toi thieu 1) x gia/gio - giong cach tinh phi luot do that
const estimateFee = (pricePerHour, durationMinutes) =>
  Math.max(1, Math.ceil(durationMinutes / 60)) * pricePerHour;

// Het han "luoi": goi truoc moi lan doc/dat cho thay vi chay dinh ky
// (tranh danh thuc Neon moi 30s khi khong ai dung app). Thiet bi van tu het han theo dong ho rieng
// va gui 'reservation_expired' - day chi la luoi an toan khi mat su kien / thiet bi offline.
// Thong bao "dat cho het han" cho cac dat cho vua chuyen 'expired' (moi dat cho bao 1 lan)
async function notifyExpired(q, ids) {
  if (!ids.length) return;
  const { rows } = await q.query(
    `INSERT INTO notifications (user_id, reservation_id, type, title, body, data, dedupe_key)
     SELECT r.user_id, r.id, 'reservation_expired', 'Đặt chỗ đã hết hạn',
            'Đã quá giờ giữ chỗ nhưng xe chưa đến nên ô #' || s.slot_number || ' được trả lại cho bãi. Lần này được tính là không đến.',
            jsonb_build_object('slotNumber', s.slot_number, 'code', r.code), 'r' || r.id || ':expired'
     FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = ANY($1)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`, [ids]);
  rows.forEach(emitPush);
}

async function expireStale(db) {
  // 1 luot goi DB (goi o moi lan doc bai / dat cho): het han giu cho + tra o + 'pending' treo -> failed
  const { rows } = await db.query(
    `WITH exp AS (
       UPDATE reservations SET status = 'expired', error = COALESCE(error, 'no_show'), updated_at = now()
       WHERE status = 'active' AND entered_at IS NULL AND expires_at < now() - make_interval(secs => $1)
       RETURNING id, slot_id),
     freed AS (
       UPDATE slots SET state = 'free', updated_at = now() WHERE id IN (SELECT slot_id FROM exp) AND state = 'reserved'),
     stuck AS (
       UPDATE reservations SET status = 'failed', error = 'pending_timeout', updated_at = now()
       WHERE status = 'pending' AND created_at < now() - make_interval(secs => $2))
     SELECT id FROM exp`, [RULES.graceSeconds, RULES.pendingTimeoutSeconds]);
  if (rows.length) await notifyExpired(db, rows.map((r) => r.id));
}

// Bi khoa dat cho do "khong den" qua nhieu? -> { until, noShows } hoac null
async function suspension(db, userId) {
  const { limit, windowDays, suspendHours } = RULES.noShow;
  const { rows } = await db.query(
    `SELECT updated_at FROM reservations
     WHERE user_id = $1 AND status = 'expired' AND updated_at > now() - make_interval(days => $2)
       AND updated_at > COALESCE((SELECT noshow_reset_at FROM users WHERE id = $1), '-infinity')
     ORDER BY updated_at DESC LIMIT $3`, [userId, windowDays, limit]);
  if (rows.length < limit) return { noShows: rows.length, until: null };
  const until = new Date(new Date(rows[0].updated_at).getTime() + suspendHours * 3600 * 1000);
  return { noShows: rows.length, until: until > new Date() ? until : null };
}

// Khu vuc mac dinh khi tao o: chia bai thanh 2 day A / B (bai 4 o: A = 1-2, B = 3-4)
const zoneSql = (slotNumberExpr, totalExpr) =>
  `chr(65 + ((${slotNumberExpr} - 1) / GREATEST(1, ceil(${totalExpr} / 2.0)::int)))`;

// Dat cho kem bai, khu vuc, o, bien so (dung cho danh sach / chi tiet / ket qua dat)
const RESERVATION_SELECT = `
  SELECT r.*, s.lot_id, s.slot_number, s.zone, l.online, l.name AS lot_name, l.address AS lot_address,
         veh.plate_number AS vehicle_plate, veh.vehicle_type, veh.brand AS vehicle_brand,
         (SELECT ps.id FROM parking_sessions ps WHERE ps.reservation_id = r.id) AS session_id
  FROM reservations r
  JOIN slots s ON s.id = r.slot_id
  JOIN parking_lots l ON l.id = s.lot_id
  LEFT JOIN vehicles veh ON veh.id = r.vehicle_id`;

module.exports = { RULES, RESERVATION_SELECT, newCode, estimateFee, expireStale, notifyExpired, suspension, zoneSql };
