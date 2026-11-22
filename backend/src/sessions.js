// PHIEN GUI XE: tinh phi, mo phien khi qua cong vao, thong bao cho tai xe
//
// Vong doi 1 phien 'gate' (co dat cho, qua cong bang ma QR):
//   entered  : barie cong vao mo (confirmScan)            -> started_at, bat dau tinh phi
//   parked   : cam bien thay xe trong o (sync)             -> parked_at
//   left     : xe roi o -> CHOT PHI (ended_at, fee)        -> tai xe thanh toan
//   completed: qua cong ra (exited_at)
// Phien 'sensor' (khach vang lai): mo khi xe vao o, chot phi khi xe roi o.
//
// Phi = so gio (lam tron len, toi thieu 1) x gia/gio
//     + phu phi qua gio: moi gio (bat dau) sau planned_end_at (+ an han) x gia/gio x overtimeRate
// Thong bao theo thoi gian (sap het gio / qua gio / phi tang) duoc tao "luoi" khi tai xe mo app
// (refreshAlerts) -> khong can tien trinh chay nen danh thuc DB.
const { RULES } = require('./booking');
const { emitPush } = require('./notifyHub');

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

const SESSION_SELECT = `
  SELECT ps.*, s.slot_number, s.zone, s.lot_id, l.name AS lot_name, l.address AS lot_address,
         l.price_per_hour, l.online,
         r.code AS reservation_code, r.duration_minutes, COALESCE(ps.user_id, r.user_id) AS owner_id,
         veh.plate_number AS vehicle_plate,
         p.id AS payment_id, p.code AS payment_code, p.method AS payment_method, p.amount AS payment_amount,
         p.created_at AS paid_at
  FROM parking_sessions ps
  JOIN slots s ON s.id = ps.slot_id
  JOIN parking_lots l ON l.id = s.lot_id
  LEFT JOIN reservations r ON r.id = ps.reservation_id
  LEFT JOIN vehicles veh ON veh.id = ps.vehicle_id
  LEFT JOIN payments p ON p.session_id = ps.id`;

// Phien con "song" = xe con trong bai: phien sensor chua roi o / phien gate chua ra cong
// (phien gate da roi o qua 6 gio ma khong quet ma ra - vd ra bang nut - coi nhu da ket thuc)
const ACTIVE_WHERE = `ps.exited_at IS NULL AND (ps.ended_at IS NULL
  OR (ps.source = 'gate' AND ps.ended_at > now() - interval '6 hours'))`;

const ms = (d) => (d ? new Date(d).getTime() : null);

// Phi tai thoi diem endAt -> { hours, base, overtimeHours, overtime, total, nextChangeAt }
function sessionFee({ startedAt, endAt = Date.now(), pricePerHour, plannedEndAt = null, parked = true }) {
  const cfg = RULES.session;
  const start = ms(startedAt);
  const end = ms(endAt);
  const price = pricePerHour || 0;
  const elapsed = Math.max(0, end - start);
  if (!parked && elapsed <= cfg.noParkGraceMinutes * MIN) {
    return { hours: 0, base: 0, overtimeHours: 0, overtime: 0, total: 0, nextChangeAt: new Date(start + cfg.noParkGraceMinutes * MIN) };
  }
  const hours = Math.max(1, Math.ceil(elapsed / HOUR));
  const base = hours * price;
  let overtimeHours = 0;
  let next = start + hours * HOUR; // moc gio tiep theo
  if (plannedEndAt) {
    const otStart = ms(plannedEndAt) + cfg.overtimeGraceMinutes * MIN;
    if (end > otStart) {
      overtimeHours = Math.min(hours, Math.ceil((end - otStart) / HOUR));
      next = Math.min(next, otStart + overtimeHours * HOUR);
    } else {
      next = Math.min(next, otStart);
    }
  }
  const overtime = Math.round(overtimeHours * price * cfg.overtimeRate);
  return { hours, base, overtimeHours, overtime, total: base + overtime, nextChangeAt: new Date(next) };
}

const phaseOf = (s) => {
  if (s.exited_at || (s.source !== 'gate' && s.ended_at)) return 'completed';
  if (s.ended_at) return 'left';
  if (s.parked_at) return 'parked';
  return 'entered';
};

