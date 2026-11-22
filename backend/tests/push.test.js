// Thong bao day (Expo Push gia lap qua fetchFn) + danh sach thong bao / bo dem chua doc + tuy chon nhom
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
const { createPushService, EXPO_PUSH_URL } = require('../src/push');
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const TOKEN_DEAD = 'ExponentPushToken[deaddeaddeaddeaddead00]';

// Expo Push gia lap: ghi lai tin da gui, token "dead" -> DeviceNotRegistered
const expo = { sent: [], down: false };
const fakeFetch = async (url, opts) => {
  assert.equal(url, EXPO_PUSH_URL);
  if (expo.down) throw new Error('ETIMEDOUT');
  const msgs = JSON.parse(opts.body);
  expo.sent.push(...msgs);
  return { json: async () => ({ data: msgs.map((m) => (m.to === TOKEN_DEAD
    ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
    : { status: 'ok', id: `t-${Math.random()}` })) }) };
};

let db, app, device, sync, adminToken, an, binh;
const gp = createGatePass('push-test-secret');
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456' }).expect(201)).body.token;
// Day chay nen (khong chan request) -> cho toi khi co tin thoa dieu kien
const waitFor = async (fn, ms = 3000) => {
  for (let t = 0; t < ms; t += 50) { const x = fn(); if (x) return x; await new Promise((ok) => setTimeout(ok, 50)); }
  return null;
};
const sentTo = (token, type) => expo.sent.filter((m) => m.to === token && (!type || m.data.type === type));

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@test.vn', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]);
  device = createFakeDevice(4);
  const live = createLiveHub();
  sync = createSync(db, { live });
  sync.attachDevice(device);
  const push = createPushService({ db, fetchFn: fakeFetch, log: { error: () => {} } });
  app = createApp({ db, auth: createAuth(config), device, gatePass: gp, live, push });
  adminToken = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
  an = await register('push_an');
  binh = await register('push_binh');
});

after(async () => db && db.end());

describe('Dang ky thiet bi + tuy chon', () => {
  test('Dang ky token Expo (2 thiet bi); token sai dinh dang bi tu choi', async () => {
    await api().post('/api/push/tokens').set(auth(an)).send({ token: 'abc' }).expect(400);
    await api().post('/api/push/tokens').send({ token: TOKEN_A }).expect(401);
    await api().post('/api/push/tokens').set(auth(an)).send({ token: TOKEN_A, platform: 'android', deviceName: 'Pixel 7' }).expect(201);
    const r = await api().post('/api/push/tokens').set(auth(an)).send({ token: TOKEN_B, platform: 'ios' }).expect(201);
    assert.equal(r.body.devices.length, 2);
  });

  test('Mac dinh bat ca 4 nhom; tat 1 nhom; gia tri sai -> 400', async () => {
    let p = await api().get('/api/notifications/prefs').set(auth(an)).expect(200);
    assert.deepEqual(p.body.prefs, { reservation: true, arrival: true, reminder: true, payment: true, support: true });
    p = await api().put('/api/notifications/prefs').set(auth(an)).send({ reminder: false }).expect(200);
    assert.equal(p.body.prefs.reminder, false);
    assert.equal(p.body.prefs.payment, true);
    await api().put('/api/notifications/prefs').set(auth(an)).send({ payment: 'yes' }).expect(400);
  });

  test('Gui thu -> day toi ca 2 thiet bi, co tieu de + kenh Android + so chua doc', async () => {
    expo.sent.length = 0;
    const r = await api().post('/api/push/test').set(auth(an)).expect(200);
    assert.equal(r.body.sent, 2);
    const m = sentTo(TOKEN_A)[0];
    assert.equal(m.title, 'Thông báo thử từ SmartPark');
    assert.equal(m.priority, 'high');
    assert.equal(m.sound, 'default');
    assert.ok(m.channelId);
    assert.ok(m.badge >= 1);
    assert.ok(m.data.notificationId);
  });

  test('Cung may dang nhap tai khoan khac -> token chuyen sang tai khoan moi', async () => {
    await api().post('/api/push/tokens').set(auth(binh)).send({ token: TOKEN_B, platform: 'ios' }).expect(201);
    const a = await api().get('/api/notifications/prefs').set(auth(an)).expect(200);
    assert.equal(a.body.devices.length, 1);
  });
});

