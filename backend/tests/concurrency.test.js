// KIEM THU TAI DONG THOI (race condition): nhieu yeu cau cung luc vao cung 1 tai nguyen -> du lieu van dung
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
const { createMomoGateway, SANDBOX } = require('../src/paymentGateway');
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const gw = createMomoGateway({ fetchFn: async (url, o) => {
  const b = JSON.parse(o.body);
  return { json: async () => (url.endsWith('/create') ? { resultCode: 0, orderId: b.orderId, payUrl: 'https://pay.test' } : { resultCode: 1000 }) };
} });
const ipn = (orderId, amount) => {
  const b = { partnerCode: 'MOMO', orderId, requestId: orderId, amount, orderInfo: 'x', orderType: 'momo_wallet', transId: 99, resultCode: 0,
    message: 'ok', payType: 'qr', responseTime: 1, extraData: '' };
  return { ...b, signature: gw.sign({ accessKey: SANDBOX.accessKey, ...Object.fromEntries(
    ['amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId']
      .map((k) => [k, b[k]])) }) };
};
let db, app, device, sync, admin;
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (u) => (await api().post('/api/auth/register').send({ username: u, email: `${u}@test.vn`, password: '123456' }).expect(201)).body.token;
const statuses = (rs) => rs.map((r) => r.status).sort().join(',');

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
  app = createApp({ db, auth: createAuth(config, { db }), device, gatePass: createGatePass('conc'), live: createLiveHub(), gateway: gw,
    allowMockPayments: false });
  admin = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
});
after(async () => db && db.end());

describe('Tranh chap tai nguyen', () => {
  test('10 tai xe cung dat 1 o cung luc -> dung 1 nguoi duoc, o chi bi giu 1 lan', async () => {
    const tokens = await Promise.all(Array.from({ length: 10 }, (_, i) => register(`cc_u${i}`)));
    const rs = await Promise.all(tokens.map((t) => api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ slotNumber: 1 })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1, statuses(rs));
    assert.ok(rs.every((r) => r.status === 201 || r.status === 409), statuses(rs));
    const active = await db.one(`SELECT COUNT(*)::int AS n FROM reservations r JOIN slots s ON s.id = r.slot_id
      WHERE s.lot_id = $1 AND s.slot_number = 1 AND r.status IN ('pending', 'active')`, [LOT]);
    assert.equal(active.n, 1);
  });

  test('1 tai xe bam "Dat cho" 5 lan lien tiep -> chi 1 dat cho', async () => {
    const t = await register('cc_double');
    const rs = await Promise.all(Array.from({ length: 5 }, () => api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ zone: 'B' })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1, statuses(rs));
    const n = await db.one(`SELECT COUNT(*)::int AS n FROM reservations r JOIN users u ON u.id = r.user_id
      WHERE u.email = 'cc_double@test.vn' AND r.status IN ('pending', 'active')`);
    assert.equal(n.n, 1);
  });

  test('MoMo gui 8 IPN thanh cong cung luc cho 1 don -> dung 1 giao dich', async () => {
    const t = await register('cc_pay');
    const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ slotNumber: 4 }).expect(201)).body;
    const pass = (await api().get(`/api/reservations/${r.id}/pass`).set(auth(t))).body;
    const sid = (await api().post('/api/gates/scan').set(auth(admin)).send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200)).body.sessionId;
    device.state.slots[3].occupied = true; device.state.slots[3].reserved = false;
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 4, state: 'occupied' });
    device.state.slots[3].occupied = false;
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 4, state: 'free' });
    const o = (await api().post(`/api/sessions/${sid}/checkout`).set(auth(t)).send({ method: 'momo' }).expect(201)).body;
    const rs = await Promise.all(Array.from({ length: 8 }, () => api().post('/api/payments/momo/ipn').send(ipn(o.orderId, o.amount))));
    assert.ok(rs.every((x) => x.status === 204), statuses(rs));
    const n = await db.one('SELECT COUNT(*)::int AS n FROM payments WHERE session_id = $1', [sid]);
    assert.equal(n.n, 1);
    const notes = await db.one(`SELECT COUNT(*)::int AS n FROM notifications WHERE session_id = $1 AND type = 'paid'`, [sid]);
    assert.equal(notes.n, 1, 'chi 1 thong bao "da thanh toan"');
  });

  test('Bam "Yeu thich" / gui danh gia nhieu lan cung luc -> khong trung ban ghi, khong loi 500', async () => {
    const t = await register('cc_fav');
    const fav = await Promise.all(Array.from({ length: 10 }, () => api().put(`/api/favorites/${LOT}`).set(auth(t))));
    assert.ok(fav.every((r) => r.status === 200 || r.status === 201), statuses(fav));
    assert.equal((await api().get('/api/favorites').set(auth(t))).body.length, 1);
    const tok = (await api().post('/api/auth/login').send({ email: 'cc_pay@test.vn', password: '123456' })).body.token;
    const rv = await Promise.all([1, 2, 3, 4, 5].map((rating) => api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(tok)).send({ rating })));
    assert.ok(rv.every((r) => r.status === 200 || r.status === 201), statuses(rv));
    assert.equal((await api().get(`/api/lots/${LOT}/reviews`)).body.summary.count, 1);
  });

  test('Gia han phien 8 lan cung luc (gioi han 5) -> khong vuot gioi han', async () => {
    const t = await register('cc_ext');
    const res = await api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ zone: 'A' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const r = res.body;
    const pass = (await api().get(`/api/reservations/${r.id}/pass`).set(auth(t))).body;
    const sid = (await api().post('/api/gates/scan').set(auth(admin)).send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200)).body.sessionId;
    const rs = await Promise.all(Array.from({ length: 8 }, () => api().post(`/api/sessions/${sid}/extend`).set(auth(t)).send({ minutes: 30 })));
    const s = await db.one('SELECT extend_count FROM parking_sessions WHERE id = $1', [sid]);
    assert.ok(s.extend_count <= 5, `extend_count = ${s.extend_count} (${statuses(rs)})`);
    assert.equal(rs.filter((x) => x.status === 200).length, s.extend_count, 'so lan thanh cong = so lan ghi nhan');
  });

  test('Gia han giu cho 6 lan cung luc (gioi han 2) -> dung 2 lan, thoi gian giu khop so lan', async () => {
    const t = await register('cc_hold');
    const res = await api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ minutes: 15 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const rs = await Promise.all(Array.from({ length: 6 }, () => api().post(`/api/reservations/${res.body.id}/extend`).set(auth(t)).send({ minutes: 10 })));
    assert.equal(rs.filter((x) => x.status === 200).length, 2, statuses(rs));
    const r = await db.one('SELECT extend_count, minutes FROM reservations WHERE id = $1', [res.body.id]);
    assert.deepEqual([r.extend_count, r.minutes], [2, 35]);
  });
});