// Chot phi cho phien (xe roi o / ra cong khi chua do). q: db hoac client trong transaction
async function closeSession(q, sessionId, endAt = Date.now()) {
  const s = (await q.query(
    `SELECT ps.*, l.price_per_hour FROM parking_sessions ps JOIN slots sl ON sl.id = ps.slot_id
     JOIN parking_lots l ON l.id = sl.lot_id WHERE ps.id = $1 AND ps.ended_at IS NULL FOR UPDATE OF ps`, [sessionId])).rows[0];
  if (!s) return null;
  const fee = sessionFee({ startedAt: s.started_at, endAt, pricePerHour: s.price_per_hour,
    plannedEndAt: s.planned_end_at, parked: !!s.parked_at });
  return (await q.query(
    `UPDATE parking_sessions SET ended_at = to_timestamp($2 / 1000.0), duration_seconds = $3, fee = $4, overtime_fee = $5,
       updated_at = now() WHERE id = $1 RETURNING *`,
    [sessionId, endAt, Math.round((endAt - ms(s.started_at)) / 1000), fee.total, fee.overtime])).rows[0];
}

// Them thong bao (bo qua neu trung dedupe_key). q: db hoac client trong transaction
async function notify(q, { userId, sessionId = null, reservationId = null, type, title, body = null, data = {}, key = null }) {
  if (!userId) return null;
  const { rows } = await q.query(
    `INSERT INTO notifications (user_id, session_id, reservation_id, type, title, body, data, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
    [userId, sessionId, reservationId, type, title, body, data, key]);
  if (rows[0]) emitPush(rows[0]); // thong bao moi (khong trung) -> gui day toi dien thoai
  return rows[0] || null;
}

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const hhmm = (d) => new Date(ms(d) + 7 * HOUR).toISOString().slice(11, 16); // gio Viet Nam

// Barie cong vao da mo cho dat cho -> mo phien gui xe (idempotent: 1 dat cho chi 1 phien)
async function startGateSession(q, reservationId) {
  const { rows } = await q.query(
    `INSERT INTO parking_sessions (slot_id, reservation_id, user_id, vehicle_id, source, started_at, planned_end_at)
     SELECT r.slot_id, r.id, r.user_id, r.vehicle_id, 'gate', COALESCE(r.entered_at, now()),
            COALESCE(r.entered_at, now()) + make_interval(mins => COALESCE(r.duration_minutes, 120))
     FROM reservations r WHERE r.id = $1
     ON CONFLICT (reservation_id) WHERE reservation_id IS NOT NULL DO NOTHING
     RETURNING *`, [reservationId]);
  const s = rows[0];
  if (s) {
    const info = (await q.query(
      'SELECT sl.slot_number, sl.zone FROM slots sl WHERE sl.id = $1', [s.slot_id])).rows[0] || {};
    await notify(q, {
      userId: s.user_id, sessionId: s.id, reservationId, type: 'session_started', key: `s${s.id}:start`,
      title: 'Bắt đầu phiên gửi xe',
      body: `Xe đã qua cổng vào lúc ${hhmm(s.started_at)}. Mời đến khu ${info.zone || '-'}, ô #${info.slot_number}. Phí được tính từ bây giờ.`,
      data: { slotNumber: info.slot_number, zone: info.zone },
    });
  }
  return s;
}

// Thong bao theo thoi gian cho cac phien dang hoat dong cua tai xe (goi khi mo app / xem phien)
async function refreshAlerts(db, userId) {
  const cfg = RULES.session;
  const { rows } = await db.query(
    `${SESSION_SELECT} WHERE ps.user_id = $1 AND ps.ended_at IS NULL AND ps.exited_at IS NULL`, [userId]);
  const now = Date.now();
  for (const s of rows) {
    const fee = sessionFee({ startedAt: s.started_at, endAt: now, pricePerHour: s.price_per_hour,
      plannedEndAt: s.planned_end_at, parked: !!s.parked_at });
    const base = { userId, sessionId: s.id, reservationId: s.reservation_id };
    if (fee.hours >= 2) {
      await notify(db, { ...base, type: 'fee_changed', key: `s${s.id}:fee:${fee.hours}:${fee.overtimeHours}`,
        title: 'Phí gửi xe đã thay đổi',
        body: `Đã gửi ${fee.hours} giờ. Phí hiện tại ${vnd(fee.total)}${fee.overtime ? ` (gồm phụ phí quá giờ ${vnd(fee.overtime)})` : ''}.`,
        data: { fee: fee.total, hours: fee.hours, overtime: fee.overtime } });
    }
    if (s.planned_end_at) {
      const end = ms(s.planned_end_at);
      const tag = Math.floor(end / 1000);
      if (now >= end - cfg.nearEndMinutes * MIN && now < end) {
        await notify(db, { ...base, type: 'near_end', key: `s${s.id}:near:${tag}`,
          title: 'Sắp hết giờ gửi xe',
          body: `Phiên gửi xe hết giờ dự kiến lúc ${hhmm(end)}. Gia hạn để không bị tính phụ phí quá giờ.`,
          data: { plannedEndAt: s.planned_end_at } });
      }
      if (now > end + cfg.overtimeGraceMinutes * MIN) {
        await notify(db, { ...base, type: 'overtime', key: `s${s.id}:over:${tag}`,
          title: 'Đã quá giờ gửi xe',
          body: `Đã quá giờ dự kiến (${hhmm(end)}). Phụ phí ${Math.round(cfg.overtimeRate * 100)}% giá/giờ cho mỗi giờ quá hạn. Hãy gia hạn hoặc lấy xe.`,
          data: { plannedEndAt: s.planned_end_at, overtime: fee.overtime } });
      }
    }
    if (!s.parked_at && s.source === 'gate' && now - ms(s.started_at) > cfg.noParkAlertMinutes * MIN) {
      await notify(db, { ...base, type: 'not_parked', key: `s${s.id}:nopark`,
        title: 'Xe chưa vào ô đỗ',
        body: `Xe đã vào bãi hơn ${cfg.noParkAlertMinutes} phút nhưng cảm biến chưa thấy xe ở ô #${s.slot_number}. Phí vẫn được tính từ lúc qua cổng.`,
        data: { slotNumber: s.slot_number } });
    }
  }
}

