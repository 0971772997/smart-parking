// HO TRO KHACH HANG + BAO CAO SU CO (gan tai /api)
//   GET   /support/info                      lien he (hotline, email...), danh muc, cau hoi thuong gap (cong khai)
//   POST  /support/tickets                   gui yeu cau / bao cao { kind: support|incident, category, subject, description,
//                                            lotId?, slotNumber?, sessionId?, reservationId? }
//   GET   /support/tickets                   cua toi; admin: ?scope=all  (?status=open,in_progress  ?kind=incident)
//   GET   /support/tickets/:id               chi tiet + trao doi
//   POST  /support/tickets/:id/messages      nhan tin { body } (tai xe nhan vao yeu cau da xong -> mo lai)
//   PATCH /support/tickets/:id               { status }  admin: moi trang thai; tai xe: chi 'closed'
const express = require('express');
const { wrap, badRequest, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const { notify } = require('../sessions');
const { audit } = require('../admin');
const { SUPPORT_CATEGORIES, HIGH_PRIORITY, TICKET_STATUSES, CONTACT, FAQ, ticketCode, displayName } = require('../feedback');

const STATUS_LABEL = { open: 'Đã tiếp nhận', in_progress: 'Đang xử lý', resolved: 'Đã giải quyết', closed: 'Đã đóng' };
const MAX_PER_HOUR = 5;

const TICKET_SELECT = `
  SELECT t.*, l.name AS lot_name, u.full_name, u.username, u.email, u.phone,
         (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count,
         (SELECT MAX(created_at) FROM support_messages m WHERE m.ticket_id = t.id) AS last_message_at,
         (SELECT m.staff FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_from_staff
  FROM support_tickets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN parking_lots l ON l.id = t.lot_id`;

const ticketView = (t, me) => ({
  id: t.id, code: t.code, kind: t.kind, category: t.category,
  categoryLabel: SUPPORT_CATEGORIES[t.kind]?.[t.category] || t.category,
  subject: t.subject, description: t.description, priority: t.priority,
  status: t.status, statusLabel: STATUS_LABEL[t.status],
  lotId: t.lot_id, lotName: t.lot_name ?? null, slotNumber: t.slot_number,
  sessionId: t.session_id, reservationId: t.reservation_id,
  messageCount: t.message_count ?? 0, lastMessageAt: t.last_message_at ?? null,
  awaitingReply: t.last_from_staff == null ? t.status === 'open' : !t.last_from_staff, // nhan vien chua tra loi tin cuoi
  createdAt: t.created_at, updatedAt: t.updated_at, resolvedAt: t.resolved_at,
  ...(me?.role === 'admin' && { reporter: { id: t.user_id, name: displayName(t), email: t.email, phone: t.phone } }),
  canReply: t.status !== 'closed' || me?.role === 'admin',
  canClose: t.status !== 'closed',
});

const messageView = (m) => ({ id: m.id, staff: m.staff, body: m.body, author: m.staff ? 'Nhân viên hỗ trợ' : displayName(m), createdAt: m.created_at });

module.exports = function supportRoutes({ db, auth }) {
  const r = express.Router();
  const user = auth.requireAuth;

  async function getTicket(req) {
    const id = v.int(req.params, 'id', { min: 1 });
    const t = await db.one(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
    if (!t || (t.user_id !== req.user.id && req.user.role !== 'admin')) throw notFound('ticket_not_found', 'Khong tim thay yeu cau');
    return t;
  }

  async function notifyAdmins(t) {
    const { rows } = await db.query(`SELECT id FROM users WHERE role = 'admin' AND id <> $1`, [t.user_id]);
    for (const a of rows) {
      await notify(db, { userId: a.id, type: 'support_new', key: `t${t.id}:new:${a.id}`,
        title: `${t.kind === 'incident' ? 'Báo cáo sự cố' : 'Yêu cầu hỗ trợ'} mới ${t.code}${t.priority === 'high' ? ' • KHẨN' : ''}`,
        body: t.subject, data: { ticketId: t.id } });
    }
  }

  r.get('/support/info', (_req, res) => {
    res.json({ contact: CONTACT, categories: SUPPORT_CATEGORIES, faq: FAQ, statuses: STATUS_LABEL });
  });

  r.post('/support/tickets', user, wrap(async (req, res) => {
    const kind = v.str(req.body, 'kind', { max: 10 });
    if (!SUPPORT_CATEGORIES[kind]) throw badRequest('validation_error', "'kind' phai la support | incident");
    const category = v.str(req.body, 'category', { max: 20 });
    if (!SUPPORT_CATEGORIES[kind][category]) throw badRequest('validation_error', "'category' khong hop le");
    const subject = v.str(req.body, 'subject', { min: 3, max: 120 });
    const description = v.str(req.body, 'description', { min: 10, max: 2000 });
    let lotId = v.str(req.body, 'lotId', { max: 50, optional: true });
    const slotNumber = v.int(req.body, 'slotNumber', { min: 1, max: 1000, optional: true });
    const sessionId = v.int(req.body, 'sessionId', { min: 1, optional: true });
    const reservationId = v.int(req.body, 'reservationId', { min: 1, optional: true });

    // Gan luot gui xe / dat cho: phai la cua minh; lay bai do tu do neu chua chon
    if (sessionId) {
      const s = await db.one(
        `SELECT s.lot_id FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id LEFT JOIN reservations r ON r.id = ps.reservation_id
         WHERE ps.id = $1 AND COALESCE(ps.user_id, r.user_id) = $2`, [sessionId, req.user.id]);
      if (!s) throw notFound('session_not_found', 'Khong tim thay luot do');
      lotId = lotId || s.lot_id;
    }
    if (reservationId) {
      const x = await db.one(
        'SELECT s.lot_id FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = $1 AND r.user_id = $2', [reservationId, req.user.id]);
      if (!x) throw notFound('reservation_not_found', 'Khong tim thay dat cho');
      lotId = lotId || x.lot_id;
    }
    if (lotId && !(await db.one('SELECT 1 FROM parking_lots WHERE id = $1', [lotId]))) throw notFound('lot_not_found', 'Khong tim thay bai do');
    if (kind === 'incident' && !lotId) throw badRequest('lot_required', 'Bao cao su co can chon bai do');

    const recent = (await db.one(
      `SELECT COUNT(*)::int AS n FROM support_tickets WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [req.user.id])).n;
    if (recent >= MAX_PER_HOUR) throw new HttpError(429, 'too_many_tickets', 'Ban gui qua nhieu yeu cau, vui long doi');

    const priority = kind === 'incident' && HIGH_PRIORITY.has(category) ? 'high' : 'normal';
    let t;
    for (let i = 0; !t; i += 1) {
      try {
        t = await db.one(
          `INSERT INTO support_tickets (code, user_id, kind, category, subject, description, lot_id, slot_number, session_id,
             reservation_id, priority) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [ticketCode(kind), req.user.id, kind, category, subject, description, lotId, slotNumber, sessionId, reservationId, priority]);
      } catch (e) {
        if (e.code !== '23505' || i >= 3) throw e; // trung ma -> sinh lai
      }
    }
    await notifyAdmins(t);
    res.status(201).json(ticketView(await db.one(`${TICKET_SELECT} WHERE t.id = $1`, [t.id]), req.user));
  }));

  r.get('/support/tickets', user, wrap(async (req, res) => {
    const all = req.query.scope === 'all' && req.user.role === 'admin';
    const statuses = req.query.status ? String(req.query.status).split(',').filter((s) => TICKET_STATUSES.includes(s)) : null;
    const kind = SUPPORT_CATEGORIES[req.query.kind] ? req.query.kind : null;
    const { rows } = await db.query(
      `${TICKET_SELECT} WHERE ($1::boolean OR t.user_id = $2) AND ($3::text[] IS NULL OR t.status = ANY($3))
         AND ($4::text IS NULL OR t.kind = $4)
       ORDER BY (t.status IN ('open', 'in_progress')) DESC, ${all ? "(t.priority = 'high') DESC," : ''} t.updated_at DESC LIMIT 100`,
      [all, req.user.id, statuses, kind]);
    res.json(rows.map((t) => ticketView(t, req.user)));
  }));

  r.get('/support/tickets/:id', user, wrap(async (req, res) => {
    const t = await getTicket(req);
    const { rows } = await db.query(
      `SELECT m.*, u.full_name, u.username, u.email FROM support_messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.ticket_id = $1 ORDER BY m.id`, [t.id]);
    res.json({ ...ticketView(t, req.user), messages: rows.map(messageView) });
  }));

  r.post('/support/tickets/:id/messages', user, wrap(async (req, res) => {
    const t = await getTicket(req);
    const body = v.str(req.body, 'body', { min: 1, max: 2000 });
    const staff = req.user.role === 'admin' && t.user_id !== req.user.id;
    if (t.status === 'closed' && !staff) throw conflict('ticket_closed', 'Yeu cau da dong, hay gui yeu cau moi');
    // Nhan vien tra loi -> dang xu ly; tai xe nhan vao yeu cau da giai quyet -> mo lai
    const next = staff ? (t.status === 'open' ? 'in_progress' : t.status) : (t.status === 'resolved' ? 'open' : t.status);
    const m = await db.tx(async (c) => {
      const row = (await c.query(
        'INSERT INTO support_messages (ticket_id, user_id, staff, body) VALUES ($1, $2, $3, $4) RETURNING *',
        [t.id, req.user.id, staff, body])).rows[0];
      await c.query(
        `UPDATE support_tickets SET status = $2::varchar, updated_at = now(), resolved_at = CASE WHEN $2::varchar = 'open' THEN NULL ELSE resolved_at END
         WHERE id = $1`, [t.id, next]);
      return row;
    });
    if (staff) {
      await notify(db, { userId: t.user_id, type: 'support_reply', key: `t${t.id}:msg:${m.id}`,
        title: `Phản hồi cho yêu cầu ${t.code}`, body: body.slice(0, 160), data: { ticketId: t.id } });
    }
    const u = await db.one('SELECT full_name, username, email FROM users WHERE id = $1', [req.user.id]);
    res.status(201).json({ message: messageView({ ...m, ...u }), status: next, statusLabel: STATUS_LABEL[next] });
  }));

  r.patch('/support/tickets/:id', user, wrap(async (req, res) => {
    const t = await getTicket(req);
    const status = v.str(req.body, 'status', { max: 12 });
    if (!TICKET_STATUSES.includes(status)) throw badRequest('validation_error', "'status' khong hop le");
    const admin = req.user.role === 'admin';
    if (!admin && status !== 'closed') throw new HttpError(403, 'forbidden', 'Tai xe chi dong duoc yeu cau');
    if (t.status === status) return res.json(ticketView(t, req.user));
    await db.query(
      `UPDATE support_tickets SET status = $2::varchar, updated_at = now(),
         resolved_at = CASE WHEN $2::varchar IN ('resolved', 'closed') THEN COALESCE(resolved_at, now()) ELSE NULL END WHERE id = $1`,
      [t.id, status]);
    if (admin) await audit(db, req, 'ticket.status', 'ticket', t.id, { code: t.code, from: t.status, to: status });
    if (admin && t.user_id !== req.user.id) {
      await notify(db, { userId: t.user_id, type: 'support_status', key: `t${t.id}:st:${status}:${Date.now()}`,
        title: `Yêu cầu ${t.code}: ${STATUS_LABEL[status]}`, body: t.subject, data: { ticketId: t.id, status } });
    }
    res.json(ticketView(await db.one(`${TICKET_SELECT} WHERE t.id = $1`, [t.id]), req.user));
  }));

  return r;
};
