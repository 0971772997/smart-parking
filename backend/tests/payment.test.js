// Cong thanh toan MoMo (moi truong thu nghiem) + lich su giao dich + bien nhan dien tu.
// MoMo duoc gia lap bang fetchFn (khong goi mang) - chu ky HMAC van tinh that de kiem tra xac thuc IPN.
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
const { createMomoGateway, SANDBOX } = require('../src/paymentGateway');
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const PUBLIC = 'https://api.test.local';
const gp = createGatePass('pay-test-secret');
const live = createLiveHub();

// ---- MoMo gia lap ----
const momo = { createResult: 0, query: {}, calls: [], down: false };
const fakeFetch = async (url, opts) => {
  if (momo.down) throw new Error('connect ECONNREFUSED');
  const body = JSON.parse(opts.body);
  momo.calls.push({ url, body });
  if (url.endsWith('/v2/gateway/api/create')) {
    return { json: async () => ({ partnerCode: body.partnerCode, orderId: body.orderId, amount: body.amount,
      resultCode: momo.createResult, message: momo.createResult ? 'Yêu cầu bị từ chối' : 'Thành công.',
      payUrl: momo.createResult ? undefined : `https://test-payment.momo.vn/v2/gateway/pay?o=${body.orderId}`,
      deeplink: 'momo://app?action=payWithApp', qrCodeUrl: 'momo://app?action=payWithApp&isScanQR=true' }) };
  }
  if (url.endsWith('/v2/gateway/api/query')) {
    return { json: async () => ({ orderId: body.orderId, amount: 10000, transId: 0, payType: '', message: '',
      resultCode: 1000, ...(momo.query[body.orderId] || {}) }) };
  }
  throw new Error('unexpected ' + url);
};
const gw = createMomoGateway({ fetchFn: fakeFetch });
const signResult = (b) => gw.sign({ accessKey: SANDBOX.accessKey, amount: b.amount, extraData: b.extraData, message: b.message,
  orderId: b.orderId, orderInfo: b.orderInfo, orderType: b.orderType, partnerCode: b.partnerCode, payType: b.payType,
  requestId: b.requestId, responseTime: b.responseTime, resultCode: b.resultCode, transId: b.transId });
const momoResult = (o, resultCode, extra = {}) => {
  const b = { partnerCode: 'MOMO', orderId: o.orderId, requestId: o.orderId, amount: o.amount, orderInfo: 'SmartPark',
    orderType: 'momo_wallet', transId: 4100000001, resultCode, message: resultCode ? 'Từ chối' : 'Thành công.',
    payType: 'qr', responseTime: 1795274082703, extraData: '', ...extra };
  return { ...b, signature: signResult(b) };
};

let db, app, device, sync, adminToken, an, binh;
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456' }).expect(201)).body.token;
const pass = async (token, id) => (await api().get(`/api/reservations/${id}/pass`).set(auth(token)).expect(200)).body;
const scan = (gate, token) => api().post('/api/gates/scan').set(auth(adminToken)).send({ lotId: LOT, gate, token });
const park = (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); };
const leave = (n) => { device.state.slots[n - 1].occupied = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); };
const checkout = (token, sid, method) => api().post(`/api/sessions/${sid}/checkout`).set(auth(token)).send({ method });
const order = (token, id) => api().get(`/api/payments/orders/${id}`).set(auth(token));

// Dat cho -> qua cong -> do -> roi o => phien da chot phi 10.000d
async function finishedSession(token, slot) {
  const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(token)).send({ slotNumber: slot, durationMinutes: 60 }).expect(201)).body;
  const e = (await scan('entry', (await pass(token, r.id)).token).expect(200)).body;
  await park(slot);
  await leave(slot);
  return { resvId: r.id, sessionId: e.sessionId };
}

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@test.vn', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]);
  device = createFakeDevice(4);
  sync = createSync(db, { live });
  sync.attachDevice(device);
  app = createApp({ db, auth: createAuth(config), device, gatePass: gp, live, gateway: gw, publicUrl: PUBLIC,
    receiptSecret: 'receipt-test', allowMockPayments: false });
  adminToken = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
  an = await register('pay_an');
  binh = await register('pay_binh');
});

after(async () => db && db.end());

