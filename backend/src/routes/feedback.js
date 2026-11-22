// BAI DO YEU THICH + DANH GIA / PHAN HOI CO SO BAI DO (gan tai /api)
//   GET    /favorites                       bai do yeu thich cua toi (kem cho trong, danh gia)
//   PUT    /favorites/:lotId                them vao yeu thich (idempotent)
//   DELETE /favorites/:lotId                xoa khoi yeu thich
//   GET    /lots/:lotId/reviews             danh gia cong khai ?limit=&offset=&rating=  (+ mine neu da dang nhap)
//   GET    /lots/:lotId/reviews/mine        danh gia cua toi + co duoc danh gia khong (da gui xe o bai)
//   PUT    /lots/:lotId/reviews/mine        gui / sua danh gia { rating 1-5, tags?, comment? }
//   DELETE /lots/:lotId/reviews/mine        xoa danh gia cua toi
//   POST   /reviews/:id/reply               (admin) quan ly bai phan hoi danh gia { reply }  (reply rong = go phan hoi)
const express = require('express');
const { wrap, badRequest, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { notify } = require('../sessions');
const { REVIEW_TAGS, displayName } = require('../feedback');

const MAX_FAVORITES = 50;

const reviewView = (x, me) => ({
  id: x.id, lotId: x.lot_id, rating: x.rating, tags: x.tags || [], comment: x.comment,
  author: displayName(x), mine: !!me && x.user_id === me.id,
  reply: x.reply ? { text: x.reply, at: x.replied_at } : null,
  createdAt: x.created_at, updatedAt: x.updated_at, edited: new Date(x.updated_at) - new Date(x.created_at) > 60000,
});

// Tai xe da gui xe o bai nay chua (luot do da xong / da qua cong vao)? -> luot gan nhat
const lastVisit = (db, userId, lotId) => db.one(
  `SELECT ps.id FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id
   LEFT JOIN reservations r ON r.id = ps.reservation_id
   WHERE COALESCE(ps.user_id, r.user_id) = $1 AND s.lot_id = $2 ORDER BY ps.started_at DESC LIMIT 1`, [userId, lotId]);

module.exports = function feedbackRoutes({ db, auth }) {
  const r = express.Router();
  const user = auth.requireAuth;

  async function getLot(lotId) {
    const lot = await db.one('SELECT id, name FROM parking_lots WHERE id = $1', [String(lotId)]);
    if (!lot) throw notFound('lot_not_found', 'Khong tim thay bai do');
    return lot;
  }

  // ---------- Yeu thich ----------
  r.get('/favorites', user, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT l.*, f.created_at AS favorited_at,
              (SELECT COUNT(*) FROM slots s WHERE s.lot_id = l.id AND s.state = 'free') AS free_slots,
              rv.rating_avg, rv.rating_count
       FROM favorite_lots f JOIN parking_lots l ON l.id = f.lot_id
       LEFT JOIN LATERAL (SELECT AVG(rating) AS rating_avg, COUNT(*) AS rating_count FROM lot_reviews WHERE lot_id = l.id) rv ON true
       WHERE f.user_id = $1 ORDER BY f.created_at DESC`, [req.user.id]);
    res.json(rows.map((l) => ({ ...map.lot(l), favoritedAt: l.favorited_at })));
  }));

  r.put('/favorites/:lotId', user, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const n = (await db.one('SELECT COUNT(*)::int AS n FROM favorite_lots WHERE user_id = $1', [req.user.id])).n;
    const exists = await db.one('SELECT 1 FROM favorite_lots WHERE user_id = $1 AND lot_id = $2', [req.user.id, lot.id]);
    if (!exists && n >= MAX_FAVORITES) throw conflict('favorite_limit', `Toi da ${MAX_FAVORITES} bai yeu thich`);
    await db.query('INSERT INTO favorite_lots (user_id, lot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, lot.id]);
    res.status(exists ? 200 : 201).json({ lotId: lot.id, favorite: true });
  }));

  r.delete('/favorites/:lotId', user, wrap(async (req, res) => {
    await db.query('DELETE FROM favorite_lots WHERE user_id = $1 AND lot_id = $2', [req.user.id, String(req.params.lotId)]);
    res.json({ lotId: String(req.params.lotId), favorite: false });
  }));

  // ---------- Danh gia ----------
  r.get('/lots/:lotId/reviews', auth.optionalAuth, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const limit = v.int(req.query, 'limit', { min: 1, max: 50, def: 20 });
    const offset = v.int(req.query, 'offset', { min: 0, max: 100000, def: 0 });
    const rating = v.int(req.query, 'rating', { min: 1, max: 5, optional: true });
    const [list, agg, tags, mine] = await Promise.all([
      db.query(
        `SELECT rv.*, u.full_name, u.username, u.email FROM lot_reviews rv JOIN users u ON u.id = rv.user_id
         WHERE rv.lot_id = $1 AND ($4::int IS NULL OR rv.rating = $4)
         ORDER BY rv.updated_at DESC, rv.id DESC LIMIT $2 OFFSET $3`, [lot.id, limit, offset, rating]),
      db.one(
        `SELECT COUNT(*)::int AS count, AVG(rating) AS avg,
                COUNT(*) FILTER (WHERE rating = 1)::int AS r1, COUNT(*) FILTER (WHERE rating = 2)::int AS r2,
                COUNT(*) FILTER (WHERE rating = 3)::int AS r3, COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
                COUNT(*) FILTER (WHERE rating = 5)::int AS r5
         FROM lot_reviews WHERE lot_id = $1`, [lot.id]),
      db.query(
        `SELECT t AS tag, COUNT(*)::int AS count FROM lot_reviews, unnest(tags) t WHERE lot_id = $1
         GROUP BY t ORDER BY 2 DESC, 1 LIMIT 8`, [lot.id]),
      req.user ? db.one(
        `SELECT rv.*, u.full_name, u.username, u.email FROM lot_reviews rv JOIN users u ON u.id = rv.user_id
         WHERE rv.lot_id = $1 AND rv.user_id = $2`, [lot.id, req.user.id]) : null,
    ]);
    res.json({
      lotId: lot.id, lotName: lot.name,
      summary: {
        count: agg.count, average: agg.avg == null ? null : Math.round(Number(agg.avg) * 10) / 10,
        distribution: { 1: agg.r1, 2: agg.r2, 3: agg.r3, 4: agg.r4, 5: agg.r5 },
        topTags: tags.rows.map((t) => ({ ...t, label: REVIEW_TAGS[t.tag] || t.tag })),
      },
      items: list.rows.map((x) => reviewView(x, req.user)),
      mine: mine ? reviewView(mine, req.user) : null,
      tags: REVIEW_TAGS,
      hasMore: list.rows.length === limit,
    });
  }));

  r.get('/lots/:lotId/reviews/mine', user, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const [mine, visit] = await Promise.all([
      db.one(
        `SELECT rv.*, u.full_name, u.username, u.email FROM lot_reviews rv JOIN users u ON u.id = rv.user_id
         WHERE rv.lot_id = $1 AND rv.user_id = $2`, [lot.id, req.user.id]),
      lastVisit(db, req.user.id, lot.id),
    ]);
    res.json({ lotId: lot.id, lotName: lot.name, review: mine ? reviewView(mine, req.user) : null,
      eligible: !!visit, lastSessionId: visit?.id ?? null, tags: REVIEW_TAGS });
  }));

  r.put('/lots/:lotId/reviews/mine', user, wrap(async (req, res) => {
    const lot = await getLot(req.params.lotId);
    const rating = v.int(req.body, 'rating', { min: 1, max: 5 });
    const comment = v.str(req.body, 'comment', { max: 1000, optional: true });
    const rawTags = req.body?.tags ?? [];
    if (!Array.isArray(rawTags) || rawTags.length > 8 || rawTags.some((t) => !REVIEW_TAGS[t])) {
      throw badRequest('validation_error', "'tags' khong hop le");
    }
    const visit = await lastVisit(db, req.user.id, lot.id);
    if (!visit) throw new HttpError(403, 'review_not_eligible', 'Chi tai xe da gui xe o bai nay moi danh gia duoc');
    const row = await db.one(
      `INSERT INTO lot_reviews (user_id, lot_id, session_id, rating, tags, comment) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, lot_id) DO UPDATE SET rating = EXCLUDED.rating, tags = EXCLUDED.tags, comment = EXCLUDED.comment,
         session_id = EXCLUDED.session_id, updated_at = now()
       RETURNING *, (xmax = 0) AS inserted`, [req.user.id, lot.id, visit.id, rating, [...new Set(rawTags)], comment]);
    const u = await db.one('SELECT full_name, username, email FROM users WHERE id = $1', [req.user.id]);
    res.status(row.inserted ? 201 : 200).json(reviewView({ ...row, ...u }, req.user));
  }));

  r.delete('/lots/:lotId/reviews/mine', user, wrap(async (req, res) => {
    const del = await db.one('DELETE FROM lot_reviews WHERE lot_id = $1 AND user_id = $2 RETURNING id',
      [String(req.params.lotId), req.user.id]);
    if (!del) throw notFound('review_not_found', 'Ban chua danh gia bai nay');
    res.json({ ok: true });
  }));

  r.post('/reviews/:id/reply', user, auth.requireAdmin, wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const reply = v.str(req.body, 'reply', { max: 1000, optional: true });
    const row = await db.one(
      `UPDATE lot_reviews SET reply = $2::varchar, replied_by = CASE WHEN $2::varchar IS NULL THEN NULL ELSE $3::int END,
         replied_at = CASE WHEN $2::varchar IS NULL THEN NULL ELSE now() END WHERE id = $1 RETURNING *`, [id, reply, req.user.id]);
    if (!row) throw notFound('review_not_found', 'Khong tim thay danh gia');
    if (reply) {
      const lot = await db.one('SELECT name FROM parking_lots WHERE id = $1', [row.lot_id]);
      await notify(db, { userId: row.user_id, type: 'review_reply', key: `rv${row.id}:reply:${Date.parse(row.replied_at)}`,
        title: `${lot?.name || 'Bãi đỗ'} đã phản hồi đánh giá của bạn`, body: reply.slice(0, 160),
        data: { lotId: row.lot_id, reviewId: row.id } });
    }
    const u = await db.one('SELECT full_name, username, email FROM users WHERE id = $1', [row.user_id]);
    res.json(reviewView({ ...row, ...u }, req.user));
  }));

  return r;
};
