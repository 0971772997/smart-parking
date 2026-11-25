// 1 ma QR chung cho cong vao + ra; tra tien mat / chuyen khoan MB / vi MoMo -> admin xac nhan -> mo barie cong ra
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
const { crc16 } = require('../src/vietqr');
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const payee = { bankName: 'MB Bank', bankBin: '970422', accountNo: '0971772997', accountName: 'VO VIET MINH', momoPhone: '0971772997' };
let db, app, device, sync, adminToken, an, binh, sessionId, orderId;

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const gateToken = async () => (await api().get(`/api/gates/display?lotId=${LOT}`).set(auth(adminToken)).expect(200)).body.token;
const checkin = async (t) => api().post('/api/gates/checkin').set(auth(t)).send({ token: await gateToken() });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456' }).expect(201)).body.token;

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@test.vn', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]);
  device = createFakeDevice(4);
  sync = createSync(db);
  // allowMockPayments = false giong production
  app = createApp({ db, auth: createAuth(config), device, gatePass: createGatePass('mp-secret'), allowMockPayments: false, payee });
  adminToken = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
  an = await register('mp_an');
  binh = await register('mp_binh');
});

after(async () => db && db.end());

describe('1 ma QR chung cho cong vao va ra', () => {
  test('Ma mac dinh la ma chung (G); van lay duoc ma rieng tung cong', async () => {
    const d = (await api().get(`/api/gates/display?lotId=${LOT}`).set(auth(adminToken)).expect(200)).body;
    assert.equal(d.gate, 'any');
    assert.match(d.token, /^SPG1\.[\w-]+\.G\./);
    const e = (await api().get(`/api/gates/display?lotId=${LOT}&gate=entry`).set(auth(adminToken)).expect(200)).body;
    assert.match(e.token, /\.E\./);
  });

  test('Cung 1 ma: lan dau -> cong VAO, sau khi vao -> cong RA (xe con trong o -> still_parked)', async () => {
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 1 }).expect(201);
    const inn = await checkin(an);
    assert.equal(inn.status, 200, JSON.stringify(inn.body));
    assert.equal(inn.body.gate, 'entry');
    sessionId = inn.body.sessionId;
    assert.equal(device.state.log.at(-1).gate, 'entry');
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'occupied' });
    const parked = await checkin(an);
    assert.equal(parked.status, 409);
    assert.equal(parked.body.error, 'still_parked');
    assert.equal(parked.body.details.gate, 'exit');
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'free' });
    const unpaid = await checkin(an);
    assert.equal(unpaid.status, 402);
    assert.equal(unpaid.body.details.sessionId, sessionId);
  });
});

