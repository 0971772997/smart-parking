// Lich su (loc theo ngay), bai yeu thich, danh gia bai do, ho tro & bao cao su co
// Chay: npm test  (dung nhanh DB Neon "test" trong .env.test, KHONG dung DB that)
process.env.NODE_ENV = 'test';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const config = require('../src/config');
const { createDb } = require('../src/db');
const { createAuth } = require('../src/auth');
const { createSync } = require('../src/sync');
const { createApp } = require('../src/app');
const { createGatePass } = require('../src/gatePass');
const { createLiveHub } = require('../src/live');
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const gp = createGatePass('feedback-test-secret');
const live = createLiveHub();
let db, app, device, sync, adminToken;

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456', fullName: `Nguyen Van ${username}` }).expect(201)).body.token;
const vnDate = (offsetDays = 0) => new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const park = (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); };
const leave = (n) => { device.state.slots[n - 1].occupied = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); };

// Dat cho -> qua cong vao -> do -> roi o: tra ve id phien gui xe
async function fullVisit(token, slot) {
  const resv = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(token)).send({ slotNumber: slot, durationMinutes: 60 }).expect(201)).body;
  const pass = (await api().get(`/api/reservations/${resv.id}/pass`).set(auth(token)).expect(200)).body;
  const r = await api().post('/api/gates/scan').set(auth(adminToken)).send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200);
  await park(slot);
  await leave(slot);
  return { sessionId: r.body.sessionId, reservation: resv };
}

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(`INSERT INTO parking_lots (id, name, total_slots) VALUES ('sp-other', 'Bai khac', 2)`);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@test.vn', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]);
  device = createFakeDevice(4);
  sync = createSync(db, { live });
  sync.attachDevice(device);
  app = createApp({ db, auth: createAuth(config), device, gatePass: gp, live });
  adminToken = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
});

after(async () => db && db.end());

describe('Lich su dat cho & gui xe', () => {
  let an, visit, cancelled;
  before(async () => {
    an = await register('fb_an');
    visit = await fullVisit(an, 1);
    // 1 dat cho bi huy (khong thanh phien) + 1 dat cho cu 40 ngay truoc
    cancelled = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 2 }).expect(201)).body;
    await api().delete(`/api/reservations/${cancelled.id}`).set(auth(an)).expect(200);
    await db.query(`UPDATE parking_sessions SET started_at = started_at - interval '1 minute' WHERE id = $1`, [visit.sessionId]);
  });

  test('Mac dinh 30 ngay: phien gui xe + dat cho bi huy, khong trung dat cho da thanh phien', async () => {
    const h = (await api().get('/api/history').set(auth(an)).expect(200)).body;
    assert.equal(h.to, vnDate());
    assert.equal(h.from, vnDate(-29));
    assert.deepEqual(h.items.map((i) => i.kind).sort(), ['reservation', 'session']);
    const s = h.items.find((i) => i.kind === 'session').session;
    assert.equal(s.id, visit.sessionId);
    assert.equal(s.reservationCode, visit.reservation.code);
    assert.equal(s.cost.final, true);
    assert.equal(h.items.find((i) => i.kind === 'reservation').reservation.status, 'cancelled');
    assert.equal(h.summary.sessions, 1);
    assert.equal(h.summary.reservations, 2);
    assert.equal(h.summary.cancelled, 1);
    assert.equal(h.summary.totalFee, s.cost.total);
    assert.equal(h.summary.unpaid, s.cost.total);
    // moi nhat truoc: dat cho bi huy tao sau
    assert.equal(h.items[0].kind, 'reservation');
  });

  test('Loc theo loai + theo khoang ngay (gio Viet Nam)', async () => {
    let h = (await api().get('/api/history?kind=sessions').set(auth(an)).expect(200)).body;
    assert.deepEqual(h.items.map((i) => i.kind), ['session']);
    h = (await api().get('/api/history?kind=reservations').set(auth(an)).expect(200)).body;
    assert.deepEqual(h.items.map((i) => i.kind), ['reservation']);
    h = (await api().get(`/api/history?from=${vnDate(-10)}&to=${vnDate(-1)}`).set(auth(an)).expect(200)).body;
    assert.equal(h.items.length, 0);
    assert.equal(h.summary.reservations, 0);
    await db.query(`UPDATE reservations SET created_at = now() - interval '40 days' WHERE id = $1`, [cancelled.id]);
    h = (await api().get(`/api/history?from=${vnDate(-45)}&to=${vnDate(-35)}`).set(auth(an)).expect(200)).body;
    assert.deepEqual(h.items.map((i) => i.reservation?.id), [cancelled.id]);
    h = (await api().get(`/api/history?lotId=sp-other`).set(auth(an)).expect(200)).body;
    assert.equal(h.items.length, 0);
  });

  test('Ngay sai / khoang nguoc / qua dai -> 400; nguoi khac khong thay lich su', async () => {
    await api().get('/api/history?from=2026-02-30').set(auth(an)).expect(400);
    await api().get('/api/history?from=21/11/2026').set(auth(an)).expect(400);
    await api().get(`/api/history?from=${vnDate()}&to=${vnDate(-1)}`).set(auth(an)).expect(400);
    await api().get('/api/history?from=2024-01-01&to=2026-01-01').set(auth(an)).expect(400);
    await api().get('/api/history').expect(401);
    const binh = await register('fb_binh');
    const h = (await api().get('/api/history').set(auth(binh)).expect(200)).body;
    assert.equal(h.items.length, 0);
  });
});