describe('Cong thanh toan MoMo (thu nghiem)', () => {
  let sid, resvId, orderA, orderB, paymentId, receiptUrl;

  test('Cau hinh: MoMo sandbox, 3 phuong thuc, co huong dan the test; thanh toan gia lap bi tat', async () => {
    const c = await api().get('/api/payments/config').set(auth(an)).expect(200);
    assert.equal(c.body.provider, 'momo');
    assert.equal(c.body.sandbox, true);
    assert.deepEqual(c.body.methods, ['momo', 'atm', 'card']);
    assert.match(c.body.hints.atm, /9704/);
    assert.equal(c.body.mockEnabled, false);
  });

  test('Xe dang trong o -> chua tao don duoc; xe roi o -> tao don MoMo (chu ky dung, IPN/redirect ve may chu)', async () => {
    const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 1, durationMinutes: 60 }).expect(201)).body;
    resvId = r.id;
    sid = (await scan('entry', (await pass(an, r.id)).token).expect(200)).body.sessionId;
    await park(1);
    assert.equal((await checkout(an, sid, 'momo').expect(409)).body.error, 'session_not_ended');
    await leave(1);
    await checkout(an, sid, 'bitcoin').expect(400);
    await checkout(binh, sid, 'momo').expect(404);
    const o = await checkout(an, sid, 'momo').expect(201);
    orderA = o.body;
    assert.equal(o.body.status, 'pending');
    assert.equal(o.body.amount, 10000);
    assert.match(o.body.payUrl, /^https:\/\/test-payment\.momo\.vn/);
    const sent = momo.calls.at(-1).body;
    assert.equal(sent.requestType, 'captureWallet');
    assert.equal(sent.amount, 10000);
    assert.equal(sent.ipnUrl, `${PUBLIC}/api/payments/momo/ipn`);
    assert.equal(sent.redirectUrl, `${PUBLIC}/api/payments/momo/return`);
    const { signature, ...f } = sent;
    assert.equal(signature, gw.sign({ accessKey: SANDBOX.accessKey, amount: f.amount, extraData: f.extraData, ipnUrl: f.ipnUrl,
      orderId: f.orderId, orderInfo: f.orderInfo, partnerCode: f.partnerCode, redirectUrl: f.redirectUrl, requestId: f.requestId,
      requestType: f.requestType }));
  });

  test('Bam thanh toan lan nua -> dung lai don dang cho; tra cuu -> van dang cho', async () => {
    const again = await checkout(an, sid, 'momo').expect(200);
    assert.equal(again.body.orderId, orderA.orderId);
    const st = await order(an, orderA.orderId).expect(200);
    assert.equal(st.body.status, 'pending');
    await order(binh, orderA.orderId).expect(404);
  });

  test('IPN gia mao (sai chu ky) bi tu choi; sai so tien bi bo qua', async () => {
    const fake = momoResult(orderA, 0);
    await api().post('/api/payments/momo/ipn').send({ ...fake, signature: 'x'.repeat(64) }).expect(400);
    await api().post('/api/payments/momo/ipn').send({ ...fake, resultCode: 0, transId: 1 }).expect(400); // doi du lieu sau khi ky
    await api().post('/api/payments/momo/ipn').send(momoResult(orderA, 0, { amount: 1000 })).expect(204);
    assert.equal((await order(an, orderA.orderId).expect(200)).body.status, 'pending');
  });

  test('Nguoi dung tu choi tren MoMo (IPN 1006) -> don that bai, co ly do + thong bao', async () => {
    await api().post('/api/payments/momo/ipn').send(momoResult(orderA, 1006)).expect(204);
    const st = (await order(an, orderA.orderId).expect(200)).body;
    assert.equal(st.status, 'failed');
    assert.equal(st.message, 'Người dùng đã từ chối thanh toán');
    const n = (await api().get('/api/notifications').set(auth(an)).expect(200)).body.items;
    assert.ok(n.some((x) => x.type === 'payment_failed'));
    // phien van chua thanh toan
    const p = await pass(an, resvId);
    assert.equal(p.block.error, 'payment_required');
  });

  test('Thu lai bang the ATM -> IPN khong toi, tra cuu MoMo thay thanh cong -> giao dich + bien nhan', async () => {
    orderB = (await checkout(an, sid, 'atm').expect(201)).body;
    assert.notEqual(orderB.orderId, orderA.orderId);
    assert.equal(momo.calls.at(-1).body.requestType, 'payWithATM');
    momo.query[orderB.orderId] = { resultCode: 0, transId: 4100000777, payType: 'napas', message: 'Thành công.' };
    const st = (await order(an, orderB.orderId).expect(200)).body;
    assert.equal(st.status, 'paid');
    assert.equal(st.transId, '4100000777');
    const p = st.payment;
    paymentId = p.id;
    receiptUrl = p.receiptUrl;
    assert.match(p.receiptNo, /^BL\d{8}-\d{6}$/);
    assert.equal(p.amount, 10000);
    assert.equal(p.method, 'atm');
    assert.equal(p.methodLabel, 'Thẻ ATM nội địa');
    assert.equal(p.provider, 'momo');
    assert.equal(p.gatewayTransId, '4100000777');
    assert.equal(p.breakdown.total, 10000);
    assert.equal(p.breakdown.hours, 1);
    assert.equal(p.breakdown.lines[0].amount, 10000);
    assert.equal(p.breakdown.slotNumber, 1);
    assert.ok(p.breakdown.reservationCode);
    // Cong ra: da tra phi -> qua duoc
    assert.equal((await pass(an, resvId)).block, null);
  });

  test('IPN thanh cong den sau (lap lai) -> khong tao giao dich trung; thanh toan lai -> already_paid', async () => {
    await api().post('/api/payments/momo/ipn').send(momoResult(orderB, 0)).expect(204);
    const n = await db.one('SELECT COUNT(*)::int AS n FROM payments WHERE session_id = $1', [sid]);
    assert.equal(n.n, 1);
    assert.equal((await checkout(an, sid, 'card').expect(409)).body.error, 'already_paid');
  });

  test('Trang tro ve tu MoMo (redirect co chu ky) hien ket qua', async () => {
    const q = momoResult(orderB, 0);
    const r = await api().get('/api/payments/momo/return').query(q).expect(200);
    assert.match(r.text, /Thanh toán thành công/);
    assert.match(r.text, /10\.000đ/);
  });

  test('Bien nhan dien tu: JSON cho chu so huu; lien ket HTML co chu ky in duoc; sai chu ky -> 404', async () => {
    const j = (await api().get(`/api/payments/${paymentId}`).set(auth(an)).expect(200)).body;
    assert.equal(j.receiptUrl, receiptUrl);
    assert.ok(receiptUrl.startsWith(`${PUBLIC}/api/receipts/`));
    await api().get(`/api/payments/${paymentId}`).set(auth(binh)).expect(404);
    const path = receiptUrl.slice(PUBLIC.length);
    const html = await api().get(path).expect(200);
    assert.match(html.text, new RegExp(j.receiptNo));
    assert.match(html.text, /ĐÃ THANH TOÁN/);
    assert.match(html.text, /4100000777/);
    await api().get(path.replace(/t=.*/, 't=khong-dung-chu-ky-abcd')).expect(404);
  });

  test('Lich su giao dich: co giao dich vua tra (moi nhat truoc); nguoi khac khong thay', async () => {
    const mine = (await api().get('/api/payments').set(auth(an)).expect(200)).body;
    assert.equal(mine[0].id, paymentId);
    assert.equal(mine[0].lotName, 'Bãi đỗ xe thông minh');
    assert.equal((await api().get('/api/payments').set(auth(binh)).expect(200)).body.length, 0);
    const s = (await api().get(`/api/sessions/${sid}`).set(auth(an)).expect(200)).body;
    assert.equal(s.paid, true);
    assert.equal(s.payment.id, paymentId);
    await scan('exit', (await pass(an, resvId)).token).expect(200);
  });
});

