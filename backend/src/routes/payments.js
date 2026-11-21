// Luot do cua toi + thanh toan phi gui xe (cong thanh toan GIA LAP: tra ve thanh cong ngay)
// Gan tai /api (xac thuc tung route, khong dung r.use de API khong ton tai van tra 404)
//   GET  /sessions/mine              luot do cua toi (qua dat cho): dang do / chua thanh toan / da thanh toan
//   POST /sessions/:id/pay           tai xe thanh toan luot do da ket thuc { method }
//   GET  /payments                   lich su giao dich cua toi
//   GET  /payments/:id               chi tiet giao dich (bien lai)
//   POST /lots/:lotId/sessions/:id/pay  admin thu tien tai cong (ca khach vang lai)
const crypto = require('crypto');
const express = require('express');
const { wrap, badRequest, notFound, conflict } = require('../errors');
const v = require('../validate');
const map = require('../mappers');

const USER_METHODS = ['card', 'momo', 'zalopay', 'bank'];
const ADMIN_METHODS = ['cash', ...USER_METHODS];

// Phi tam tinh cho luot dang do (giong cach tinh khi xe ra: lam tron len theo gio, toi thieu 1 gio)
const RUNNING_FEE = `GREATEST(1, CEIL(EXTRACT(EPOCH FROM now() - ps.started_at) / 3600.0))::int * l.price_per_hour`;

const SESSION_SELECT = `
  SELECT ps.*, s.slot_number, s.lot_id, l.name AS lot_name, l.price_per_hour,
         CASE WHEN ps.ended_at IS NULL THEN ${RUNNING_FEE} END AS running_fee,
         r.user_id AS owner_id,
         p.id AS payment_id, p.code AS payment_code, p.method AS payment_method, p.created_at AS paid_at
  FROM parking_sessions ps
  JOIN slots s ON s.id = ps.slot_id
  JOIN parking_lots l ON l.id = s.lot_id
  LEFT JOIN reservations r ON r.id = ps.reservation_id
  LEFT JOIN payments p ON p.session_id = ps.id`;

const PAYMENT_SELECT = `
  SELECT p.*, s.slot_number, s.lot_id, l.name AS lot_name, ps.started_at, ps.ended_at, ps.duration_seconds
  FROM payments p
  JOIN parking_sessions ps ON ps.id = p.session_id
  JOIN slots s ON s.id = ps.slot_id
  JOIN parking_lots l ON l.id = s.lot_id`;

// Ma giao dich: GD + ngay (gio VN) + 6 ky tu ngau nhien
function newCode() {
  const d = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = crypto.randomBytes(6).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(6, 'X').slice(0, 6);
  return `GD${d}-${rnd}`;
}

function parseMethod(body, allowed) {
  const m = v.str(body, 'method', { max: 10 });
  if (!allowed.includes(m)) throw badRequest('validation_error', `'method' phai la ${allowed.join(' | ')}`);
  return m;
}

module.exports = function paymentRoutes({ db, auth }) {
  const r = express.Router();
  const user = auth.requireAuth;
  const admin = [auth.requireAuth, auth.requireAdmin];

  // Tao giao dich cho 1 luot do da ket thuc. Chong thanh toan 2 lan bang UNIQUE(session_id).
  async function pay(session, { userId, method, collectedBy }) {
    if (!session.ended_at) throw conflict('session_not_ended', 'Xe chua roi bai, chua thanh toan duoc');
    if (session.payment_id) throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
    try {
      const row = await db.one(
        `INSERT INTO payments (code, session_id, user_id, amount, method, collected_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [newCode(), session.id, userId, session.fee || 0, method, collectedBy || null]);
      return map.payment(await db.one(`${PAYMENT_SELECT} WHERE p.id = $1`, [row.id]));
    } catch (e) {
      if (e.code === '23505') throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
      throw e;
    }
  }

  // ---------- Tai xe ----------
  r.get('/sessions/mine', user, wrap(async (req, res) => {
    const { rows } = await db.query(
      `${SESSION_SELECT} WHERE r.user_id = $1 ORDER BY ps.started_at DESC LIMIT 50`, [req.user.id]);
    res.json(rows.map(map.mySession));
  }));

  r.post('/sessions/:id/pay', user, wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const method = parseMethod(req.body, USER_METHODS);
    const s = await db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [id]);
    if (!s || s.owner_id !== req.user.id) throw notFound('session_not_found', 'Khong tim thay luot do');
    res.status(201).json(await pay(s, { userId: req.user.id, method }));
  }));

  r.get('/payments', user, wrap(async (req, res) => {
    const limit = v.int(req.query, 'limit', { min: 1, max: 200, def: 50 });
    const { rows } = await db.query(
      `${PAYMENT_SELECT} WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT $2`, [req.user.id, limit]);
    res.json(rows.map(map.payment));
  }));

  r.get('/payments/:id', user, wrap(async (req, res) => {
    const row = await db.one(`${PAYMENT_SELECT} WHERE p.id = $1`, [v.int(req.params, 'id', { min: 1 })]);
    if (!row || (row.user_id !== req.user.id && req.user.role !== 'admin')) {
      throw notFound('payment_not_found', 'Khong tim thay giao dich');
    }
    res.json(map.payment(row));
  }));

  // ---------- Quan tri ----------
  r.post('/lots/:lotId/sessions/:id/pay', admin, wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const method = parseMethod({ method: 'cash', ...req.body }, ADMIN_METHODS);
    const s = await db.one(`${SESSION_SELECT} WHERE ps.id = $1 AND s.lot_id = $2`, [id, req.params.lotId]);
    if (!s) throw notFound('session_not_found', 'Khong tim thay luot do');
    res.status(201).json(await pay(s, { userId: s.owner_id || null, method, collectedBy: req.user.id }));
  }));

  return r;
};
