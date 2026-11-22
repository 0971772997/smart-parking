// TRANG QUAN TRI (chi admin) - gan tai /api/admin
//   GET   /overview?days=7                 so lieu tong quan + doanh thu theo ngay + tinh trang tung bai
//   GET   /users?q=&role=&status=&limit=&offset=      danh sach tai khoan (+ thong ke)
//   GET   /users/:id                       chi tiet: xe, dat cho, phien, giao dich, yeu cau ho tro gan day
//   PATCH /users/:id                       { fullName?, phone?, role?, locked?, lockedReason?, resetNoShows? }
//   GET   /lots                            bai do + cho trong / dang gui / doanh thu hom nay / danh gia
//   GET   /pricing?lotId=                  gia hien tai tung bai + lich su doi gia
//   POST  /pricing                         tang / giam gia { lotIds? (bo trong = tat ca), mode: percent|amount|set,
//                                          value, reason?, dryRun? (xem truoc), notify? (bao tai xe lien quan) }
//   GET   /reservations?status=&lotId=&q=&from=&to=   dat cho cua moi tai xe
//   POST  /reservations/:id/cancel         huy dat cho (thiet bi mat ket noi -> huy tren he thong)
//   GET   /sessions?state=active|unpaid|completed|all&lotId=&q=&from=&to=
//   POST  /sessions/:id/close              ket thuc phien bi treo { note?, waive? (mien phi) }
//   GET   /payments?from=&to=&method=&lotId=          giao dich + tong hop theo phuong thuc
//   GET   /reviews?rating=&unreplied=1&lotId=         danh gia moi bai
//   DELETE /reviews/:id                    go danh gia vi pham { reason? }
//   POST  /broadcast                       gui thong bao chung { title, body?, audience: all | lot:<lotId> }
//   GET   /broadcasts                      thong bao chung da gui
//   GET   /audit?limit=&offset=            nhat ky thao tac quan tri
const express = require('express');
const { wrap, badRequest, notFound, conflict } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { RESERVATION_SELECT, expireStale, RULES } = require('../booking');
const pricing = require('../pricing');
const { SESSION_SELECT, ACTIVE_WHERE, sessionView, closeSession, notify, vnd } = require('../sessions');
const { PAYMENT_SELECT, paymentView } = require('../payments');
const { REVIEW_TAGS, displayName } = require('../feedback');
const { parseRange, inRange, vnToday, addDays, TZ } = require('../dates');
const { audit, ACTION_LABEL } = require('../admin');

