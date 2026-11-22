const express = require('express');
const crypto = require('crypto');
const { wrap, badRequest, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { RULES, RESERVATION_SELECT, newCode, estimateFee, expireStale, suspension, zoneSql } = require('../booking');
const { notify, hhmm } = require('../sessions');

// Tom tat theo khu vuc: [{ zone, total, free, occupied, reserved }]
function zonesOf(slots) {
  const by = new Map();
  for (const s of slots) {
    const z = s.zone || 'A';
    if (!by.has(z)) by.set(z, { zone: z, total: 0, free: 0, occupied: 0, reserved: 0 });
    const e = by.get(z);
    e.total += 1;
    e[s.state] += 1;
  }
  return [...by.values()].sort((a, b) => a.zone.localeCompare(b.zone));
}

const LOT_ID_RE = /^[a-zA-Z0-9_-]{3,50}$/;

module.exports = function lotRoutes({ db, auth, device }) {
  const r = express.Router();

  async function getLot(lotId) {
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [lotId]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');
    return lot;
  }

  function requireOnline(lot) {
    if (!lot.online) throw new HttpError(503, 'device_offline', 'Thiet bi bai do dang mat ket noi');
  }

  // ---------- Cong khai ----------
  r.get('/', wrap(async (_req, res) => {
    await expireStale(db);
    const { rows } = await db.query(`
      SELECT l.*, COUNT(s.id) FILTER (WHERE s.state = 'free') AS free_slots, rv.rating_avg, rv.rating_count
      FROM parking_lots l LEFT JOIN slots s ON s.lot_id = l.id
      LEFT JOIN LATERAL (SELECT AVG(rating) AS rating_avg, COUNT(*) AS rating_count FROM lot_reviews WHERE lot_id = l.id) rv ON true
      GROUP BY l.id, rv.rating_avg, rv.rating_count ORDER BY l.name`);
    res.json(rows.map(map.lot));
  }));

  r.get('/:lotId', wrap(async (req, res) => {
    await expireStale(db);
    const lot = await getLot(req.params.lotId);
    Object.assign(lot, await db.one(
      'SELECT AVG(rating) AS rating_avg, COUNT(*) AS rating_count FROM lot_reviews WHERE lot_id = $1', [lot.id]));
    const { rows } = await db.query('SELECT * FROM slots WHERE lot_id = $1 ORDER BY slot_number', [lot.id]);
    const slots = rows.map(map.slot);
    res.json({
      ...map.lot(lot),
      freeSlots: slots.filter((s) => s.state === 'free').length,
      occupiedSlots: slots.filter((s) => s.state === 'occupied').length,
      reservedSlots: slots.filter((s) => s.state === 'reserved').length,
      zones: zonesOf(slots),
      slots,
    });
  }));

  r.get('/:lotId/slots', wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const { rows } = await db.query('SELECT * FROM slots WHERE lot_id = $1 ORDER BY slot_number', [lot.id]);
    res.json(rows.map(map.slot));
  }));

  // ---------- Dat cho (nguoi dung da dang nhap) ----------
  // Body: { zone?, slotNumber?, minutes? (giu cho), durationMinutes? (gui du kien), vehicleId? }
  // - Co slotNumber: dat dung o do. Chi co zone: tu chon o trong so nho nhat trong khu. Khong co ca 2: o trong bat ky.
  // Quy tac: xem src/booking.js (RULES). Tra ve 201 khi ESP32 xac nhan giu o (status 'active').
  r.post('/:lotId/reservations', auth.requireAuth, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const slotNumber = v.int(req.body, 'slotNumber', { min: 1, max: lot.total_slots, optional: true });
    const zone = v.str(req.body, 'zone', { max: 10, optional: true });
    const { hold, duration } = RULES;
    const minutes = v.int(req.body, 'minutes', { min: hold.min, max: hold.max, def: hold.default });
    const durationMinutes = v.int(req.body, 'durationMinutes', { min: duration.min, max: duration.max, def: duration.default });
    const vehicleId = v.int(req.body, 'vehicleId', { min: 1, optional: true });

    if (vehicleId) {
      const veh = await db.one('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, req.user.id]);
      if (!veh) throw badRequest('vehicle_not_found', 'Xe khong thuoc tai khoan nay');
    }
    await expireStale(db);
    const mine = await db.one(
      `SELECT id FROM reservations WHERE user_id = $1 AND status IN ('pending', 'active')`, [req.user.id]);
    if (mine) throw conflict('already_has_reservation', 'Ban dang co 1 dat cho chua dung');
    const sus = await suspension(db, req.user.id);
    if (sus.until) {
      throw Object.assign(new HttpError(403, 'booking_suspended', 'Tam khoa dat cho do khong den nhieu lan'),
        { details: { suspendedUntil: sus.until, noShows: sus.noShows } });
    }

    let slot;
    if (slotNumber) {
      slot = await db.one('SELECT * FROM slots WHERE lot_id = $1 AND slot_number = $2', [lot.id, slotNumber]);
      if (!slot) throw notFound('slot_not_found', 'Khong tim thay o do');
      if (zone && slot.zone !== zone) throw badRequest('slot_zone_mismatch', `O ${slotNumber} khong thuoc khu ${zone}`);
      if (slot.state !== 'free') throw conflict('slot_not_free', 'O do khong con trong');
    } else {
      if (zone && !(await db.one('SELECT 1 FROM slots WHERE lot_id = $1 AND zone = $2 LIMIT 1', [lot.id, zone]))) {
        throw notFound('zone_not_found', 'Khong tim thay khu vuc');
      }
      slot = await db.one(
        `SELECT * FROM slots WHERE lot_id = $1 AND state = 'free' AND ($2::text IS NULL OR zone = $2)
         ORDER BY slot_number LIMIT 1`, [lot.id, zone]);
      if (!slot) throw conflict(zone ? 'zone_full' : 'lot_full', zone ? 'Khu vuc da het o trong' : 'Bai da het o trong');
    }
    requireOnline(lot);

    const requestId = crypto.randomUUID();
    let resv;
    try {
      resv = await db.one(
        `INSERT INTO reservations (user_id, slot_id, vehicle_id, minutes, request_id, code, duration_minutes, estimated_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [req.user.id, slot.id, vehicleId, minutes, requestId, newCode(), durationMinutes,
          estimateFee(lot.price_per_hour, durationMinutes)],
      );
    } catch (e) {
      if (e.code === '23505') throw conflict('slot_not_free', 'O do vua duoc nguoi khac dat');
      throw e;
    }

    // Xac nhan: chi khi ESP32 tra ack ok moi coi la giu cho thanh cong; gio het han tinh tu luc xac nhan
    const ack = await device.sendCommand(lot.id, { action: 'reserve', slot: slot.slot_number, minutes, requestId });
    let row;
    if (ack && ack.ok) {
      row = await db.one(
        `UPDATE reservations SET status = 'active', confirmed_at = now(),
           expires_at = now() + make_interval(mins => minutes), updated_at = now()
         WHERE id = $1 RETURNING *`, [resv.id]);
      await db.query(`UPDATE slots SET state = 'reserved', updated_at = now() WHERE id = $1 AND state = 'free'`, [slot.id]);
    } else {
      const err = ack ? ack.error || 'device_error' : 'device_timeout';
      row = await db.one(
        `UPDATE reservations SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [resv.id, err]);
    }
    const out = map.reservation(await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [row.id]));
    if (row.status === 'active') {
      await notify(db, { userId: req.user.id, reservationId: row.id, type: 'reservation_confirmed', key: `r${row.id}:confirmed`,
        title: 'Đặt chỗ thành công',
        body: `Mã ${row.code} • ${lot.name}, khu ${slot.zone || '-'}, ô #${slot.slot_number}. Giữ chỗ đến ${hhmm(row.expires_at)} – quét mã QR tại cổng vào.`,
        data: { code: row.code, slotNumber: slot.slot_number, expiresAt: row.expires_at } });
      return res.status(201).json(out);
    }
    if (!ack) throw Object.assign(new HttpError(504, 'device_timeout', 'Thiet bi khong phan hoi'), { details: out });
    throw Object.assign(conflict(row.error, 'Thiet bi tu choi dat cho'), { details: out });
  }));

  // ---------- Quan tri ----------
  r.post('/', auth.requireAuth, auth.requireAdmin, wrap(async (req, res) => {
    const id = v.str(req.body, 'id', { pattern: LOT_ID_RE });
    const name = v.str(req.body, 'name', { max: 100 });
    const address = v.str(req.body, 'address', { optional: true });
    const totalSlots = v.int(req.body, 'totalSlots', { min: 1, max: 100 });
    const pricePerHour = v.int(req.body, 'pricePerHour', { min: 0, max: 10000000, def: 10000 });
    const lot = await db.tx(async (q) => {
      const l = (await q.query(
        `INSERT INTO parking_lots (id, name, address, total_slots, price_per_hour) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING RETURNING *`, [id, name, address, totalSlots, pricePerHour])).rows[0];
      if (!l) throw conflict('lot_exists', 'Ma bai do da ton tai');
      await q.query(`INSERT INTO slots (lot_id, slot_number, zone)
                     SELECT $1, n, ${zoneSql('n', '$2::int')} FROM generate_series(1, $2) n`, [id, totalSlots]);
      return l;
    });
    res.status(201).json(map.lot(lot));
  }));

  r.post('/:lotId/gates/:gate/:action', auth.requireAuth, auth.requireAdmin, wrap(async (req, res) => {
    const { gate, action } = req.params;
    if (!['entry', 'exit'].includes(gate)) throw badRequest('invalid_gate', "gate phai la 'entry' hoac 'exit'");
    if (!['open', 'close'].includes(action)) throw notFound();
    const lot = await getLot(req.params.lotId);
    requireOnline(lot);
    const ack = await device.sendCommand(lot.id, { action: `${action}_gate`, gate });
    if (!ack) throw new HttpError(504, 'device_timeout', 'Thiet bi khong phan hoi');
    if (!ack.ok) throw conflict(ack.error || 'device_error', 'Thiet bi tu choi lenh');
    res.json({ ok: true, gate, action });
  }));

  r.get('/:lotId/sessions', auth.requireAuth, auth.requireAdmin, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const limit = v.int(req.query, 'limit', { min: 1, max: 200, def: 50 });
    const { rows } = await db.query(`
      SELECT ps.*, s.slot_number FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id
      WHERE s.lot_id = $1 ORDER BY ps.started_at DESC LIMIT $2`, [lot.id, limit]);
    res.json(rows.map(map.session));
  }));

  r.get('/:lotId/events', auth.requireAuth, auth.requireAdmin, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const limit = v.int(req.query, 'limit', { min: 1, max: 500, def: 100 });
    const params = [lot.id, limit];
    let where = 'lot_id = $1';
    if (req.query.type) { params.push(String(req.query.type)); where += ` AND type = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT id, type, payload, created_at FROM device_events WHERE ${where} ORDER BY id DESC LIMIT $2`, params);
    res.json(rows.map((e) => ({ id: Number(e.id), type: e.type, payload: e.payload, createdAt: e.created_at })));
  }));

  // Thong ke theo ngay (gio Viet Nam). ?date=YYYY-MM-DD, mac dinh hom nay
  r.get('/:lotId/stats', auth.requireAuth, auth.requireAdmin, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const date = req.query.date ? String(req.query.date) : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('validation_error', 'date phai dang YYYY-MM-DD');
    const day = `COALESCE($2::date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`;
    const s = await db.one(`
      SELECT COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE ended_at IS NOT NULL)::int AS completed,
             COALESCE(SUM(fee), 0)::int AS revenue,
             COALESCE(ROUND(AVG(duration_seconds)), 0)::int AS avg_duration_seconds
      FROM parking_sessions ps JOIN slots sl ON sl.id = ps.slot_id
      WHERE sl.lot_id = $1 AND (ps.started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${day}`, [lot.id, date]);
    const rs = await db.query(`
      SELECT r.status, COUNT(*)::int AS n FROM reservations r JOIN slots sl ON sl.id = r.slot_id
      WHERE sl.lot_id = $1 AND (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${day}
      GROUP BY r.status`, [lot.id, date]);
    const cur = await db.one(`
      SELECT COUNT(*) FILTER (WHERE state = 'occupied')::int AS occupied, COUNT(*)::int AS total
      FROM slots WHERE lot_id = $1`, [lot.id]);
    const dayRow = await db.one(
      `SELECT to_char(COALESCE($1::date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), 'YYYY-MM-DD') AS d`, [date]);
    res.json({
      date: dayRow.d,
      sessions: s.sessions,
      completedSessions: s.completed,
      revenue: s.revenue,
      avgDurationSeconds: s.avg_duration_seconds,
      reservations: Object.fromEntries(rs.rows.map((x) => [x.status, x.n])),
      occupancyRate: cur.total ? Math.round((cur.occupied / cur.total) * 100) : 0,
    });
  }));

  return r;
};
