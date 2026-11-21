// CAP NHAT THOI GIAN THUC (long-poll, xem src/live.js) - cong khai, khong can dang nhap
//   GET /api/live?v=<version>&wait=25            tong quan moi bai: o trong / co xe / giu cho, so xe trong bai
//   GET /api/lots/:lotId/live?v=<version>&wait=25 chi tiet 1 bai: tung o, barie, luot vao/ra hom nay, su kien gan day
// App goi lai ngay voi `version` vua nhan: server giu request toi khi co thay doi (hoac het `wait` giay).
const express = require('express');
const { wrap, notFound } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { expireStale } = require('../booking');
const { ACTIVE_WHERE } = require('../sessions');

const MAX_WAIT_S = 25;
const TODAY = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;

module.exports = function liveRoutes({ db, live }) {
  const r = express.Router();

  async function waitChange(req) {
    const since = typeof req.query.v === 'string' ? req.query.v : '';
    const wait = v.int(req.query, 'wait', { min: 0, max: MAX_WAIT_S, def: MAX_WAIT_S });
    const changed = await live.wait(since, wait * 1000);
    return { changed, version: live.version() };
  }

  const carsInLot = async (lotId = null) => (await db.query(
    `SELECT s.lot_id, COUNT(*)::int AS n FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id
     WHERE ${ACTIVE_WHERE} AND ($1::text IS NULL OR s.lot_id = $1) GROUP BY s.lot_id`, [lotId])).rows;

  r.get('/live', wrap(async (req, res) => {
    const w = await waitChange(req);
    await expireStale(db);
    const { rows } = await db.query(`
      SELECT l.*, COUNT(s.id) FILTER (WHERE s.state = 'free') AS free_slots,
             COUNT(s.id) FILTER (WHERE s.state = 'occupied')::int AS occupied,
             COUNT(s.id) FILTER (WHERE s.state = 'reserved')::int AS reserved
      FROM parking_lots l LEFT JOIN slots s ON s.lot_id = l.id GROUP BY l.id ORDER BY l.name`);
    const cars = new Map((await carsInLot()).map((x) => [x.lot_id, x.n]));
    res.json({
      ...w,
      lots: rows.map((l) => ({ ...map.lot(l), occupiedSlots: l.occupied, reservedSlots: l.reserved, carsInLot: cars.get(l.id) || 0 })),
      at: new Date().toISOString(),
    });
  }));

  r.get('/lots/:lotId/live', wrap(async (req, res) => {
    const w = await waitChange(req);
    await expireStale(db);
    const lot = await db.one('SELECT * FROM parking_lots WHERE id = $1', [req.params.lotId]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');
    const { rows: slots } = await db.query('SELECT * FROM slots WHERE lot_id = $1 ORDER BY slot_number', [lot.id]);
    const count = (st) => slots.filter((s) => s.state === st).length;
    const today = await db.one(`
      SELECT COUNT(*) FILTER (WHERE type = 'gate' AND payload->>'state' = 'open' AND payload->>'gate' = 'entry')::int AS entries,
             COUNT(*) FILTER (WHERE type = 'gate' AND payload->>'state' = 'open' AND payload->>'gate' = 'exit')::int AS exits,
             COUNT(*) FILTER (WHERE type = 'entry_rejected')::int AS rejected
      FROM device_events WHERE lot_id = $1 AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ${TODAY}`, [lot.id]);
    const { rows: events } = await db.query(
      `SELECT id, type, payload, created_at FROM device_events
       WHERE lot_id = $1 AND type IN ('gate', 'slot_changed', 'entry_rejected', 'reservation_expired')
       ORDER BY id DESC LIMIT 10`, [lot.id]);
    res.json({
      ...w,
      ...map.lot(lot),
      freeSlots: count('free'), occupiedSlots: count('occupied'), reservedSlots: count('reserved'),
      carsInLot: (await carsInLot(lot.id))[0]?.n || 0,
      today,
      slots: slots.map(map.slot),
      events: events.map((e) => ({ id: Number(e.id), type: e.type, payload: e.payload, createdAt: e.created_at })),
      at: new Date().toISOString(),
    });
  }));

  return r;
};