describe('Bai do yeu thich', () => {
  let an;
  before(async () => { an = (await api().post('/api/auth/login').send({ email: 'fb_an@test.vn', password: '123456' })).body.token; });

  test('Them (idempotent), liet ke, xoa', async () => {
    assert.deepEqual((await api().get('/api/favorites').set(auth(an)).expect(200)).body, []);
    await api().put(`/api/favorites/${LOT}`).set(auth(an)).expect(201);
    await api().put(`/api/favorites/${LOT}`).set(auth(an)).expect(200);
    await api().put('/api/favorites/sp-other').set(auth(an)).expect(201);
    let list = (await api().get('/api/favorites').set(auth(an)).expect(200)).body;
    assert.deepEqual(list.map((l) => l.id), ['sp-other', LOT]);
    assert.equal(typeof list[1].freeSlots, 'number');
    assert.ok(list[1].favoritedAt);
    await api().delete('/api/favorites/sp-other').set(auth(an)).expect(200);
    list = (await api().get('/api/favorites').set(auth(an)).expect(200)).body;
    assert.deepEqual(list.map((l) => l.id), [LOT]);
  });

  test('Bai khong ton tai -> 404; chua dang nhap -> 401', async () => {
    await api().put('/api/favorites/khong-co').set(auth(an)).expect(404);
    await api().get('/api/favorites').expect(401);
  });
});

