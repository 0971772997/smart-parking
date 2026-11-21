// Dat cho cua toi: xem danh sach / chi tiet, huy, gia han. Tao dat cho: POST /api/lots/:lotId/reservations
const express = require('express');
const { wrap, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { RULES, RESERVATION_SELECT: SELECT, expireStale, suspension } = require('../booking');

const STATUSES = ['pending', 'active', 'fulfilled', 'cancelled', 'expired', 'failed'];

module.exports = function reservationRoutes({ db, auth, device }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  async function getOwn(req) {
    const id = v.int(req.params, 'id', { min: 1 });
    await expireStale(db);
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

  // Quy tac dat cho + tinh trang cua toi (so lan khong den, co bi khoa khong) -> app hien cho nguoi dung
  r.get('/rules', wrap(async (req, res) => {
    const s = await suspension(db, req.user.id);
    res.json({ ...RULES, me: { noShows: s.noShows, suspendedUntil: s.until } });
  }));

  // Danh sach dat cho cua toi. ?status=active | ?status=active,pending
  r.get('/', wrap(async (req, res) => {
    await expireStale(db);
    const params = [req.user.id];
    let where = 'r.user_id = $1';
    if (req.query.status) {
      const list = String(req.query.status).split(',').filter((x) => STATUSES.includes(x));
      params.push(list);
      where += ' AND r.status = ANY($2)';
    }
    const { rows } = await db.query(`${SELECT} WHERE ${where} ORDER BY r.created_at DESC LIMIT 50`, params);
    res.json(rows.map(map.reservation));
  }));

  r.get('/:id', wrap(async (req, res) => {
    res.json(map.reservation(await getOwn(req)));
  }));

  // Huy dat cho (mien phi, khong tinh vi pham)
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

  // Gia han giu cho: toi da RULES.extend.maxTimes lan, moi lan RULES.extend.min..max phut, chi khi chua het gio
  r.post('/:id/extend', wrap(async (req, res) => {
    const row = await getOwn(req);
    const { maxTimes, min, max } = RULES.extend;
    const minutes = v.int(req.body, 'minutes', { min, max });
    requireActive(row);
    if (new Date(row.expires_at) <= new Date()) throw conflict('reservation_expired', 'Dat cho da het gio giu');
    if (row.extend_count >= maxTimes) throw conflict('extend_limit', `Chi duoc gia han toi da ${maxTimes} lan`);
    const ack = await device.sendCommand(row.lot_id, { action: 'extend_reservation', slot: row.slot_number, minutes });
    if (!ack) throw new HttpError(504, 'device_timeout', 'Thiet bi khong phan hoi');
    if (!ack.ok) throw conflict(ack.error || 'device_error', 'Thiet bi tu choi');
    const upd = await db.one(
      `UPDATE reservations SET minutes = minutes + $2, expires_at = expires_at + make_interval(mins => $2),
         extend_count = extend_count + 1, updated_at = now() WHERE id = $1 RETURNING *`, [row.id, minutes]);
    res.json(map.reservation({ ...row, ...upd }));
  }));

  return r;
};