// DB -> JSON cho app
function sessionView(s, now = Date.now()) {
  if (!s) return s;
  const phase = phaseOf(s);
  const open = !s.ended_at;
  const fee = open
    ? sessionFee({ startedAt: s.started_at, endAt: now, pricePerHour: s.price_per_hour, plannedEndAt: s.planned_end_at, parked: !!s.parked_at })
    : null;
  const plannedFee = s.planned_end_at
    ? sessionFee({ startedAt: s.started_at, endAt: ms(s.planned_end_at), pricePerHour: s.price_per_hour }).total
    : null;
  const total = open ? fee.total : s.fee || 0;
  const paid = !!s.payment_id;
  const ext = RULES.session.extend;
  const plannedMinutes = s.planned_end_at ? Math.round((ms(s.planned_end_at) - ms(s.started_at)) / MIN) : null;
  return {
    id: s.id, source: s.source, phase,
    lotId: s.lot_id, lotName: s.lot_name, lotAddress: s.lot_address, lotOnline: s.online,
    zone: s.zone, slotNumber: s.slot_number,
    reservationId: s.reservation_id, reservationCode: s.reservation_code ?? null,
    vehicleId: s.vehicle_id, vehiclePlate: s.vehicle_plate ?? null,
    startedAt: s.started_at, parkedAt: s.parked_at, endedAt: s.ended_at, exitedAt: s.exited_at,
    plannedEndAt: s.planned_end_at, plannedMinutes, extendCount: s.extend_count || 0,
    durationSeconds: s.duration_seconds,
    elapsedSeconds: Math.max(0, Math.round(((open ? now : ms(s.ended_at)) - ms(s.started_at)) / 1000)),
    pricePerHour: s.price_per_hour,
    // Tuong thich API cu (/sessions/mine): fee = phi da chot, estimatedFee = phi tam tinh, status
    fee: open ? null : s.fee,
    estimatedFee: open ? total : null,
    status: open ? 'parking' : paid ? 'paid' : 'unpaid',
    cost: {
      total, final: !open,
      hours: open ? fee.hours : null, base: open ? fee.base : (s.fee || 0) - (s.overtime_fee || 0),
      overtime: open ? fee.overtime : s.overtime_fee || 0, overtimeHours: open ? fee.overtimeHours : null,
      nextChangeAt: open ? fee.nextChangeAt : null,
      planned: plannedFee,
    },
    overtime: !!s.planned_end_at && now > ms(s.planned_end_at) + RULES.session.overtimeGraceMinutes * MIN && open,
    amountDue: paid ? 0 : total,
    paid,
    payment: paid ? { id: s.payment_id, code: s.payment_code, method: s.payment_method, amount: s.payment_amount, paidAt: s.paid_at } : null,
    flags: s.flags || [],
    canExtend: open && !!s.planned_end_at && (s.extend_count || 0) < ext.maxTimes && plannedMinutes < ext.maxTotalMinutes,
    canPay: !paid && (phase === 'left' || (phase === 'entered' && s.source === 'gate')),
    updatedAt: s.updated_at,
  };
}

module.exports = {
  SESSION_SELECT, ACTIVE_WHERE, sessionFee, closeSession, notify, startGateSession, refreshAlerts, sessionView, phaseOf,
  vnd, hhmm,
};