describe('Tra tien mat / chuyen khoan -> admin xac nhan -> mo cong', () => {
  test('Cau hinh tra ve tai khoan nhan tien + phuong thuc', async () => {
    const c = (await api().get('/api/payments/config').set(auth(an)).expect(200)).body;
    assert.deepEqual(c.manual.methods, ['cash', 'bank', 'momo']);
    assert.equal(c.manual.payee.accountNo, '0971772997');
    assert.equal(c.manual.payee.accountName, 'VO VIET MINH');
  });

  test('Chon tien mat -> don cho xac nhan; doi sang chuyen khoan -> giu ma don, co VietQR', async () => {
    const cash = await api().post(`/api/sessions/${sessionId}/manual-pay`).set(auth(an)).send({ method: 'cash' }).expect(201);
    orderId = cash.body.orderId;
    assert.match(orderId, /^SP\d+[0-9A-F]{4}$/);
    assert.equal(cash.body.status, 'pending');
    assert.equal(cash.body.payInfo, null);
    assert.ok(cash.body.amount > 0);
    const bank = await api().post(`/api/sessions/${sessionId}/manual-pay`).set(auth(an)).send({ method: 'bank' }).expect(200);
    assert.equal(bank.body.orderId, orderId);
    assert.equal(bank.body.method, 'bank');
    const qr = bank.body.payInfo.vietqr;
    assert.ok(qr.includes('0006970422'));
    assert.ok(qr.includes('01100971772997'));
    assert.ok(qr.includes(`54${String(bank.body.amount).length.toString().padStart(2, '0')}${bank.body.amount}`));
    assert.ok(qr.includes(orderId));
    assert.equal(qr.slice(-4), crc16(qr.slice(0, -4)));
    assert.equal(bank.body.payInfo.content, orderId);
    await api().post(`/api/sessions/${sessionId}/manual-pay`).set(auth(an)).send({ method: 'visa' }).expect(400);
    await api().post(`/api/sessions/${sessionId}/manual-pay`).set(auth(binh)).send({ method: 'cash' }).expect(404);
    // Tai xe xem lai don: van cho, kem thong tin chuyen khoan
    const o = (await api().get(`/api/payments/orders/${orderId}`).set(auth(an)).expect(200)).body;
    assert.equal(o.status, 'pending');
    assert.equal(o.payInfo.accountNo, '0971772997');
  });

  test('Tai xe khong tu xac nhan duoc; admin thay don cho', async () => {
    await api().post(`/api/payments/orders/${orderId}/confirm`).set(auth(an)).expect(403);
    await api().get('/api/payments/pending').set(auth(an)).expect(403);
    const list = (await api().get(`/api/payments/pending?lotId=${LOT}`).set(auth(adminToken)).expect(200)).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].orderId, orderId);
    assert.equal(list[0].methodLabel, 'Chuyển khoản ngân hàng');
    assert.equal(list[0].slotNumber, 1);
  });

  test('Admin xac nhan da nhan tien -> giao dich + barie cong RA mo ngay; bam lai -> 409', async () => {
    const n0 = device.state.log.filter((c) => c.action === 'open_gate').length;
    const r = await api().post(`/api/payments/orders/${orderId}/confirm`).set(auth(adminToken)).send({}).expect(200);
    assert.equal(r.body.payment.method, 'bank');
    assert.ok(r.body.payment.receiptNo);
    assert.equal(r.body.gate.opened, true, JSON.stringify(r.body.gate));
    assert.equal(r.body.gate.gate, 'exit');
    assert.ok(r.body.gate.reservation.exitedAt);
    assert.equal(device.state.log.filter((c) => c.action === 'open_gate').length, n0 + 1);
    assert.equal(device.state.log.at(-1).gate, 'exit');
    assert.equal((await api().post(`/api/payments/orders/${orderId}/confirm`).set(auth(adminToken)).expect(409)).body.error, 'already_paid');
    const o = (await api().get(`/api/payments/orders/${orderId}`).set(auth(an)).expect(200)).body;
    assert.equal(o.status, 'paid');
    assert.ok(o.payment.receiptNo);
    assert.deepEqual((await api().get('/api/payments/pending').set(auth(adminToken)).expect(200)).body, []);
  });

  test('Admin bao chua nhan duoc tien -> don that bai, tai xe chon lai; xac nhan khong mo cong khi openGate=false', async () => {
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(binh)).send({ slotNumber: 2 }).expect(201);
    const inn = await checkin(binh);
    assert.equal(inn.status, 200);
    await db.query(`UPDATE parking_sessions SET started_at = now() - interval '2 hours' WHERE id = $1`, [inn.body.sessionId]);
    const o1 = (await api().post(`/api/sessions/${inn.body.sessionId}/manual-pay`).set(auth(binh)).send({ method: 'momo' }).expect(201)).body;
    assert.equal(o1.payInfo.momoPhone, '0971772997');
    const rej = await api().post(`/api/payments/orders/${o1.orderId}/reject`).set(auth(adminToken)).send({ reason: 'Chưa thấy tiền' }).expect(200);
    assert.equal(rej.body.status, 'failed');
    assert.equal(rej.body.message, 'Chưa thấy tiền');
    await api().post(`/api/payments/orders/${o1.orderId}/confirm`).set(auth(adminToken)).expect(409);
    const o2 = (await api().post(`/api/sessions/${inn.body.sessionId}/manual-pay`).set(auth(binh)).send({ method: 'cash' }).expect(201)).body;
    assert.notEqual(o2.orderId, o1.orderId);
    const r = await api().post(`/api/payments/orders/${o2.orderId}/confirm`).set(auth(adminToken)).send({ openGate: false }).expect(200);
    assert.equal(r.body.payment.method, 'cash');
    assert.equal(r.body.gate.opened, false);
    // Da tra -> tai xe quet ma chung -> barie ra mo
    const out = await checkin(binh);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.gate, 'exit');
  });

  test('Thu tien mat tai cong (nut cu) dong thoi danh dau don dang cho + mo cong', async () => {
    const t = await register('mp_chi');
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ slotNumber: 3 }).expect(201);
    const inn = (await checkin(t)).body;
    await db.query(`UPDATE parking_sessions SET started_at = now() - interval '2 hours' WHERE id = $1`, [inn.sessionId]);
    const o = (await api().post(`/api/sessions/${inn.sessionId}/manual-pay`).set(auth(t)).send({ method: 'cash' }).expect(201)).body;
    const r = await api().post(`/api/lots/${LOT}/sessions/${inn.sessionId}/pay`).set(auth(adminToken))
      .send({ method: 'cash', openGate: true }).expect(201);
    assert.equal(r.body.gate.opened, true);
    assert.equal((await api().get(`/api/payments/orders/${o.orderId}`).set(auth(t)).expect(200)).body.status, 'paid');
  });
});

