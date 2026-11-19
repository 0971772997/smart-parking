const express = require('express');
const { wrap, conflict, notFound } = require('../errors');
const v = require('../validate');
const map = require('../mappers');

module.exports = function vehicleRoutes({ db, auth }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  r.get('/', wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM vehicles WHERE user_id = $1 ORDER BY id', [req.user.id]);
    res.json(rows.map(map.vehicle));
  }));

  r.post('/', wrap(async (req, res) => {
    const plate = v.str(req.body, 'plateNumber', { min: 4, max: 20 }).toUpperCase();
    const brand = v.str(req.body, 'brand', { max: 50, optional: true });
    const color = v.str(req.body, 'color', { max: 30, optional: true });
    try {
      const row = await db.one(
        'INSERT INTO vehicles (user_id, plate_number, brand, color) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.user.id, plate, brand, color],
      );
      res.status(201).json(map.vehicle(row));
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
