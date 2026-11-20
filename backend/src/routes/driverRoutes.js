// Lo trinh thuong di cua tai xe: CRUD, chi chu so huu moi xem/sua/xoa duoc
const express = require('express');
const { wrap, badRequest, notFound, conflict } = require('../errors');
const v = require('../validate');
const map = require('../mappers');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ROUTES = 20;

// Kem thong tin bai dich (ten, dia chi, gia, online, so o trong) + bien so xe
const SELECT = `
  SELECT dr.*, l.name AS lot_name, l.address AS lot_address, l.price_per_hour AS lot_price_per_hour,
         l.online AS lot_online, l.total_slots AS lot_total_slots,
         (SELECT COUNT(*) FROM slots s WHERE s.lot_id = l.id AND s.state = 'free') AS lot_free_slots,
         veh.plate_number AS vehicle_plate
  FROM driver_routes dr
  JOIN parking_lots l ON l.id = dr.lot_id
  LEFT JOIN vehicles veh ON veh.id = dr.vehicle_id`;

function parseDays(body, partial) {
  const d = body?.days;
  if (d === undefined && partial) return undefined;
  if (d === undefined) return [1, 2, 3, 4, 5];
  if (!Array.isArray(d) || d.length === 0 || d.some((x) => !Number.isInteger(x) || x < 1 || x > 7)) {
    throw badRequest('validation_error', "'days' phai la mang so 1..7 (1 = Thu 2, 7 = Chu nhat), it nhat 1 ngay");
  }
  return [...new Set(d)].sort((a, b) => a - b);
}

// partial = true: chi kiem tra cac truong duoc gui (PATCH)
function parseBody(body, partial) {
  const has = (k) => !partial || body?.[k] !== undefined;
  const out = {};
  if (has('name')) out.name = v.str(body, 'name', { max: 60 });
  if (has('origin')) out.origin = v.str(body, 'origin', { max: 120, optional: true });
  if (has('lotId')) out.lot_id = v.str(body, 'lotId', { max: 50 });
  if (has('vehicleId')) out.vehicle_id = v.int(body, 'vehicleId', { min: 1, optional: true });
  if (has('departTime')) out.depart_time = v.str(body, 'departTime', { pattern: TIME_RE });
  const days = parseDays(body, partial);
  if (days !== undefined) out.days = days;
  if (has('minutes')) out.minutes = v.int(body, 'minutes', { min: 1, max: 120, def: partial ? undefined : 15 });
  if (has('note')) out.note = v.str(body, 'note', { max: 255, optional: true });
  if (has('active')) {
    if (body?.active === undefined) out.active = true;
    else if (typeof body.active !== 'boolean') throw badRequest('validation_error', "'active' phai la true/false");
    else out.active = body.active;
  }
  return out;
}

module.exports = function driverRouteRoutes({ db, auth }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  async function checkRefs(userId, data) {
    if (data.lot_id && !(await db.one('SELECT id FROM parking_lots WHERE id = $1', [data.lot_id]))) {
      throw badRequest('lot_not_found', 'Khong tim thay bai do');
    }
    if (data.vehicle_id && !(await db.one('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [data.vehicle_id, userId]))) {
      throw badRequest('vehicle_not_found', 'Xe khong thuoc tai khoan nay');
    }
  }

  const getOne = (id, userId) => db.one(`${SELECT} WHERE dr.id = $1 AND dr.user_id = $2`, [id, userId]);

  // Danh sach lo trinh cua toi, sap theo gio di
  r.get('/', wrap(async (req, res) => {
    const { rows } = await db.query(`${SELECT} WHERE dr.user_id = $1 ORDER BY dr.depart_time, dr.id`, [req.user.id]);
    res.json(rows.map(map.driverRoute));
  }));

  r.get('/:id', wrap(async (req, res) => {
    const row = await getOne(v.int(req.params, 'id', { min: 1 }), req.user.id);
    if (!row) throw notFound('route_not_found', 'Khong tim thay lo trinh');
    res.json(map.driverRoute(row));
  }));

  r.post('/', wrap(async (req, res) => {
    const data = parseBody(req.body, false);
    await checkRefs(req.user.id, data);
    const { n } = await db.one('SELECT COUNT(*)::int AS n FROM driver_routes WHERE user_id = $1', [req.user.id]);
    if (n >= MAX_ROUTES) throw conflict('route_limit', `Toi da ${MAX_ROUTES} lo trinh`);
    const row = await db.one(
      `INSERT INTO driver_routes (user_id, name, origin, lot_id, vehicle_id, depart_time, days, minutes, note, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [req.user.id, data.name, data.origin, data.lot_id, data.vehicle_id, data.depart_time, data.days,
        data.minutes, data.note, data.active]);
    res.status(201).json(map.driverRoute(await getOne(row.id, req.user.id)));
  }));

  // Sua mot phan (vd chi bat/tat: { active: false })
  r.patch('/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const data = parseBody(req.body, true);
    const keys = Object.keys(data);
    if (keys.length === 0) throw badRequest('validation_error', 'Khong co truong nao de cap nhat');
    await checkRefs(req.user.id, data);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const row = await db.one(
      `UPDATE driver_routes SET ${sets}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user.id, ...keys.map((k) => data[k])]);
    if (!row) throw notFound('route_not_found', 'Khong tim thay lo trinh');
    res.json(map.driverRoute(await getOne(id, req.user.id)));
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const row = await db.one('DELETE FROM driver_routes WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    if (!row) throw notFound('route_not_found', 'Khong tim thay lo trinh');
    res.status(204).end();
  }));

  return r;
};
