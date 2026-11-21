// Luot do cua toi + thanh toan phi gui xe (cong thanh toan GIA LAP: tra ve thanh cong ngay)
// Gan tai /api (xac thuc tung route, khong dung r.use de API khong ton tai van tra 404)
//   POST /sessions/:id/pay           tai xe thanh toan luot do da chot phi { method }
//                                    (vao bai nhung chua do o nao -> chot phi ngay luc thanh toan)
//   (danh sach / chi tiet phien gui xe: routes/sessions.js)
//   GET  /payments                   lich su giao dich cua toi
//   GET  /payments/:id               chi tiet giao dich (bien lai)
//   POST /lots/:lotId/sessions/:id/pay  admin thu tien tai cong (ca khach vang lai)
const crypto = require('crypto');
const express = require('express');
const { wrap, badRequest, notFound, conflict } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { SESSION_SELECT, closeSession, notify, vnd } = require('../sessions');

const USER_METHODS = ['card', 'momo', 'zalopay', 'bank'];
const ADMIN_METHODS = ['cash', ...USER_METHODS];
const METHOD_LABEL = { cash: 'tiền mặt', card: 'thẻ', momo: 'MoMo', zalopay: 'ZaloPay', bank: 'chuyển khoản' };

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
    if (session.payment_id) throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
    if (!session.ended_at) {
      // Qua cong vao nhung chua do o nao -> chot phi ngay bay gio de ra bai
      if (session.source !== 'gate' || session.parked_at) throw conflict('session_not_ended', 'Xe chua roi bai, chua thanh toan duoc');
      Object.assign(session, await closeSession(db, session.id));
    }
    try {
      const row = await db.one(
        `INSERT INTO payments (code, session_id, user_id, amount, method, collected_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [newCode(), session.id, userId, session.fee || 0, method, collectedBy || null]);
      const p = await db.one(`${PAYMENT_SELECT} WHERE p.id = $1`, [row.id]);
      await notify(db, { userId: session.owner_id, sessionId: session.id, type: 'paid', key: `s${session.id}:paid`,
        title: 'Thanh toán thành công',
        body: `Đã thanh toán ${vnd(p.amount)} bằng ${METHOD_LABEL[method]} • Mã GD ${p.code}. Quét mã QR cổng ra để rời bãi.`,
        data: { amount: p.amount, method, code: p.code } });
      return map.payment(p);
    } catch (e) {
      if (e.code === '23505') throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
      throw e;
    }
  }

  // ---------- Tai xe ----------
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
