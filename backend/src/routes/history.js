// LICH SU DAT CHO & GUI XE cua tai xe, loc theo ngay (gio Viet Nam) - gan tai /api
//   GET /history?from=YYYY-MM-DD&to=YYYY-MM-DD&kind=all|sessions|reservations&lotId=
//   -> { from, to, items: [{ kind: 'session', at, session } | { kind: 'reservation', at, reservation }], summary }
//   Dat cho da thanh phien gui xe chi hien 1 lan (dang phien, kem ma dat cho) -> khong trung lap.
const express = require('express');
const { wrap } = require('../errors');
const map = require('../mappers');
const { RESERVATION_SELECT, expireStale } = require('../booking');
const { SESSION_SELECT, sessionView } = require('../sessions');
const { TZ, parseRange } = require('../dates');

module.exports = function historyRoutes({ db, auth }) {
  const r = express.Router();

  r.get('/history', auth.requireAuth, wrap(async (req, res) => {
    const { from, to } = parseRange(req.query, { days: 30, maxDays: 366 });
    const kind = ['sessions', 'reservations'].includes(req.query.kind) ? req.query.kind : 'all';
    const lotId = req.query.lotId ? String(req.query.lotId).slice(0, 50) : null;
    await expireStale(db);

    // [from 00:00, to+1 00:00) theo gio Viet Nam
    const range = (col) => `${col} >= ($2::date)::timestamp AT TIME ZONE '${TZ}' AND ${col} < ($3::date + 1)::timestamp AT TIME ZONE '${TZ}'
      AND ($4::text IS NULL OR s.lot_id = $4)`;
    const params = [req.user.id, from, to, lotId];
    const [ses, resv, counts] = await Promise.all([
      kind === 'reservations' ? { rows: [] } : db.query(
        `${SESSION_SELECT} WHERE COALESCE(ps.user_id, r.user_id) = $1 AND ${range('ps.started_at')}
         ORDER BY ps.started_at DESC LIMIT 300`, params),
      kind === 'sessions' ? { rows: [] } : db.query(
        `${RESERVATION_SELECT} WHERE r.user_id = $1 AND ${range('r.created_at')}
           AND NOT EXISTS (SELECT 1 FROM parking_sessions x WHERE x.reservation_id = r.id)
         ORDER BY r.created_at DESC LIMIT 300`, params),
      // Thong ke moi dat cho trong khoang (ke ca da thanh phien gui xe)
      db.one(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
                COUNT(*) FILTER (WHERE r.status = 'expired')::int AS expired,
                COUNT(*) FILTER (WHERE r.status = 'fulfilled' OR r.entered_at IS NOT NULL)::int AS used
         FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.user_id = $1 AND ${range('r.created_at')}`, params),
    ]);

    const now = Date.now();
    const sessions = ses.rows.map((s) => sessionView(s, now));
    const items = [
      ...sessions.map((s) => ({ kind: 'session', at: s.startedAt, session: s })),
      ...resv.rows.map((x) => ({ kind: 'reservation', at: x.created_at, reservation: map.reservation(x) })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    const final = sessions.filter((s) => s.cost.final);
    res.json({
      from, to, kind, lotId,
      items,
      summary: {
        sessions: sessions.length,
        ongoing: sessions.length - final.length,
        parkedSeconds: sessions.reduce((a, s) => a + (s.durationSeconds ?? s.elapsedSeconds ?? 0), 0),
        totalFee: final.reduce((a, s) => a + (s.cost.total || 0), 0),
        paid: final.filter((s) => s.paid).reduce((a, s) => a + (s.payment?.amount ?? s.cost.total ?? 0), 0),
        unpaid: final.filter((s) => !s.paid).reduce((a, s) => a + (s.cost.total || 0), 0),
        reservations: counts.total, reservationsUsed: counts.used, cancelled: counts.cancelled, noShows: counts.expired,
      },
    });
  }));

  return r;
};
