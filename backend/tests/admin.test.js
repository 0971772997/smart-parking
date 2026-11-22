// Trang quan tri: tong quan, tai khoan (khoa / quyen / go khoa dat cho), bai do, dat cho, phien, giao dich,
// danh gia, thong bao chung, nhat ky. Chay: npm test (nhanh DB "test")
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
let db, app, device, sync, admin, adminId;
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456', fullName: `Le ${username}` }).expect(201)).body.token;
const idOf = async (email) => (await db.one('SELECT id FROM users WHERE email = $1', [email])).id;
const park = (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); };
const leave = (n) => { device.state.slots[n - 1].occupied = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); };

async function enter(token, slot) {
  const resv = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(token)).send({ slotNumber: slot, durationMinutes: 60 }).expect(201)).body;
  const pass = (await api().get(`/api/reservations/${resv.id}/pass`).set(auth(token)).expect(200)).body;
  const r = await api().post('/api/gates/scan').set(auth(admin)).send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200);
  return { resv, sessionId: r.body.sessionId };
}

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@test.vn', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]);
  device = createFakeDevice(4);
  sync = createSync(db, { live: createLiveHub() });
  sync.attachDevice(device);
  app = createApp({ db, auth: createAuth(config, { db }), device, gatePass: createGatePass('admin-test'), live: createLiveHub() });
  admin = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
  adminId = await idOf('admin@test.vn');
});
after(async () => db && db.end());

describe('Quyen truy cap', () => {
  test('Tai xe / khach khong vao duoc trang quan tri', async () => {
    const t = await register('ad_guest');
    await api().get('/api/admin/overview').set(auth(t)).expect(403);
    await api().get('/api/admin/users').expect(401);
  });
});

describe('Tai khoan', () => {
  let an, anId;
  before(async () => { an = await register('ad_an'); anId = await idOf('ad_an@test.vn'); });

  test('Danh sach + tim theo ten / email / bien so', async () => {
    await api().post('/api/vehicles').set(auth(an)).send({ plateNumber: '43A-123.45' }).expect(201);
    let l = (await api().get('/api/admin/users?q=ad_an').set(auth(admin)).expect(200)).body;
    assert.equal(l.total, 1);
    assert.equal(l.items[0].stats.vehicles, 1);
    l = (await api().get('/api/admin/users?q=43a-123').set(auth(admin)).expect(200)).body;
    assert.deepEqual(l.items.map((u) => u.id), [anId]);
    l = (await api().get('/api/admin/users?role=admin').set(auth(admin)).expect(200)).body;
    assert.deepEqual(l.items.map((u) => u.id), [adminId]);
    const d = (await api().get(`/api/admin/users/${anId}`).set(auth(admin)).expect(200)).body;
    assert.equal(d.vehicles[0].plateNumber, '43A-123.45');
    assert.deepEqual(d.reservations, []);
  });

  test('Khoa tai khoan -> token cu bi chan ngay, khong dang nhap duoc; mo khoa -> dung lai binh thuong', async () => {
    const u = (await api().patch(`/api/admin/users/${anId}`).set(auth(admin)).send({ locked: true, lockedReason: 'Spam dat cho' }).expect(200)).body;
    assert.equal(u.locked, true);
    assert.equal(u.lockedReason, 'Spam dat cho');
    const r = await api().get('/api/sessions/active').set(auth(an)).expect(403);
    assert.equal(r.body.error, 'account_locked');
    const lg = await api().post('/api/auth/login').send({ email: 'ad_an@test.vn', password: '123456' }).expect(403);
    assert.equal(lg.body.details.reason, 'Spam dat cho');
    assert.equal((await api().get('/api/admin/users?status=locked').set(auth(admin)).expect(200)).body.total, 1);
    await api().patch(`/api/admin/users/${anId}`).set(auth(admin)).send({ locked: false }).expect(200);
    await api().get('/api/sessions/active').set(auth(an)).expect(200);
  });

  test('Cap quyen admin co hieu luc ngay; khong tu khoa / tu ha quyen minh', async () => {
    await api().get('/api/admin/overview').set(auth(an)).expect(403);
    await api().patch(`/api/admin/users/${anId}`).set(auth(admin)).send({ role: 'admin' }).expect(200);
    await api().get('/api/admin/overview').set(auth(an)).expect(200);
    await api().patch(`/api/admin/users/${anId}`).set(auth(admin)).send({ role: 'user' }).expect(200);
    await api().get('/api/admin/overview').set(auth(an)).expect(403);
    const r = await api().patch(`/api/admin/users/${adminId}`).set(auth(admin)).send({ locked: true }).expect(409);
    assert.equal(r.body.error, 'cannot_modify_self');
    await api().patch(`/api/admin/users/${adminId}`).set(auth(admin)).send({ role: 'user' }).expect(409);
    await api().patch(`/api/admin/users/${anId}`).set(auth(admin)).send({ role: 'boss' }).expect(400);
  });

  test('Go khoa dat cho do khong den', async () => {
    const slot = (await db.one(`SELECT id FROM slots WHERE lot_id = $1 AND slot_number = 4`, [LOT])).id;
    for (let i = 0; i < 3; i += 1) {
      await db.query(`INSERT INTO reservations (user_id, slot_id, status, minutes, request_id, updated_at)
        VALUES ($1, $2, 'expired', 15, $3, now() - interval '1 hour')`, [anId, slot, `ns-${i}-${Date.now()}`]);
    }
    let r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 1 }).expect(403);
    assert.equal(r.body.error, 'booking_suspended');
    assert.equal((await api().get(`/api/admin/users/${anId}`).set(auth(admin)).expect(200)).body.noShows7d, 3);
    await api().patch(`/api/admin/users/${anId}`).set(auth(admin)).send({ resetNoShows: true }).expect(200);
    r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 1 }).expect(201);
    await api().delete(`/api/reservations/${r.body.id}`).set(auth(an)).expect(200);
    const n = (await api().get('/api/notifications').set(auth(an)).expect(200)).body.items;
    assert.ok(n.some((x) => x.type === 'admin_notice' && x.title === 'Đã gỡ khoá đặt chỗ'));
  });
});