describe('Danh gia bai do', () => {
  let an, binh, reviewId;
  before(async () => {
    an = (await api().post('/api/auth/login').send({ email: 'fb_an@test.vn', password: '123456' })).body.token;
    binh = (await api().post('/api/auth/login').send({ email: 'fb_binh@test.vn', password: '123456' })).body.token;
  });

  test('Chua gui xe o bai -> khong duoc danh gia', async () => {
    const m = (await api().get(`/api/lots/${LOT}/reviews/mine`).set(auth(binh)).expect(200)).body;
    assert.equal(m.eligible, false);
    const r = await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(binh)).send({ rating: 1 }).expect(403);
    assert.equal(r.body.error, 'review_not_eligible');
  });

  test('Da gui xe -> gui danh gia, sua lai (van 1 danh gia), du lieu tong hop', async () => {
    const m = (await api().get(`/api/lots/${LOT}/reviews/mine`).set(auth(an)).expect(200)).body;
    assert.equal(m.eligible, true);
    assert.equal(m.review, null);
    const c = await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(an))
      .send({ rating: 4, tags: ['clean', 'easy_find'], comment: 'Bai sach, de tim o' }).expect(201);
    reviewId = c.body.id;
    assert.equal(c.body.author, 'Nguyen f.');
    const u = await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(an))
      .send({ rating: 5, tags: ['clean', 'clean', 'staff'], comment: 'Rat tot' }).expect(200);
    assert.equal(u.body.id, reviewId);
    assert.deepEqual(u.body.tags, ['clean', 'staff']);

    const pub = (await api().get(`/api/lots/${LOT}/reviews`).expect(200)).body;
    assert.equal(pub.summary.count, 1);
    assert.equal(pub.summary.average, 5);
    assert.equal(pub.summary.distribution[5], 1);
    assert.equal(pub.items[0].mine, false);
    assert.equal(pub.mine, null);
    assert.ok(pub.summary.topTags.some((t) => t.tag === 'clean' && t.label === 'Sạch sẽ'));
    const mine = (await api().get(`/api/lots/${LOT}/reviews`).set(auth(an)).expect(200)).body;
    assert.equal(mine.items[0].mine, true);
    assert.equal(mine.mine.id, reviewId);
    // Danh sach bai do kem diem danh gia
    const lots = (await api().get('/api/lots').expect(200)).body;
    assert.deepEqual(lots.find((l) => l.id === LOT).rating, { average: 5, count: 1 });
    assert.deepEqual((await api().get(`/api/lots/${LOT}`).expect(200)).body.rating, { average: 5, count: 1 });
  });

  test('Du lieu khong hop le -> 400', async () => {
    await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(an)).send({ rating: 6 }).expect(400);
    await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(an)).send({ rating: 3, tags: ['hack'] }).expect(400);
    await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(an)).send({ rating: 3, comment: 'x'.repeat(1001) }).expect(400);
  });

  test('Quan ly phan hoi danh gia -> tai xe nhan thong bao; tai xe thuong khong phan hoi duoc', async () => {
    await api().post(`/api/reviews/${reviewId}/reply`).set(auth(binh)).send({ reply: 'x' }).expect(403);
    const r = await api().post(`/api/reviews/${reviewId}/reply`).set(auth(adminToken)).send({ reply: 'Cam on ban!' }).expect(200);
    assert.equal(r.body.reply.text, 'Cam on ban!');
    const n = (await api().get('/api/notifications').set(auth(an)).expect(200)).body.items;
    assert.equal(n[0].type, 'review_reply');
    assert.equal(n[0].data.lotId, LOT);
  });

  test('Xoa danh gia cua toi', async () => {
    await api().delete(`/api/lots/${LOT}/reviews/mine`).set(auth(an)).expect(200);
    await api().delete(`/api/lots/${LOT}/reviews/mine`).set(auth(an)).expect(404);
    assert.equal((await api().get(`/api/lots/${LOT}/reviews`).expect(200)).body.summary.count, 0);
  });
});