const PAGE_MAX = 100;
// Tim "co chua" (LIKE): thoat ky tu dai dien % _ \ trong tu khoa de tim dung nghia den
const like = (q) => (q ? `%${String(q).trim().toLowerCase().slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);

const userRow = (u) => ({
  id: u.id, email: u.email, username: u.username, fullName: u.full_name, phone: u.phone, role: u.role,
  displayName: displayName(u), locked: !!u.locked_at, lockedAt: u.locked_at, lockedReason: u.locked_reason,
  createdAt: u.created_at, linked: { google: !!u.google_id, facebook: !!u.facebook_id },
  ...(u.sessions !== undefined && {
    stats: {
      sessions: Number(u.sessions), reservations: Number(u.reservations), vehicles: Number(u.vehicles),
      totalPaid: Number(u.total_paid), lastActiveAt: u.last_active_at,
    },
  }),
});

const USER_STATS = `
  (SELECT COUNT(*) FROM parking_sessions ps WHERE ps.user_id = u.id) AS sessions,
  (SELECT COUNT(*) FROM reservations r WHERE r.user_id = u.id) AS reservations,
  (SELECT COUNT(*) FROM vehicles x WHERE x.user_id = u.id) AS vehicles,
  (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.user_id = u.id) AS total_paid,
  GREATEST((SELECT MAX(started_at) FROM parking_sessions ps WHERE ps.user_id = u.id),
           (SELECT MAX(created_at) FROM reservations r WHERE r.user_id = u.id)) AS last_active_at`;

module.exports = function adminRoutes({ db, auth, device, publicUrl, receiptSecret }) {
  const r = express.Router();
  r.use(auth.requireAuth, auth.requireAdmin);
  const payView = (p) => paymentView(p, { publicUrl, secret: receiptSecret });
  // Tai xe lien quan toi 1 bai (chua bi khoa): yeu thich / tung dat cho / tung gui xe. lotId null = tat ca tai xe
  const audienceOf = async (lotId) => (await db.query(
    `SELECT u.id FROM users u WHERE u.role = 'user' AND u.locked_at IS NULL AND ($1::text IS NULL
       OR EXISTS (SELECT 1 FROM favorite_lots f WHERE f.user_id = u.id AND f.lot_id = $1)
       OR EXISTS (SELECT 1 FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.user_id = u.id AND s.lot_id = $1)
       OR EXISTS (SELECT 1 FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id WHERE ps.user_id = u.id AND s.lot_id = $1))`,
    [lotId])).rows;
  const page = (q) => ({
    limit: v.int(q, 'limit', { min: 1, max: PAGE_MAX, def: 30 }),
    offset: v.int(q, 'offset', { min: 0, max: 1000000, def: 0 }),
  });

  // ---------- Tong quan ----------
  r.get('/overview', wrap(async (req, res) => {
    const days = v.int(req.query, 'days', { min: 7, max: 90, def: 7 });
    await expireStale(db);
    const today = vnToday();
    const from = addDays(today, -(days - 1));
    const at = (col) => inRange(col, 1, 1); // trong ngay hom nay (tham so $1)
    const [users, lots, slots, act, tday, pend, series, perLot] = await Promise.all([
      db.one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE role = 'admin')::int AS admins,
                COUNT(*) FILTER (WHERE locked_at IS NOT NULL)::int AS locked,
                COUNT(*) FILTER (WHERE ${at('created_at')})::int AS new_today FROM users`, [today]),
      db.one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE online)::int AS online,
                COUNT(*) FILTER (WHERE NOT booking_enabled)::int AS paused FROM parking_lots`),
      db.one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE state = 'free')::int AS free,
                COUNT(*) FILTER (WHERE state = 'occupied')::int AS occupied, COUNT(*) FILTER (WHERE state = 'reserved')::int AS reserved
              FROM slots`),
      db.one(`SELECT COUNT(*)::int AS n FROM parking_sessions ps WHERE ${ACTIVE_WHERE}`),
      db.one(`SELECT
                (SELECT COUNT(*) FROM parking_sessions WHERE ${at('started_at')})::int AS sessions,
                (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE ${at('created_at')})::int AS revenue,
                (SELECT COUNT(*) FROM payments WHERE ${at('created_at')})::int AS payments,
                (SELECT COUNT(*) FROM reservations WHERE ${at('created_at')})::int AS reservations,
                (SELECT COUNT(*) FROM reservations WHERE status = 'expired' AND ${at('updated_at')})::int AS no_shows`, [today]),
      db.one(`SELECT
                (SELECT COUNT(*) FROM parking_sessions ps LEFT JOIN payments p ON p.session_id = ps.id
                   WHERE ps.ended_at IS NOT NULL AND ps.fee > 0 AND p.id IS NULL)::int AS unpaid,
                (SELECT COALESCE(SUM(ps.fee), 0) FROM parking_sessions ps LEFT JOIN payments p ON p.session_id = ps.id
                   WHERE ps.ended_at IS NOT NULL AND ps.fee > 0 AND p.id IS NULL)::int AS unpaid_amount,
                (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open', 'in_progress'))::int AS open_tickets,
                (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open', 'in_progress') AND priority = 'high')::int AS urgent_tickets,
                (SELECT COUNT(*) FROM lot_reviews WHERE reply IS NULL)::int AS unreplied_reviews,
                (SELECT COUNT(*) FROM reservations WHERE status IN ('pending', 'active'))::int AS active_reservations`),
      db.query(`
        SELECT to_char(d, 'YYYY-MM-DD') AS date,
               COALESCE((SELECT SUM(amount) FROM payments p
                         WHERE (p.created_at AT TIME ZONE '${TZ}')::date = d), 0)::int AS revenue,
               (SELECT COUNT(*) FROM parking_sessions ps WHERE (ps.started_at AT TIME ZONE '${TZ}')::date = d)::int AS sessions
        FROM generate_series($1::date, $2::date, interval '1 day') d ORDER BY d`, [from, today]),
      db.query(`
        SELECT l.id, l.name, l.online, l.booking_enabled, l.total_slots, l.last_seen_at, l.price_per_hour,
               COUNT(s.id) FILTER (WHERE s.state = 'free')::int AS free,
               COUNT(s.id) FILTER (WHERE s.state = 'occupied')::int AS occupied,
               COUNT(s.id) FILTER (WHERE s.state = 'reserved')::int AS reserved,
               (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN parking_sessions ps ON ps.id = p.session_id
                  JOIN slots x ON x.id = ps.slot_id WHERE x.lot_id = l.id AND ${at('p.created_at')})::int AS revenue_today,
               (SELECT ROUND(AVG(rating), 1) FROM lot_reviews WHERE lot_id = l.id) AS rating
        FROM parking_lots l LEFT JOIN slots s ON s.lot_id = l.id GROUP BY l.id ORDER BY l.name`, [today]),
    ]);
    res.json({
      today,
      users: { total: users.total, admins: users.admins, locked: users.locked, newToday: users.new_today },
      lots: { total: lots.total, online: lots.online, paused: lots.paused },
      slots: { ...slots, carsInLots: act.n },
      todayStats: { sessions: tday.sessions, revenue: tday.revenue, payments: tday.payments, reservations: tday.reservations, noShows: tday.no_shows },
      pending: {
        unpaidSessions: pend.unpaid, unpaidAmount: pend.unpaid_amount, openTickets: pend.open_tickets,
        urgentTickets: pend.urgent_tickets, unrepliedReviews: pend.unreplied_reviews, activeReservations: pend.active_reservations,
      },
      series: series.rows,
      lotStatus: perLot.rows.map((l) => ({
        id: l.id, name: l.name, online: l.online, bookingEnabled: l.booking_enabled, totalSlots: l.total_slots,
        free: l.free, occupied: l.occupied, reserved: l.reserved, revenueToday: l.revenue_today,
        rating: l.rating == null ? null : Number(l.rating), lastSeenAt: l.last_seen_at, pricePerHour: l.price_per_hour,
      })),
    });
  }));

  // ---------- Nguoi dung ----------
  r.get('/users', wrap(async (req, res) => {
    const { limit, offset } = page(req.query);
    const role = ['user', 'admin'].includes(req.query.role) ? req.query.role : null;
    const status = ['locked', 'active'].includes(req.query.status) ? req.query.status : null;
    const where = `($1::text IS NULL OR lower(u.email) LIKE $1 OR lower(u.username) LIKE $1 OR lower(u.full_name) LIKE $1
        OR u.phone LIKE $1 OR EXISTS (SELECT 1 FROM vehicles x WHERE x.user_id = u.id AND lower(x.plate_number) LIKE $1))
      AND ($2::text IS NULL OR u.role = $2)
      AND ($3::text IS NULL OR ($3 = 'locked') = (u.locked_at IS NOT NULL))`;
    const params = [like(req.query.q), role, status];
    const [list, total] = await Promise.all([
      db.query(`SELECT u.*, ${USER_STATS} FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
        [...params, limit, offset]),
      db.one(`SELECT COUNT(*)::int AS n FROM users u WHERE ${where}`, params),
    ]);
    res.json({ items: list.rows.map(userRow), total: total.n, limit, offset });
  }));

  async function loadUser(id) {
    const u = await db.one(`SELECT u.*, ${USER_STATS} FROM users u WHERE u.id = $1`, [id]);
    if (!u) throw notFound('user_not_found', 'Khong tim thay tai khoan');
    return u;
  }

  r.get('/users/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const u = await loadUser(id);
    const [veh, resv, ses, pays, tickets, noShows] = await Promise.all([
      db.query('SELECT * FROM vehicles WHERE user_id = $1 ORDER BY id', [id]),
      db.query(`${RESERVATION_SELECT} WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [id]),
      db.query(`${SESSION_SELECT} WHERE COALESCE(ps.user_id, r.user_id) = $1 ORDER BY ps.started_at DESC LIMIT 10`, [id]),
      db.query(`${PAYMENT_SELECT} WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 10`, [id]),
      db.query(`SELECT id, code, kind, subject, status, created_at FROM support_tickets WHERE user_id = $1 ORDER BY id DESC LIMIT 5`, [id]),
      db.one(`SELECT COUNT(*)::int AS n FROM reservations WHERE user_id = $1 AND status = 'expired'
                AND updated_at > now() - interval '7 days' AND updated_at > COALESCE($2::timestamptz, '-infinity')`, [id, u.noshow_reset_at]),
    ]);
    res.json({
      ...userRow(u),
      noShows7d: noShows.n, noShowResetAt: u.noshow_reset_at,
      vehicles: veh.rows.map(map.vehicle),
      reservations: resv.rows.map(map.reservation),
      sessions: ses.rows.map((s) => sessionView(s)),
      payments: pays.rows.map(payView),
      tickets: tickets.rows.map((t) => ({ id: t.id, code: t.code, kind: t.kind, subject: t.subject, status: t.status, createdAt: t.created_at })),
    });
  }));

  r.patch('/users/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const u = await loadUser(id);
    const b = req.body || {};
    const fullName = v.str(b, 'fullName', { max: 100, optional: true });
    const phone = v.str(b, 'phone', { max: 20, optional: true, pattern: /^\+?\d{8,15}$/ });
    const role = b.role === undefined ? null : b.role;
    if (role !== null && !['user', 'admin'].includes(role)) throw badRequest('validation_error', "'role' phai la user | admin");
    const locked = b.locked === undefined ? null : b.locked;
    if (locked !== null && typeof locked !== 'boolean') throw badRequest('validation_error', "'locked' phai la true/false");
    const reason = v.str(b, 'lockedReason', { max: 200, optional: true });
    const self = id === req.user.id;
    if (self && (locked === true || role === 'user')) throw conflict('cannot_modify_self', 'Khong the tu khoa / ha quyen chinh minh');

    const upd = await db.one(
      `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone), role = COALESCE($4, role),
         locked_at = CASE WHEN $5::boolean IS NULL THEN locked_at WHEN $5 THEN COALESCE(locked_at, now()) ELSE NULL END,
         locked_reason = CASE WHEN $5::boolean IS NULL THEN locked_reason WHEN $5 THEN $6::varchar ELSE NULL END,
         noshow_reset_at = CASE WHEN $7 THEN now() ELSE noshow_reset_at END
       WHERE id = $1 RETURNING *`,
      [id, fullName, phone, role, locked, reason, b.resetNoShows === true]);
    auth.forget(id);
    if (role && role !== u.role) await audit(db, req, 'user.role', 'user', id, { from: u.role, to: role, email: u.email });
    if (locked === true && !u.locked_at) await audit(db, req, 'user.lock', 'user', id, { reason, email: u.email });
    if (locked === false && u.locked_at) await audit(db, req, 'user.unlock', 'user', id, { email: u.email });
    if (b.resetNoShows === true) {
      await audit(db, req, 'user.reset_noshow', 'user', id, { email: u.email });
      await notify(db, { userId: id, type: 'admin_notice', key: `u${id}:noshow:${Date.now()}`,
        title: 'Đã gỡ khoá đặt chỗ', body: 'Quản trị viên đã xoá các lần không đến gần đây. Bạn có thể đặt chỗ lại.' });
    }
    if (fullName || phone) await audit(db, req, 'user.update', 'user', id, { fullName, phone });
    res.json(userRow({ ...(await loadUser(id)), ...upd }));
  }));

  // ---------- Bai do ----------
  r.get('/lots', wrap(async (req, res) => {
    const today = vnToday();
    const { rows } = await db.query(`
      SELECT l.*, COUNT(s.id) FILTER (WHERE s.state = 'free') AS free_slots,
             COUNT(s.id) FILTER (WHERE s.state = 'occupied')::int AS occupied,
             COUNT(s.id) FILTER (WHERE s.state = 'reserved')::int AS reserved,
             rv.rating_avg, rv.rating_count,
             (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN parking_sessions ps ON ps.id = p.session_id
                JOIN slots x ON x.id = ps.slot_id WHERE x.lot_id = l.id AND ${inRange('p.created_at', 1, 1)})::int AS revenue_today,
             (SELECT COUNT(*) FROM parking_sessions ps JOIN slots x ON x.id = ps.slot_id WHERE x.lot_id = l.id AND ${ACTIVE_WHERE})::int AS cars
      FROM parking_lots l LEFT JOIN slots s ON s.lot_id = l.id
      LEFT JOIN LATERAL (SELECT AVG(rating) AS rating_avg, COUNT(*) AS rating_count FROM lot_reviews WHERE lot_id = l.id) rv ON true
      GROUP BY l.id, rv.rating_avg, rv.rating_count ORDER BY l.name`, [today]);
    res.json(rows.map((l) => ({ ...map.lot(l), occupied: l.occupied, reserved: l.reserved, revenueToday: l.revenue_today, carsInLot: l.cars })));
  }));

  // ---------- Gia gui xe ----------
  r.get('/pricing', wrap(async (req, res) => {
    const lotId = req.query.lotId ? String(req.query.lotId) : null;
    const lots = (await db.query(`
      SELECT l.id, l.name, l.price_per_hour, l.booking_enabled, l.online,
             (SELECT COUNT(*) FROM parking_sessions ps JOIN slots x ON x.id = ps.slot_id WHERE x.lot_id = l.id AND ps.ended_at IS NULL)::int AS open_sessions,
             (SELECT COUNT(*) FROM reservations r JOIN slots x ON x.id = r.slot_id WHERE x.lot_id = l.id AND r.status IN ('pending', 'active'))::int AS open_reservations,
             (SELECT MAX(created_at) FROM price_changes pc WHERE pc.lot_id = l.id) AS last_changed_at
      FROM parking_lots l ORDER BY l.name`)).rows;
    const history = (await db.query(`
      SELECT pc.*, l.name AS lot_name, u.full_name AS by_name, u.email AS by_email
      FROM price_changes pc JOIN parking_lots l ON l.id = pc.lot_id LEFT JOIN users u ON u.id = pc.changed_by
      WHERE ($1::text IS NULL OR pc.lot_id = $1) ORDER BY pc.id DESC LIMIT 50`, [lotId])).rows;
    res.json({
      lots: lots.map((l) => ({ id: l.id, name: l.name, pricePerHour: l.price_per_hour, bookingEnabled: l.booking_enabled,
        online: l.online, openSessions: l.open_sessions, openReservations: l.open_reservations, lastChangedAt: l.last_changed_at })),
      history: history.map(pricing.changeView),
      rules: { roundTo: pricing.ROUND_TO, maxPrice: pricing.MAX_PRICE, limits: pricing.LIMITS,
        overtimeRate: RULES.session.overtimeRate, overtimeGraceMinutes: RULES.session.overtimeGraceMinutes },
    });
  }));

  r.post('/pricing', wrap(async (req, res) => {
    const { mode, value } = pricing.parseAdjustment(req.body);
    const reason = v.str(req.body, 'reason', { max: 200, optional: true }) || null;
    const dryRun = req.body?.dryRun === true;
    const wantNotify = req.body?.notify === true;
    let ids = req.body?.lotIds;
    if (ids !== undefined && ids !== null) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((x) => typeof x !== 'string' || !x || x.length > 50)) {
        throw badRequest('validation_error', "'lotIds' phai la danh sach ma bai (1-100)");
      }
      ids = [...new Set(ids)];
    } else ids = null;
    const lots = (await db.query(
      'SELECT id, name, price_per_hour FROM parking_lots WHERE ($1::text[] IS NULL OR id = ANY($1)) ORDER BY id', [ids])).rows;
    if (ids && lots.length !== ids.length) {
      const missing = ids.filter((id) => !lots.some((l) => l.id === id));
      throw Object.assign(notFound('lot_not_found', 'Khong tim thay bai do'), { details: { lotIds: missing } });
    }
    const view = (c) => ({ lotId: c.lotId, name: c.name, oldPrice: c.oldPrice, newPrice: c.newPrice, diff: c.newPrice - c.oldPrice,
      percent: c.oldPrice > 0 ? Math.round(((c.newPrice - c.oldPrice) / c.oldPrice) * 1000) / 10 : null });
    if (dryRun) {
      const changes = lots.map((l) => ({ lotId: l.id, name: l.name, oldPrice: l.price_per_hour, newPrice: pricing.adjustPrice(l.price_per_hour, mode, value) }))
        .filter((c) => c.newPrice !== c.oldPrice);
      return res.json({ applied: false, mode, value, changes: changes.map(view), unchanged: lots.length - changes.length, notified: 0 });
    }
    // Ap dung trong 1 transaction, khoa tung bai (theo thu tu id): 2 admin bam cung luc -> lan sau tinh tren gia moi nhat
    const changes = await db.tx(async (q) => {
      const out = [];
      for (const l of lots) {
        const c = await pricing.setLotPrice(q, l.id, (old) => pricing.adjustPrice(old, mode, value), { by: req.user.id, reason });
        if (c) out.push(c);
      }
      return out;
    });
    let notified = 0;
    if (wantNotify) {
      for (const c of changes) {
        const up = c.newPrice > c.oldPrice;
        const title = `${c.name} ${up ? 'tăng' : 'giảm'} giá gửi xe`;
        const body = `Giá mới ${vnd(c.newPrice)}/giờ (trước đây ${vnd(c.oldPrice)}/giờ), áp dụng cho lượt đặt chỗ và gửi xe mới. Xe đang gửi giữ nguyên giá cũ.`
          + (reason ? ` Lý do: ${reason}` : '');
        for (const u of await audienceOf(c.lotId)) {
          const n = await notify(db, { userId: u.id, type: 'announcement', key: `price${c.id}:${u.id}`, title, body,
            data: { lotId: c.lotId, oldPrice: c.oldPrice, newPrice: c.newPrice } });
          if (n) notified += 1;
        }
      }
    }
    if (changes.length) {
      await audit(db, req, 'lot.price', 'lot', changes.length === 1 ? changes[0].lotId : null,
        { mode, value, reason, notified, changes: changes.map((c) => ({ lotId: c.lotId, oldPrice: c.oldPrice, newPrice: c.newPrice })) });
    }
    res.json({ applied: true, mode, value, changes: changes.map(view), unchanged: lots.length - changes.length, notified });
  }));

  // ---------- Dat cho ----------
  r.get('/reservations', wrap(async (req, res) => {
    const { limit, offset } = page(req.query);
    const { from, to } = parseRange(req.query, { days: 30 });
    await expireStale(db);
    const statuses = req.query.status ? String(req.query.status).split(',').slice(0, 6) : null;
    const where = `${inRange('r.created_at', 1, 2)} AND ($3::text[] IS NULL OR r.status = ANY($3))
      AND ($4::text IS NULL OR s.lot_id = $4)
      AND ($5::text IS NULL OR lower(r.code) LIKE $5 OR lower(veh.plate_number) LIKE $5 OR lower(u.email) LIKE $5 OR lower(u.full_name) LIKE $5)`;
    const params = [from, to, statuses, req.query.lotId ? String(req.query.lotId) : null, like(req.query.q)];
    const sel = RESERVATION_SELECT.replace('FROM reservations r', ', u.email AS user_email, u.full_name AS user_full_name, u.username AS user_username FROM reservations r JOIN users u ON u.id = r.user_id');
    const [list, total] = await Promise.all([
      db.query(`${sel} WHERE ${where} ORDER BY r.created_at DESC LIMIT $6 OFFSET $7`, [...params, limit, offset]),
      db.one(`SELECT COUNT(*)::int AS n FROM reservations r JOIN slots s ON s.id = r.slot_id JOIN users u ON u.id = r.user_id
              LEFT JOIN vehicles veh ON veh.id = r.vehicle_id WHERE ${where}`, params),
    ]);
    res.json({
      from, to, total: total.n, limit, offset,
      items: list.rows.map((x) => ({
        ...map.reservation(x), userId: x.user_id,
        user: { id: x.user_id, email: x.user_email, name: displayName({ full_name: x.user_full_name, username: x.user_username, email: x.user_email }) },
      })),
    });
  }));

  r.post('/reservations/:id/cancel', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const reason = v.str(req.body, 'reason', { max: 200, optional: true });
    const row = await db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [id]);
    if (!row) throw notFound('reservation_not_found', 'Khong tim thay dat cho');
    if (!['active', 'pending'].includes(row.status)) throw conflict('reservation_not_active', `Dat cho dang o trang thai '${row.status}'`);
    // Bao thiet bi nha o (neu dang ket noi); thiet bi khong phan hoi -> van huy tren he thong
    let deviceAck = null;
    if (row.online && row.status === 'active') {
      deviceAck = await device.sendCommand(row.lot_id, { action: 'cancel_reservation', slot: row.slot_number }).catch(() => null);
    }
    await db.query(`UPDATE reservations SET status = 'cancelled', error = 'admin_cancelled', updated_at = now()
                    WHERE id = $1 AND status IN ('active', 'pending')`, [id]);
    await db.query(`UPDATE slots SET state = 'free', updated_at = now() WHERE id = $1 AND state = 'reserved'`, [row.slot_id]);
    await audit(db, req, 'reservation.cancel', 'reservation', id, { code: row.code, reason, device: deviceAck ? deviceAck.ok : null });
    await notify(db, { userId: row.user_id, reservationId: id, type: 'admin_notice', key: `r${id}:admin_cancel`,
      title: `Đặt chỗ ${row.code} đã bị huỷ`, body: reason ? `Lý do: ${reason}` : 'Quản trị viên đã huỷ lượt đặt chỗ này. Bạn không bị tính phí.' });
    res.json({ ...map.reservation({ ...row, status: 'cancelled', error: 'admin_cancelled' }), deviceConfirmed: deviceAck ? !!deviceAck.ok : false });
  }));

  // ---------- Phien gui xe ----------
  r.get('/sessions', wrap(async (req, res) => {
    const { limit, offset } = page(req.query);
    const state = ['active', 'unpaid', 'completed'].includes(req.query.state) ? req.query.state : 'all';
    const useRange = state !== 'active' && state !== 'unpaid';
    const { from, to } = parseRange(req.query, { days: 30 });
    const cond = {
      active: ACTIVE_WHERE,
      unpaid: 'ps.ended_at IS NOT NULL AND ps.fee > 0 AND p.id IS NULL',
      completed: 'ps.ended_at IS NOT NULL',
      all: 'true',
    }[state];
    const where = `${cond} AND ($1::boolean IS FALSE OR (${inRange('ps.started_at', 2, 3)}))
      AND ($4::text IS NULL OR s.lot_id = $4)
      AND ($5::text IS NULL OR lower(r.code) LIKE $5 OR lower(veh.plate_number) LIKE $5 OR lower(u.email) LIKE $5 OR lower(u.full_name) LIKE $5)`;
    const sel = SESSION_SELECT.replace('FROM parking_sessions ps', ', u.email AS user_email, u.full_name AS user_full_name, u.username AS user_username FROM parking_sessions ps')
      .replace('LEFT JOIN payments p ON p.session_id = ps.id', 'LEFT JOIN payments p ON p.session_id = ps.id LEFT JOIN users u ON u.id = COALESCE(ps.user_id, r.user_id)');
    const params = [useRange, from, to, req.query.lotId ? String(req.query.lotId) : null, like(req.query.q)];
    const [list, total] = await Promise.all([
      db.query(`${sel} WHERE ${where} ORDER BY ps.started_at DESC LIMIT $6 OFFSET $7`, [...params, limit, offset]),
      db.one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN p.id IS NULL AND ps.ended_at IS NOT NULL THEN ps.fee END), 0)::int AS unpaid
              FROM parking_sessions ps JOIN slots s ON s.id = ps.slot_id LEFT JOIN reservations r ON r.id = ps.reservation_id
              LEFT JOIN vehicles veh ON veh.id = ps.vehicle_id LEFT JOIN payments p ON p.session_id = ps.id
              LEFT JOIN users u ON u.id = COALESCE(ps.user_id, r.user_id) WHERE ${where}`, params),
    ]);
    res.json({
      state, from: useRange ? from : null, to: useRange ? to : null, total: total.n, unpaidAmount: total.unpaid, limit, offset,
      items: list.rows.map((s) => ({
        ...sessionView(s), adminNote: s.admin_note ?? null,
        user: s.owner_id ? { id: s.owner_id, email: s.user_email, name: displayName({ full_name: s.user_full_name, username: s.user_username, email: s.user_email }) } : null,
      })),
    });
  }));

  // Ket thuc phien bi treo (cam bien loi, xe ra bang nut...) / mien phi phien chua thanh toan
  r.post('/sessions/:id/close', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const note = v.str(req.body, 'note', { max: 200, optional: true });
    const waive = req.body?.waive === true;
    let s = await db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [id]);
    if (!s) throw notFound('session_not_found', 'Khong tim thay luot do');
    if (s.payment_id && waive) throw conflict('already_paid', 'Luot do da thanh toan');
    if (s.exited_at && !waive && s.ended_at) throw conflict('session_ended', 'Phien gui xe da ket thuc');
    await db.tx(async (q) => {
      if (!s.ended_at) await closeSession(q, id);
      await q.query(
        `UPDATE parking_sessions SET exited_at = COALESCE(exited_at, now()), admin_note = COALESCE($2, admin_note),
           fee = CASE WHEN $3 THEN 0 ELSE fee END, overtime_fee = CASE WHEN $3 THEN 0 ELSE overtime_fee END, updated_at = now()
         WHERE id = $1`, [id, note, waive]);
    });
    s = await db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [id]);
    await audit(db, req, 'session.close', 'session', id, { note, waive, fee: s.fee });
    await notify(db, { userId: s.owner_id, sessionId: id, type: 'admin_notice', key: `s${id}:admin_close`,
      title: waive ? 'Phiên gửi xe được miễn phí' : 'Phiên gửi xe đã được kết thúc',
      body: waive ? `Quản trị viên đã miễn phí phiên gửi xe ở ô #${s.slot_number}.${note ? ` ${note}` : ''}`
        : `Quản trị viên đã kết thúc phiên ở ô #${s.slot_number}. Phí: ${vnd(s.fee)}.${note ? ` Ghi chú: ${note}` : ''}` });
    res.json({ ...sessionView(s), adminNote: s.admin_note });
  }));

  // ---------- Giao dich ----------
  r.get('/payments', wrap(async (req, res) => {
    const { limit, offset } = page(req.query);
    const { from, to } = parseRange(req.query, { days: 30 });
    const method = req.query.method ? String(req.query.method).slice(0, 10) : null;
    const where = `${inRange('p.created_at', 1, 2)} AND ($3::text IS NULL OR p.method = $3) AND ($4::text IS NULL OR s.lot_id = $4)
      AND ($5::text IS NULL OR lower(p.receipt_no) LIKE $5 OR lower(p.code) LIKE $5 OR lower(u.email) LIKE $5 OR lower(veh.plate_number) LIKE $5)`;
    const sel = PAYMENT_SELECT.replace('FROM payments p', ', u.email AS user_email FROM payments p')
      .replace('LEFT JOIN users cu ON cu.id = p.collected_by', 'LEFT JOIN users cu ON cu.id = p.collected_by LEFT JOIN users u ON u.id = p.user_id');
    const params = [from, to, method, req.query.lotId ? String(req.query.lotId) : null, like(req.query.q)];
    const base = `FROM payments p JOIN parking_sessions ps ON ps.id = p.session_id JOIN slots s ON s.id = ps.slot_id
      LEFT JOIN vehicles veh ON veh.id = ps.vehicle_id LEFT JOIN users u ON u.id = p.user_id WHERE ${where}`;
    const [list, sum, byMethod] = await Promise.all([
      db.query(`${sel} WHERE ${where} ORDER BY p.created_at DESC LIMIT $6 OFFSET $7`, [...params, limit, offset]),
      db.one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::int AS total ${base}`, params),
      db.query(`SELECT p.method, COUNT(*)::int AS count, COALESCE(SUM(p.amount), 0)::int AS total ${base} GROUP BY p.method ORDER BY 3 DESC`, params),
    ]);
    res.json({
      from, to, total: sum.n, limit, offset,
      summary: { count: sum.n, amount: sum.total, byMethod: byMethod.rows },
      items: list.rows.map((p) => ({ ...payView(p), userEmail: p.user_email ?? null })),
    });
  }));

  // ---------- Danh gia ----------
  r.get('/reviews', wrap(async (req, res) => {
    const { limit, offset } = page(req.query);
    const rating = v.int(req.query, 'rating', { min: 1, max: 5, optional: true });
    const unreplied = req.query.unreplied === '1' || req.query.unreplied === 'true';
    const lotId = req.query.lotId ? String(req.query.lotId) : null;
    const where = `($1::int IS NULL OR rv.rating = $1) AND ($2::boolean IS FALSE OR rv.reply IS NULL) AND ($3::text IS NULL OR rv.lot_id = $3)`;
    const [list, total] = await Promise.all([
      db.query(`SELECT rv.*, u.full_name, u.username, u.email, l.name AS lot_name FROM lot_reviews rv
                JOIN users u ON u.id = rv.user_id JOIN parking_lots l ON l.id = rv.lot_id
                WHERE ${where} ORDER BY rv.updated_at DESC LIMIT $4 OFFSET $5`, [rating, unreplied, lotId, limit, offset]),
      db.one(`SELECT COUNT(*)::int AS n FROM lot_reviews rv WHERE ${where}`, [rating, unreplied, lotId]),
    ]);
    res.json({
      total: total.n, limit, offset, tags: REVIEW_TAGS,
      items: list.rows.map((x) => ({
        id: x.id, lotId: x.lot_id, lotName: x.lot_name, rating: x.rating, tags: x.tags, comment: x.comment,
        author: displayName(x), userId: x.user_id, userEmail: x.email,
        reply: x.reply ? { text: x.reply, at: x.replied_at } : null, createdAt: x.created_at, updatedAt: x.updated_at,
      })),
    });
  }));

  r.delete('/reviews/:id', wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const reason = v.str(req.body, 'reason', { max: 200, optional: true });
    const row = await db.one('DELETE FROM lot_reviews WHERE id = $1 RETURNING *', [id]);
    if (!row) throw notFound('review_not_found', 'Khong tim thay danh gia');
    await audit(db, req, 'review.delete', 'review', id, { lotId: row.lot_id, rating: row.rating, comment: row.comment, reason });
    await notify(db, { userId: row.user_id, type: 'admin_notice', key: `rv${id}:deleted`,
      title: 'Đánh giá của bạn đã bị gỡ', body: reason ? `Lý do: ${reason}` : 'Đánh giá không phù hợp tiêu chuẩn cộng đồng.',
      data: { lotId: row.lot_id } });
    res.json({ ok: true });
  }));

  // ---------- Thong bao chung ----------
  r.post('/broadcast', wrap(async (req, res) => {
    const title = v.str(req.body, 'title', { min: 3, max: 120 });
    const body = v.str(req.body, 'body', { max: 500, optional: true });
    const audience = req.body?.audience ? String(req.body.audience) : 'all';
    let lotId = null;
    if (audience !== 'all') {
      if (!audience.startsWith('lot:')) throw badRequest('validation_error', "'audience' phai la all | lot:<lotId>");
      lotId = audience.slice(4);
      if (!(await db.one('SELECT 1 FROM parking_lots WHERE id = $1', [lotId]))) throw notFound('lot_not_found', 'Khong tim thay bai do');
    }
    const rows = await audienceOf(lotId);
    const b = await db.one(
      'INSERT INTO broadcasts (title, body, audience, recipients, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, body, audience, rows.length, req.user.id]);
    for (const u of rows) {
      await notify(db, { userId: u.id, type: 'announcement', key: `b${b.id}:${u.id}`, title, body,
        data: { broadcastId: b.id, ...(lotId && { lotId }) } });
    }
    await audit(db, req, 'broadcast', 'broadcast', b.id, { title, audience, recipients: rows.length });
    res.status(201).json({ id: b.id, title, body, audience, recipients: rows.length, createdAt: b.created_at });
  }));

  r.get('/broadcasts', wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT b.*, u.full_name AS by_name, u.email AS by_email FROM broadcasts b LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.id DESC LIMIT 50`);
    res.json(rows.map((b) => ({ id: b.id, title: b.title, body: b.body, audience: b.audience, recipients: b.recipients,
      createdBy: b.by_name || b.by_email, createdAt: b.created_at })));
  }));

  // ---------- Nhat ky ----------
  r.get('/audit', wrap(async (req, res) => {
    const { limit, offset } = page(req.query);
    const { rows } = await db.query(
      `SELECT a.*, u.full_name, u.email FROM admin_actions a LEFT JOIN users u ON u.id = a.admin_id
       ORDER BY a.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json(rows.map((a) => ({
      id: Number(a.id), action: a.action, label: ACTION_LABEL[a.action] || a.action, targetType: a.target_type, targetId: a.target_id,
      detail: a.detail, admin: a.full_name || a.email || '—', createdAt: a.created_at,
    })));
  }));

  return r;
};