describe('Bai do', () => {
  test('Them, sua (ten, gia, tang so o), tam ngung nhan dat cho, xoa bai chua co lich su', async () => {
    await api().post('/api/lots').set(auth(admin)).send({ id: 'sp-new-01', name: 'Bai moi', totalSlots: 2, pricePerHour: 8000 }).expect(201);
    let l = (await api().put('/api/lots/sp-new-01').set(auth(admin)).send({ name: 'Bai moi 2', pricePerHour: 12000, totalSlots: 4 }).expect(200)).body;
    assert.equal(l.name, 'Bai moi 2');
    assert.equal(l.totalSlots, 4);
    assert.equal((await api().get('/api/lots/sp-new-01').expect(200)).body.slots.length, 4);
    l = (await api().put('/api/lots/sp-new-01').set(auth(admin)).send({ totalSlots: 3 }).expect(200)).body;
    assert.equal(l.totalSlots, 3);
    l = (await api().put('/api/lots/sp-new-01').set(auth(admin)).send({ bookingEnabled: false }).expect(200)).body;
    assert.equal(l.bookingEnabled, false);
    const t = await register('ad_lot');
    await db.query(`UPDATE parking_lots SET online = true WHERE id = 'sp-new-01'`);
    const r = await api().post('/api/lots/sp-new-01/reservations').set(auth(t)).send({}).expect(409);
    assert.equal(r.body.error, 'lot_booking_disabled');
    await api().delete('/api/lots/sp-new-01').set(auth(admin)).expect(200);
    await api().get('/api/lots/sp-new-01').expect(404);
  });

  test('Bai co lich su: khong giam o da dung, khong xoa duoc', async () => {
    const r = await api().put(`/api/lots/${LOT}`).set(auth(admin)).send({ totalSlots: 3 }).expect(409);
    assert.equal(r.body.error, 'slots_in_use');
    assert.deepEqual(r.body.details.slots, [4]);
    assert.equal((await api().delete(`/api/lots/${LOT}`).set(auth(admin)).expect(409)).body.error, 'lot_has_history');
    await api().put(`/api/lots/${LOT}`).set(auth(admin)).send({ pricePerHour: -1 }).expect(400);
  });

  test('Danh sach bai cho quan tri (cho trong, xe trong bai, doanh thu)', async () => {
    const l = (await api().get('/api/admin/lots').set(auth(admin)).expect(200)).body;
    const d = l.find((x) => x.id === LOT);
    assert.equal(typeof d.freeSlots, 'number');
    assert.equal(typeof d.carsInLot, 'number');
    assert.equal(d.revenueToday, 0);
  });
});

