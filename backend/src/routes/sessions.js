// PHIEN GUI XE cua tai xe + THONG BAO (gan tai /api)
//   GET   /sessions/active          phien dang hoat dong (xe con trong bai) + so thong bao chua doc
//   GET   /sessions/mine            lich su phien gui xe cua toi
//   GET   /sessions/:id             chi tiet phien + dong thoi gian (tu thong bao cua phien)
//   POST  /sessions/:id/extend      gia han thoi gian gui du kien { minutes }
//   PATCH /sessions/:id             cap nhat phien { vehicleId }
//   GET   /notifications            thong bao cua toi ?after=<id>&limit=&unread=1
//   POST  /notifications/read       danh dau da doc { ids: [..] } | { all: true }
const express = require('express');
const { wrap, badRequest, notFound, conflict } = require('../errors');
const v = require('../validate');
const { RULES } = require('../booking');
const { SESSION_SELECT, ACTIVE_WHERE, refreshAlerts, sessionView, notify, sessionFee, vnd, hhmm } = require('../sessions');

const notification = (n) => ({
  id: Number(n.id), type: n.type, title: n.title, body: n.body, data: n.data,
  sessionId: n.session_id, reservationId: n.reservation_id, read: !!n.read_at, createdAt: n.created_at,
});

module.exports = function sessionRoutes({ db, auth }) {
  const r = express.Router();
  const user = auth.requireAuth;

  const unreadCount = async (userId) =>
    (await db.one('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).n;

  async function getOwn(req) {
    const id = v.int(req.params, 'id', { min: 1 });
    const s = await db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [id]);
    if (!s || (s.owner_id !== req.user.id && req.user.role !== 'admin')) throw notFound('session_not_found', 'Khong tim thay luot do');
    return s;
  }

  r.get('/sessions/active', user, wrap(async (req, res) => {
    await refreshAlerts(db, req.user.id);
    const s = await db.one(
      `${SESSION_SELECT} WHERE ps.user_id = $1 AND ${ACTIVE_WHERE} ORDER BY ps.started_at DESC LIMIT 1`, [req.user.id]);
    res.json({ session: s ? sessionView(s) : null, unread: await unreadCount(req.user.id), rules: RULES.session });
  }));

  r.get('/sessions/mine', user, wrap(async (req, res) => {
    const { rows } = await db.query(
      `${SESSION_SELECT} WHERE COALESCE(ps.user_id, r.user_id) = $1 ORDER BY ps.started_at DESC LIMIT 50`, [req.user.id]);
    res.json(rows.map((s) => sessionView(s)));
  }));

  r.get('/sessions/:id', user, wrap(async (req, res) => {
    const s = await getOwn(req);
    if (s.owner_id === req.user.id) await refreshAlerts(db, req.user.id);
    const { rows } = await db.query(
      'SELECT * FROM notifications WHERE session_id = $1 ORDER BY id', [s.id]);
    res.json({ ...sessionView(s), timeline: rows.map(notification) });
  }));

  // Gia han: cong them phut vao gio gui du kien (khong can thiet bi - xe da trong bai)
  r.post('/sessions/:id/extend', user, wrap(async (req, res) => {
    const s = await getOwn(req);
    const ext = RULES.session.extend;
    const minutes = v.int(req.body, 'minutes', { min: 15, max: 240 });
    if (s.ended_at || s.exited_at) throw conflict('session_ended', 'Phien gui xe da ket thuc');
    if (!s.planned_end_at) throw conflict('session_not_extendable', 'Phien gui xe nay khong co gio du kien');
    if (s.extend_count >= ext.maxTimes) throw conflict('extend_limit', `Chi duoc gia han toi da ${ext.maxTimes} lan`);
    const total = (new Date(s.planned_end_at) - new Date(s.started_at)) / 60000 + minutes;
    if (total > ext.maxTotalMinutes) {
      throw conflict('extend_too_long', `Tong thoi gian gui toi da ${ext.maxTotalMinutes / 60} gio`);
    }
    const upd = await db.one(
      `UPDATE parking_sessions SET planned_end_at = planned_end_at + make_interval(mins => $2),
         extend_count = extend_count + 1, updated_at = now() WHERE id = $1 AND ended_at IS NULL RETURNING *`, [s.id, minutes]);
    if (!upd) throw conflict('session_ended', 'Phien gui xe da ket thuc');
    const planned = sessionFee({ startedAt: upd.started_at, endAt: upd.planned_end_at, pricePerHour: s.price_per_hour }).total;
    await notify(db, { userId: s.owner_id, sessionId: s.id, type: 'extended', key: `s${s.id}:ext:${upd.extend_count}`,
      title: `Đã gia hạn thêm ${minutes} phút`,
      body: `Giờ gửi dự kiến mới: ${hhmm(upd.planned_end_at)}. Phí dự kiến ${vnd(planned)}.`,
      data: { minutes, plannedEndAt: upd.planned_end_at, plannedFee: planned } });
    res.json(sessionView(await db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [s.id])));
  }));

  r.patch('/sessions/:id', user, wrap(async (req, res) => {
    const s = await getOwn(req);
    if (s.exited_at) throw conflict('session_ended', 'Phien gui xe da ket thuc');
    const vehicleId = v.int(req.body, 'vehicleId', { min: 1 });
    const veh = await db.one('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, s.owner_id]);
    if (!veh) throw badRequest('vehicle_not_found', 'Xe khong thuoc tai khoan nay');
    await db.query('UPDATE parking_sessions SET vehicle_id = $2, updated_at = now() WHERE id = $1', [s.id, vehicleId]);
    res.json(sessionView(await db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [s.id])));
  }));

  // ---------- Thong bao ----------
  r.get('/notifications', user, wrap(async (req, res) => {
    const after = v.int(req.query, 'after', { min: 0, def: 0 });
    const limit = v.int(req.query, 'limit', { min: 1, max: 100, def: 30 });
    await refreshAlerts(db, req.user.id);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const { rows } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND id > $2 AND ($4::boolean IS FALSE OR read_at IS NULL)
       ORDER BY id DESC LIMIT $3`, [req.user.id, after, limit, unreadOnly]);
    res.json({ items: rows.map(notification), unread: await unreadCount(req.user.id) });
  }));

  r.post('/notifications/read', user, wrap(async (req, res) => {
    const all = req.body && req.body.all === true;
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isSafeInteger) : [];
    if (!all && !ids.length) throw badRequest('validation_error', "Can 'ids' hoac 'all: true'");
    await db.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2 OR id = ANY($3))`,
      [req.user.id, all, ids]);
    res.json({ unread: await unreadCount(req.user.id) });
  }));

  return r;
};