describe('Thong bao dat cho, xe den, het han, thanh toan', () => {
  let resvId, sessionId;

  test('Dat cho thanh cong -> day "Dat cho thanh cong" (nhom dat cho)', async () => {
    expo.sent.length = 0;
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 1 }).expect(201);
    resvId = r.body.id;
    const m = await waitFor(() => sentTo(TOKEN_A, 'reservation_confirmed')[0]);
    assert.ok(m, 'phai day thong bao dat cho');
    assert.equal(m.title, 'Đặt chỗ thành công');
    assert.match(m.body, /ô #1/);
    assert.equal(m.data.reservationId, resvId);
    assert.equal(m.channelId, 'parking');
  });

  test('Xe den cong (barie mo) va vao o -> day "Bat dau phien gui xe", "Xe da vao o"', async () => {
    const pass = (await api().get(`/api/reservations/${resvId}/pass`).set(auth(an)).expect(200)).body;
    sessionId = (await api().post('/api/gates/scan').set(auth(adminToken))
      .send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200)).body.sessionId;
    const m = await waitFor(() => sentTo(TOKEN_A, 'session_started')[0]);
    assert.ok(m);
    assert.equal(m.data.sessionId, sessionId);
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'occupied' });
    assert.ok(await waitFor(() => sentTo(TOKEN_A, 'parked')[0]));
  });

  test('Nhom "nhac gio" da tat + loai theo gio -> khong day (chi luu trong app)', async () => {
    await db.query(`UPDATE parking_sessions SET started_at = started_at - interval '3 hours',
      planned_end_at = planned_end_at - interval '3 hours' WHERE id = $1`, [sessionId]);
    const list = (await api().get('/api/notifications').set(auth(an)).expect(200)).body;
    assert.ok(list.items.some((n) => n.type === 'overtime'));
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(sentTo(TOKEN_A, 'overtime').length, 0);
    assert.equal(sentTo(TOKEN_A, 'fee_changed').length, 0);
  });

  test('Xe roi o -> day "da chot phi"; thanh toan -> day "Thanh toan thanh cong" kem paymentId', async () => {
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'free' });
    const left = await waitFor(() => sentTo(TOKEN_A, 'left_slot')[0]);
    assert.equal(left.channelId, 'payment');
    const p = (await api().post(`/api/sessions/${sessionId}/pay`).set(auth(an)).send({ method: 'momo' }).expect(201)).body;
    const paid = await waitFor(() => sentTo(TOKEN_A, 'paid')[0]);
    assert.equal(paid.data.paymentId, p.id);
  });

  test('Tat nhom thanh toan -> khong day thanh toan nua', async () => {
    await api().put('/api/notifications/prefs').set(auth(binh)).send({ payment: false }).expect(200);
    expo.sent.length = 0;
    const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(binh)).send({ slotNumber: 2 }).expect(201)).body;
    assert.ok(await waitFor(() => sentTo(TOKEN_B, 'reservation_confirmed')[0]));
    const pass = (await api().get(`/api/reservations/${r.id}/pass`).set(auth(binh)).expect(200)).body;
    const sid = (await api().post('/api/gates/scan').set(auth(adminToken)).send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200)).body.sessionId;
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 2, state: 'occupied' });
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 2, state: 'free' });
    await api().post(`/api/sessions/${sid}/pay`).set(auth(binh)).send({ method: 'card' }).expect(201);
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(sentTo(TOKEN_B, 'left_slot').length, 0);
    assert.equal(sentTo(TOKEN_B, 'paid').length, 0);
    assert.ok(sentTo(TOKEN_B, 'parked').length === 1);
  });

  test('Dat cho het han (khong den) -> day "Dat cho da het han"', async () => {
    expo.sent.length = 0;
    const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 3 }).expect(201)).body;
    await sync.handleEvent(LOT, { type: 'reservation_expired', slot: 3 });
    const m = await waitFor(() => sentTo(TOKEN_A, 'reservation_expired')[0]);
    assert.ok(m);
    assert.equal(m.data.reservationId, r.id);
    assert.equal(m.title, 'Đặt chỗ đã hết hạn');
  });
});

describe('Danh sach thong bao + bo dem chua doc', () => {
  test('Loc chua doc, danh dau tung cai, doc tat ca', async () => {
    let all = (await api().get('/api/notifications?limit=100').set(auth(an)).expect(200)).body;
    assert.ok(all.unread >= 5);
    const unread = (await api().get('/api/notifications?unread=1&limit=100').set(auth(an)).expect(200)).body;
    assert.equal(unread.items.length, all.unread);
    assert.ok(unread.items.every((n) => !n.read));
    const one = unread.items[0].id;
    const r = (await api().post('/api/notifications/read').set(auth(an)).send({ ids: [one] }).expect(200)).body;
    assert.equal(r.unread, all.unread - 1);
    all = (await api().get('/api/notifications?limit=100').set(auth(an)).expect(200)).body;
    assert.equal(all.items.find((n) => n.id === one).read, true);
    // nguoi khac khong danh dau duoc thong bao cua minh
    await api().post('/api/notifications/read').set(auth(binh)).send({ ids: [unread.items[1].id] }).expect(200);
    assert.equal((await api().get('/api/notifications').set(auth(an)).expect(200)).body.unread, all.unread);
    assert.equal((await api().post('/api/notifications/read').set(auth(an)).send({ all: true }).expect(200)).body.unread, 0);
  });
});

describe('Loi gui day', () => {
  test('Token da go app (DeviceNotRegistered) -> tu xoa; Expo loi mang -> khong anh huong thao tac', async () => {
    await api().post('/api/push/tokens').set(auth(an)).send({ token: TOKEN_DEAD }).expect(201);
    const r = await api().post('/api/push/test').set(auth(an)).expect(200);
    assert.equal(r.body.failed, 1);
    const left = await db.one('SELECT COUNT(*)::int AS n FROM push_tokens WHERE token = $1', [TOKEN_DEAD]);
    assert.equal(left.n, 0);
    expo.down = true;
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 4 }).expect(201); // van dat cho duoc
    expo.down = false;
  });

  test('Dang xuat -> go token', async () => {
    await api().delete('/api/push/tokens').set(auth(an)).send({ token: TOKEN_A }).expect(200);
    const p = await api().get('/api/notifications/prefs').set(auth(an)).expect(200);
    assert.equal(p.body.devices.length, 0);
  });
});