describe('Dat cho, phien gui xe, giao dich', () => {
  let binh, binhId, stuck;
  before(async () => { binh = await register('ad_binh'); binhId = await idOf('ad_binh@test.vn'); });

  test('Huy dat cho cua tai xe -> o tro ve trong, tai xe duoc bao', async () => {
    const resv = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(binh)).send({ slotNumber: 2 }).expect(201)).body;
    const list = (await api().get(`/api/admin/reservations?status=active&q=${resv.code.toLowerCase()}`).set(auth(admin)).expect(200)).body;
    assert.equal(list.items[0].id, resv.id);
    assert.equal(list.items[0].user.email, 'ad_binh@test.vn');
    const c = (await api().post(`/api/admin/reservations/${resv.id}/cancel`).set(auth(admin)).send({ reason: 'Bao tri o 2' }).expect(200)).body;
    assert.equal(c.status, 'cancelled');
    assert.equal(c.deviceConfirmed, true);
    assert.equal(device.state.slots[1].reserved, false);
    await api().post(`/api/admin/reservations/${resv.id}/cancel`).set(auth(admin)).expect(409);
    const n = (await api().get('/api/notifications').set(auth(binh)).expect(200)).body.items[0];
    assert.match(n.body, /Bao tri o 2/);
  });

  test('Phien dang gui -> ket thuc phien bi treo (chot phi, ra bai)', async () => {
    stuck = await enter(binh, 3);
    await park(3);
    const act = (await api().get('/api/admin/sessions?state=active').set(auth(admin)).expect(200)).body;
    assert.ok(act.items.some((s) => s.id === stuck.sessionId && s.user.email === 'ad_binh@test.vn'));
    const s = (await api().post(`/api/admin/sessions/${stuck.sessionId}/close`).set(auth(admin)).send({ note: 'Cam bien o 3 loi' }).expect(200)).body;
    assert.equal(s.phase, 'completed');
    assert.equal(s.fee, 10000);
    assert.equal(s.adminNote, 'Cam bien o 3 loi');
    const unpaid = (await api().get('/api/admin/sessions?state=unpaid').set(auth(admin)).expect(200)).body;
    assert.equal(unpaid.unpaidAmount, 10000);
    device.state.slots[2].occupied = false;
  });

  test('Mien phi phien chua thanh toan', async () => {
    const s = (await api().post(`/api/admin/sessions/${stuck.sessionId}/close`).set(auth(admin)).send({ waive: true }).expect(200)).body;
    assert.equal(s.fee, 0);
    assert.equal((await api().get('/api/admin/sessions?state=unpaid').set(auth(admin)).expect(200)).body.total, 0);
  });

  test('Thu tien mat tai cong -> giao dich + tong hop theo phuong thuc', async () => {
    const v = await enter(binh, 1);
    await park(1);
    await leave(1);
    await api().post(`/api/lots/${LOT}/sessions/${v.sessionId}/pay`).set(auth(admin)).send({ method: 'cash' }).expect(201);
    const p = (await api().get('/api/admin/payments').set(auth(admin)).expect(200)).body;
    assert.equal(p.summary.count, 1);
    assert.equal(p.summary.amount, 10000);
    assert.deepEqual(p.summary.byMethod, [{ method: 'cash', count: 1, total: 10000 }]);
    assert.equal(p.items[0].userEmail, 'ad_binh@test.vn');
    assert.ok(p.items[0].receiptUrl);
    await api().get('/api/admin/payments?from=2026-13-01').set(auth(admin)).expect(400);
  });

  test('Tong quan: doanh thu hom nay, chuoi theo ngay, viec can xu ly', async () => {
    const o = (await api().get('/api/admin/overview').set(auth(admin)).expect(200)).body;
    assert.equal(o.todayStats.revenue, 10000);
    assert.ok(o.todayStats.sessions >= 2);
    assert.equal(o.series.length, 7);
    assert.equal(o.series[6].date, o.today);
    assert.equal(o.series[6].revenue, 10000);
    assert.ok(o.users.total >= 4);
    assert.equal(o.lots.total, 1);
    assert.equal(o.lotStatus[0].revenueToday, 10000);
    assert.equal(typeof o.pending.openTickets, 'number');
    assert.equal((await api().get('/api/admin/overview?days=30').set(auth(admin)).expect(200)).body.series.length, 30);
    assert.equal((await api().get(`/api/admin/users/${binhId}`).set(auth(admin)).expect(200)).body.payments.length, 1);
  });
});

