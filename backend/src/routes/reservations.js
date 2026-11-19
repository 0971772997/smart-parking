const express = require('express');
const { wrap, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');

const SELECT = `
  SELECT r.*, s.lot_id, s.slot_number, l.online
  FROM reservations r JOIN slots s ON s.id = r.slot_id JOIN parking_lots l ON l.id = s.lot_id`;

module.exports = function reservationRoutes({ db, auth, device }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  async function getOwn(req) {
    const id = v.int(req.params, 'id', { min: 1 });
    const row = await db.one(`${SELECT} WHERE r.id = $1`, [id]);
    if (!row || (row.user_id !== req.user.id && req.user.role !== 'admin')) {
      throw notFound('reservation_not_found', 'Khong tim thay dat cho');
    }
    return row;
  }

  function requireActive(row) {
    if (row.status !== 'active') throw conflict('reservation_not_active', `Dat cho dang o trang thai '${row.status}'`);
    if (!row.online) throw new HttpError(503, 'device_offline', 'Thiet bi bai do dang mat ket noi');
  }

  // Danh sach dat cho cua toi. ?status=active
  r.get('/', wrap(async (req, res) => {
    const params = [req.user.id];
    let where = 'r.user_id = $1';
    if (req.query.status) { params.push(String(req.query.status)); where += ' AND r.status = $2'; }
    const { rows } = await db.query(`${SELECT} WHERE ${where} ORDER BY r.created_at DESC LIMIT 50`, params);
    res.json(rows.map(map.reservation));
  }));

  r.get('/:id', wrap(async (req, res) => {
    res.json(map.reservation(await getOwn(req)));
  }));

  // Huy dat cho
  r.delete('/:id', wrap(async (req, res) => {
    const row = await getOwn(req);
    requireActive(row);
    const ack = await device.sendCommand(row.lot_id, { action: 'cancel_reservation', slot: row.slot_number });
    if (!ack) throw new HttpError(504, 'device_timeout', 'Thiet bi khong phan hoi');
    // not_reserved = thiet bi da khong con giu cho (het han/xe da vao) -> van danh dau huy
    if (!ack.ok && ack.error !== 'not_reserved') throw conflict(ack.error || 'device_error', 'Thiet bi tu choi');
    const upd = await db.one(
      `UPDATE reservations SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'active' RETURNING *`,
      [row.id]);
    await db.query(`UPDATE slots SET state = 'free', updated_at = now() WHERE id = $1 AND state = 'reserved'`, [row.slot_id]);
    res.json(map.reservation({ ...row, ...(upd || {}), status: 'cancelled' }));
  }));

  // Gia han dat cho
  r.post('/:id/extend', wrap(async (req, res) => {
    const row = await getOwn(req);
    const minutes = v.int(req.body, 'minutes', { min: 1, max: 120 });
    if (row.minutes + minutes > 240) throw conflict('extend_limit', 'Tong thoi gian dat cho toi da 240 phut');
    requireActive(row);
    const ack = await device.sendCommand(row.lot_id, { action: 'extend_reservation', slot: row.slot_number, minutes });
    if (!ack) throw new HttpError(504, 'device_timeout', 'Thiet bi khong phan hoi');
    if (!ack.ok) throw conflict(ack.error || 'device_error', 'Thiet bi tu choi');
    const upd = await db.one(
      `UPDATE reservations SET minutes = minutes + $2, expires_at = expires_at + make_interval(mins => $2),
         updated_at = now() WHERE id = $1 RETURNING *`, [row.id, minutes]);
    res.json(map.reservation({ ...row, ...upd }));
  }));

  return r;
};
