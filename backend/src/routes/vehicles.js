// XE CUA TOI: tai xe tu khai bao xe (bien so, ten / dong xe, loai xe, mau)
//   GET /api/vehicles   POST /api/vehicles   PUT /api/vehicles/:id   DELETE /api/vehicles/:id
const express = require('express');
const { wrap, conflict, notFound, badRequest } = require('../errors');
const v = require('../validate');
const map = require('../mappers');

const VEHICLE_TYPES = ['car', 'motorbike', 'electric', 'bicycle', 'other'];
// Bien so: chu, so, dau gach / cham / khoang trang (vd 43A-123.45, 59-X1 234.56) -> luu IN HOA, gon khoang trang
const PLATE_RE = /^[A-Z0-9][A-Z0-9.\- ]{2,18}[A-Z0-9]$/;

function readPlate(body, optional = false) {
  const raw = v.str(body, 'plateNumber', { min: 4, max: 20, optional });
  if (raw === null) return null;
  const plate = raw.toUpperCase().replace(/\s+/g, ' ');
  if (!PLATE_RE.test(plate) || !/\d/.test(plate)) throw badRequest('invalid_plate', 'Bien so xe khong hop le');
  return plate;
}

function readType(body, def) {
  const t = v.str(body, 'vehicleType', { max: 20, optional: true });
  if (t === null) return def;
  if (!VEHICLE_TYPES.includes(t)) throw badRequest('invalid_vehicle_type', `Loai xe phai la: ${VEHICLE_TYPES.join(', ')}`);
  return t;
}

module.exports = function vehicleRoutes({ db, auth }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  r.get('/', wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM vehicles WHERE user_id = $1 ORDER BY id', [req.user.id]);
    res.json(rows.map(map.vehicle));
  }));

  r.post('/', wrap(async (req, res) => {
    const plate = readPlate(req.body);
    const type = readType(req.body, 'car');
    const brand = v.str(req.body, 'brand', { max: 50, optional: true });
    const color = v.str(req.body, 'color', { max: 30, optional: true });
    try {
      const row = await db.one(
        `INSERT INTO vehicles (user_id, plate_number, vehicle_type, brand, color)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.id, plate, type, brand, color],
      );
      res.status(201).json(map.vehicle(row));
    } catch (e) {
      if (e.code === '23505') throw conflict('plate_taken', 'Bien so da duoc dang ky');
      throw e;
    }
  }));

  // Sua thong tin xe (chi gui truong can doi; brand/color = '' -> xoa)
  r.put('/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const cur = await db.one('SELECT * FROM vehicles WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!cur) throw notFound('vehicle_not_found', 'Khong tim thay xe');
    const has = (k) => req.body && Object.prototype.hasOwnProperty.call(req.body, k);
    const plate = readPlate(req.body, true) ?? cur.plate_number;
    const type = readType(req.body, cur.vehicle_type);
    const brand = has('brand') ? v.str(req.body, 'brand', { max: 50, optional: true }) : cur.brand;
    const color = has('color') ? v.str(req.body, 'color', { max: 30, optional: true }) : cur.color;
    try {
      const row = await db.one(
        `UPDATE vehicles SET plate_number = $3, vehicle_type = $4, brand = $5, color = $6
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, req.user.id, plate, type, brand, color]);
      res.json(map.vehicle(row));
    } catch (e) {
      if (e.code === '23505') throw conflict('plate_taken', 'Bien so da duoc dang ky');
      throw e;
    }
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const row = await db.one('DELETE FROM vehicles WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    if (!row) throw notFound('vehicle_not_found', 'Khong tim thay xe');
    res.status(204).end();
  }));

  return r;
};

module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