describe('Danh gia, thong bao chung, nhat ky', () => {
  test('Liet ke danh gia chua phan hoi + go danh gia vi pham', async () => {
    const t = (await api().post('/api/auth/login').send({ email: 'ad_binh@test.vn', password: '123456' })).body.token;
    await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(t)).send({ rating: 1, comment: 'noi dung xau' }).expect(201);
    const l = (await api().get('/api/admin/reviews?unreplied=1').set(auth(admin)).expect(200)).body;
    assert.equal(l.total, 1);
    assert.equal(l.items[0].userEmail, 'ad_binh@test.vn');
    await api().delete(`/api/admin/reviews/${l.items[0].id}`).set(auth(admin)).send({ reason: 'Ngon tu khong phu hop' }).expect(200);
    assert.equal((await api().get('/api/admin/reviews').set(auth(admin)).expect(200)).body.total, 0);
  });

  test('Thong bao chung: tat ca / theo bai (chi tai xe lien quan), khong gui tai khoan bi khoa', async () => {
    const lockId = await idOf('ad_guest@test.vn');
    await api().patch(`/api/admin/users/${lockId}`).set(auth(admin)).send({ locked: true }).expect(200);
    const all = (await api().post('/api/admin/broadcast').set(auth(admin)).send({ title: 'Bao tri he thong', body: 'Toi nay 23h' }).expect(201)).body;
    const users = (await db.one(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'user' AND locked_at IS NULL`)).n;
    assert.equal(all.recipients, users);
    const byLot = (await api().post('/api/admin/broadcast').set(auth(admin)).send({ title: 'Bai dong cua som', audience: `lot:${LOT}` }).expect(201)).body;
    assert.ok(byLot.recipients >= 2 && byLot.recipients < users);
    const t = (await api().post('/api/auth/login').send({ email: 'ad_binh@test.vn', password: '123456' })).body.token;
    const n = (await api().get('/api/notifications').set(auth(t)).expect(200)).body.items;
    assert.deepEqual(n.slice(0, 2).map((x) => x.type), ['announcement', 'announcement']);
    await api().post('/api/admin/broadcast').set(auth(admin)).send({ title: 'x' }).expect(400);
    await api().post('/api/admin/broadcast').set(auth(admin)).send({ title: 'Thu', audience: 'lot:khong-co' }).expect(404);
    assert.equal((await api().get('/api/admin/broadcasts').set(auth(admin)).expect(200)).body.length, 2);
  });

  test('Nhat ky ghi lai cac thao tac quan tri', async () => {
    const a = (await api().get('/api/admin/audit?limit=100').set(auth(admin)).expect(200)).body;
    const actions = new Set(a.map((x) => x.action));
    for (const k of ['user.lock', 'user.unlock', 'user.role', 'user.reset_noshow', 'lot.create', 'lot.update', 'lot.delete',
      'reservation.cancel', 'session.close', 'session.collect', 'review.delete', 'broadcast']) {
      assert.ok(actions.has(k), `thieu ${k}`);
    }
    assert.equal(a[0].admin, 'Admin');
    assert.ok(a[0].label);
  });
});