describe('Loi va tinh huong ngoai le', () => {
  test('Cong tu choi tao don -> 502 gateway_error; khong ket noi duoc -> 502 gateway_unavailable', async () => {
    const { sessionId } = await finishedSession(binh, 2);
    momo.createResult = 22;
    assert.equal((await checkout(binh, sessionId, 'momo').expect(502)).body.error, 'gateway_error');
    momo.createResult = 0;
    momo.down = true;
    assert.equal((await checkout(binh, sessionId, 'card').expect(502)).body.error, 'gateway_unavailable');
    momo.down = false;
    // MoMo khong tra loi khi tra cuu -> don giu nguyen 'pending' (khong loi 500)
    const o = (await checkout(binh, sessionId, 'card').expect(201)).body;
    assert.equal(momo.calls.at(-1).body.requestType, 'payWithCC');
    momo.down = true;
    assert.equal((await order(binh, o.orderId).expect(200)).body.status, 'pending');
    momo.down = false;
  });

  test('Don qua han ma MoMo van bao dang cho -> het han; tao don moi duoc', async () => {
    const o = (await db.one(`SELECT * FROM payment_orders WHERE status = 'pending' ORDER BY id DESC LIMIT 1`));
    await db.query(`UPDATE payment_orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, [o.id]);
    assert.equal((await order(binh, o.order_id).expect(200)).body.status, 'expired');
    const n = (await checkout(binh, o.session_id, 'momo').expect(201)).body;
    assert.notEqual(n.orderId, o.order_id);
    await api().post('/api/payments/momo/ipn').send(momoResult(n, 0)).expect(204);
    assert.equal((await order(binh, n.orderId).expect(200)).body.status, 'paid');
  });

  test('Vao roi ra ngay (mien phi) -> khong can thanh toan', async () => {
    const r = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 3 }).expect(201)).body;
    const e = (await scan('entry', (await pass(an, r.id)).token).expect(200)).body;
    assert.equal((await checkout(an, e.sessionId, 'momo').expect(409)).body.error, 'no_payment_needed');
    await scan('exit', (await pass(an, r.id)).token).expect(200);
  });

  test('Production: thanh toan gia lap tuc thi bi tat -> phai qua cong', async () => {
    const { sessionId } = await finishedSession(an, 4);
    const r = await api().post(`/api/sessions/${sessionId}/pay`).set(auth(an)).send({ method: 'momo' }).expect(403);
    assert.equal(r.body.error, 'use_gateway');
  });

  test('Admin thu tien mat -> bien nhan ghi thu ngan, cong "Thu tai quay"', async () => {
    const s = (await api().get(`/api/lots/${LOT}/sessions`).set(auth(adminToken)).expect(200)).body.find((x) => x.slotNumber === 4);
    const p = (await api().post(`/api/lots/${LOT}/sessions/${s.id}/pay`).set(auth(adminToken)).send({}).expect(201)).body;
    assert.equal(p.provider, 'cash');
    assert.equal(p.collectorName, 'Admin');
    assert.match(p.receiptNo, /^BL/);
  });
});