describe('Gia han giu cho: moi lan +5.000d, cong vao phi gui xe', () => {
  test('2 lan gia han -> phi du kien +10.000d; vao, do, roi o -> phi chot gom 10.000d, bien nhan co dong rieng', async () => {
    const t = await register('mp_hold');
    const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(t)).send({ slotNumber: 4 }).expect(201)).body;
    const e1 = (await api().post(`/api/reservations/${r.id}/extend`).set(auth(t)).send({ minutes: 10 }).expect(200)).body;
    assert.equal(e1.estimatedFee, r.estimatedFee + 5000);
    const e2 = (await api().post(`/api/reservations/${r.id}/extend`).set(auth(t)).send({ minutes: 15 }).expect(200)).body;
    assert.equal(e2.estimatedFee, r.estimatedFee + 10000);
    const rules = (await api().get('/api/reservations/rules').set(auth(t)).expect(200)).body;
    assert.equal(rules.extend.fee, 5000);

    const inn = (await checkin(t)).body;
    const live = (await api().get(`/api/sessions/${inn.sessionId}`).set(auth(t)).expect(200)).body;
    assert.equal(live.cost.holdFee, 10000);
    assert.equal(live.cost.holdExtensions, 2);
    assert.equal(live.cost.total, live.cost.base + live.cost.overtime + 10000);

    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 4, state: 'occupied' });
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 4, state: 'free' });
    const done = (await api().get(`/api/sessions/${inn.sessionId}`).set(auth(t)).expect(200)).body;
    assert.equal(done.cost.final, true);
    assert.equal(done.cost.holdFee, 10000);
    assert.equal(done.amountDue, done.cost.base + 10000);
    const unpaid = await checkin(t);
    assert.equal(unpaid.status, 402);
    assert.equal(unpaid.body.details.fee, done.amountDue);

    const o = (await api().post(`/api/sessions/${inn.sessionId}/manual-pay`).set(auth(t)).send({ method: 'cash' }).expect(201)).body;
    assert.equal(o.amount, done.amountDue);
    const c = (await api().post(`/api/payments/orders/${o.orderId}/confirm`).set(auth(adminToken)).send({}).expect(200)).body;
    assert.equal(c.payment.amount, done.amountDue);
    const line = c.payment.breakdown.lines.find((l) => l.label.startsWith('Phí gia hạn giữ chỗ'));
    assert.equal(line.amount, 10000);
    assert.match(line.label, /2 lần/);
    assert.equal(c.gate.opened, true);
  });

  test('Khong gia han -> khong co phi giu cho', async () => {
    const s = (await api().get(`/api/sessions/${sessionId}`).set(auth(an)).expect(200)).body;
    assert.equal(s.cost.holdFee, 0);
  });
});