describe('Ho tro & bao cao su co', () => {
  let an, binh, ticket, sessionId;
  before(async () => {
    an = (await api().post('/api/auth/login').send({ email: 'fb_an@test.vn', password: '123456' })).body.token;
    binh = (await api().post('/api/auth/login').send({ email: 'fb_binh@test.vn', password: '123456' })).body.token;
    sessionId = (await db.one('SELECT id FROM parking_sessions ORDER BY id LIMIT 1')).id;
  });

  test('Thong tin lien he + danh muc + cau hoi thuong gap (cong khai)', async () => {
    const i = (await api().get('/api/support/info').expect(200)).body;
    assert.ok(i.contact.hotline);
    assert.ok(i.categories.incident.gate);
    assert.ok(i.faq.length >= 3);
  });

  test('Bao cao su co gan luot gui xe -> lay bai tu luot, uu tien cao, admin duoc bao', async () => {
    const r = await api().post('/api/support/tickets').set(auth(an)).send({
      kind: 'incident', category: 'gate', subject: 'Barie khong mo', description: 'Quet ma QR o cong ra nhung barie khong mo', sessionId,
    }).expect(201);
    ticket = r.body;
    assert.match(ticket.code, /^SC-[A-Z0-9]{6}$/);
    assert.equal(ticket.lotId, LOT);
    assert.equal(ticket.priority, 'high');
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.categoryLabel, 'Barie / cổng không mở');
    const n = (await api().get('/api/notifications').set(auth(adminToken)).expect(200)).body.items;
    assert.equal(n[0].type, 'support_new');
    assert.equal(n[0].data.ticketId, ticket.id);
  });

  test('Du lieu sai / luot gui xe cua nguoi khac / su co khong co bai -> loi', async () => {
    const base = { kind: 'support', category: 'payment', subject: 'Hoi ve thanh toan', description: 'Toi muon hoi ve hoan tien MoMo' };
    await api().post('/api/support/tickets').set(auth(an)).send({ ...base, kind: 'x' }).expect(400);
    await api().post('/api/support/tickets').set(auth(an)).send({ ...base, category: 'gate' }).expect(400);
    await api().post('/api/support/tickets').set(auth(an)).send({ ...base, description: 'ngan' }).expect(400);
    await api().post('/api/support/tickets').set(auth(binh)).send({ ...base, sessionId }).expect(404);
    const r = await api().post('/api/support/tickets').set(auth(an))
      .send({ kind: 'incident', category: 'other', subject: 'Su co', description: 'Mo ta su co khong ro bai' }).expect(400);
    assert.equal(r.body.error, 'lot_required');
    const ok = await api().post('/api/support/tickets').set(auth(binh)).send(base).expect(201);
    assert.match(ok.body.code, /^HT-/);
    assert.equal(ok.body.priority, 'normal');
  });

  test('Danh sach: tai xe chi thay cua minh; admin thay tat ca', async () => {
    const mine = (await api().get('/api/support/tickets').set(auth(an)).expect(200)).body;
    assert.deepEqual(mine.map((t) => t.id), [ticket.id]);
    assert.equal(mine[0].reporter, undefined);
    const all = (await api().get('/api/support/tickets?scope=all').set(auth(adminToken)).expect(200)).body;
    assert.equal(all.length, 2);
    assert.equal(all[0].id, ticket.id); // uu tien cao len dau
    assert.ok(all[0].reporter.email);
    const ignored = (await api().get('/api/support/tickets?scope=all').set(auth(binh)).expect(200)).body;
    assert.equal(ignored.length, 1);
    await api().get(`/api/support/tickets/${ticket.id}`).set(auth(binh)).expect(404);
  });

  test('Trao doi: nhan vien tra loi -> dang xu ly + thong bao; giai quyet; tai xe nhan lai -> mo lai; dong', async () => {
    let m = await api().post(`/api/support/tickets/${ticket.id}/messages`).set(auth(adminToken)).send({ body: 'Da mo cong tu xa' }).expect(201);
    assert.equal(m.body.status, 'in_progress');
    assert.equal(m.body.message.staff, true);
    const n = (await api().get('/api/notifications').set(auth(an)).expect(200)).body.items;
    assert.equal(n[0].type, 'support_reply');
    let d = (await api().get(`/api/support/tickets/${ticket.id}`).set(auth(an)).expect(200)).body;
    assert.equal(d.messages.length, 1);
    assert.equal(d.awaitingReply, false);

    await api().patch(`/api/support/tickets/${ticket.id}`).set(auth(an)).send({ status: 'resolved' }).expect(403);
    d = (await api().patch(`/api/support/tickets/${ticket.id}`).set(auth(adminToken)).send({ status: 'resolved' }).expect(200)).body;
    assert.equal(d.status, 'resolved');
    assert.ok(d.resolvedAt);
    m = await api().post(`/api/support/tickets/${ticket.id}/messages`).set(auth(an)).send({ body: 'Van chua mo duoc' }).expect(201);
    assert.equal(m.body.status, 'open');
    d = (await api().get(`/api/support/tickets/${ticket.id}`).set(auth(an)).expect(200)).body;
    assert.equal(d.resolvedAt, null);
    assert.equal(d.awaitingReply, true);

    d = (await api().patch(`/api/support/tickets/${ticket.id}`).set(auth(an)).send({ status: 'closed' }).expect(200)).body;
    assert.equal(d.status, 'closed');
    assert.equal(d.canReply, false);
    const r = await api().post(`/api/support/tickets/${ticket.id}/messages`).set(auth(an)).send({ body: 'them' }).expect(409);
    assert.equal(r.body.error, 'ticket_closed');
  });

  test('Gui qua nhieu yeu cau trong 1 gio -> 429', async () => {
    const base = { kind: 'support', category: 'other', subject: 'Hoi dap', description: 'Noi dung cau hoi thu nghiem' };
    for (let i = 0; i < 4; i += 1) await api().post('/api/support/tickets').set(auth(binh)).send(base).expect(201);
    const r = await api().post('/api/support/tickets').set(auth(binh)).send(base).expect(429);
    assert.equal(r.body.error, 'too_many_tickets');
  });
});
