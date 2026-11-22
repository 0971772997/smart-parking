// KIEM THU DAU CUOI (E2E): may chu HTTP that (cong ngau nhien) + fetch nhu app; ESP32 gia lap (ack lenh, cam bien o);
// cong MoMo gia lap voi chu ky HMAC that (IPN ky bang khoa test cong khai).
// Kich ban: dat cho -> QR cong vao -> xe vao o -> gia han -> roi o -> thanh toan -> QR cong ra -> ket thuc
//           + thanh toan that bai roi tra lai, huy, khong den, gian doan (thiet bi / cong thanh toan / IPN lap / mat ket noi app)
process.env.NODE_ENV = 'test';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
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
let db, server, base, device, sync, staff;

// ---- MoMo gia lap: tao don + tra cuu; IPN do test tu gui (ky that) ----
const momo = { query: {}, down: false };
const gw = createMomoGateway({
  fetchFn: async (url, opts) => {
    if (momo.down) throw new Error('connect ETIMEDOUT');
    const b = JSON.parse(opts.body);
    if (url.endsWith('/create')) {
      return { json: async () => ({ resultCode: 0, orderId: b.orderId, amount: b.amount, payUrl: `https://test-payment.momo.vn/pay?o=${b.orderId}` }) };
    }
    return { json: async () => ({ orderId: b.orderId, resultCode: 1000, ...(momo.query[b.orderId] || {}) }) };
  },
});
const ipnBody = (orderId, amount, resultCode) => {
  const b = { partnerCode: 'MOMO', orderId, requestId: orderId, amount, orderInfo: 'SmartPark', orderType: 'momo_wallet',
    transId: 4200000000 + Math.floor(Math.random() * 1e6), resultCode, message: resultCode ? 'Từ chối' : 'Thành công.', payType: 'qr',
    responseTime: Date.now(), extraData: '' };
  return { ...b, signature: gw.sign({ accessKey: SANDBOX.accessKey, ...Object.fromEntries(
    ['amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId']
      .map((k) => [k, b[k]])) }) };
};

// ---- "App" goi API qua HTTP that ----
async function call(method, path, { token, body, expect } = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (expect !== undefined) assert.equal(r.status, expect, `${method} ${path} -> ${r.status} ${text}`);
  return { status: r.status, data };
}
const get = (p, o) => call('GET', p, o);
const post = (p, o) => call('POST', p, o);
// ESP32: cam bien thay xe vao / roi o
const sensor = {
  park: (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
    return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); },
  leave: (n) => { device.state.slots[n - 1].occupied = false; return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); },
};
const scan = (gate, qr, expect) => post('/api/gates/scan', { token: staff, body: { lotId: LOT, gate, token: qr }, expect });
const types = async (token) => (await get('/api/notifications?limit=50', { token })).data.items.map((n) => n.type);
const signup = async (u) => (await post('/api/auth/register', { body: { username: u, email: `${u}@test.vn`, password: 'matkhau123' }, expect: 201 })).data.token;

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ('staff@test.vn', $1, 'Nhan vien cong', 'admin')`,
    [await bcrypt.hash('staff123', 4)]);
  const live = createLiveHub();
  device = createFakeDevice(4);
  sync = createSync(db, { live });
  sync.attachDevice(device);
  const app = createApp({ db, auth: createAuth(config, { db }), device, gatePass: createGatePass('e2e-secret'), live,
    gateway: gw, publicUrl: 'https://api.e2e.local', receiptSecret: 'e2e-receipt', allowMockPayments: false });
  server = app.listen(0);
  await new Promise((ok) => server.once('listening', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  staff = (await post('/api/auth/login', { body: { email: 'staff@test.vn', password: 'staff123' }, expect: 200 })).data.token;
});
after(async () => {
  await new Promise((ok) => server.close(ok));
  await db.end();
});

describe('Quy trinh day du: dat cho -> vao -> do -> gia han -> roi o -> thanh toan MoMo -> ra', () => {
  let me, resv, qrIn, sessionId, order, payment;

  test('1. Dang ky, them xe, xem bai do con cho', async () => {
    me = await signup('e2e_lan');
    await post('/api/vehicles', { token: me, body: { plateNumber: '43A-555.55', brand: 'Vios' }, expect: 201 });
    const lots = (await get('/api/lots', { expect: 200 })).data;
    const lot = lots.find((l) => l.id === LOT);
    assert.equal(lot.freeSlots, 4);
    const d = (await get(`/api/lots/${LOT}`, { expect: 200 })).data;
    assert.deepEqual(d.zones.map((z) => [z.zone, z.free]), [['A', 2], ['B', 2]]);
  });

  test('2. Dat cho khu B (may chu tu chon o) -> ESP32 xac nhan giu o, co ma DC-, phi du kien, thong bao', async () => {
    const veh = (await get('/api/vehicles', { token: me })).data[0];
    resv = (await post(`/api/lots/${LOT}/reservations`, { token: me, body: { zone: 'B', minutes: 15, durationMinutes: 60, vehicleId: veh.id }, expect: 201 })).data;
    assert.equal(resv.status, 'active');
    assert.equal(resv.slotNumber, 3);
    assert.match(resv.code, /^DC-/);
    assert.equal(resv.estimatedFee, 10000);
    assert.equal(device.state.slots[2].reserved, true, 'ESP32 da giu o 3');
    assert.ok((await types(me)).includes('reservation_confirmed'));
  });

  test('3. Lay ma QR cong vao -> nhan vien quet -> barie mo, phien gui xe bat dau; app dang long-poll duoc danh thuc', async () => {
    qrIn = (await get(`/api/reservations/${resv.id}/pass`, { token: me, expect: 200 })).data;
    assert.equal(qrIn.gate, 'entry');
    const { version } = (await get('/api/live?wait=0')).data;
    const waiting = get(`/api/live?v=${version}&wait=10`);
    const r = (await scan('entry', qrIn.token, 200)).data;
    assert.ok(r.sessionId);
    sessionId = r.sessionId;
    assert.ok(device.state.log.some((c) => c.action === 'open_gate' && c.gate === 'entry'));
    assert.equal((await waiting).data.changed, true);
    const s = (await get('/api/sessions/active', { token: me })).data.session;
    assert.deepEqual([s.id, s.phase, s.vehiclePlate], [sessionId, 'entered', '43A-555.55']);
  });

  test('4. Ma QR vao dung lai -> bi tu choi (chong dung lai / chup man hinh)', async () => {
    const r = await scan('entry', qrIn.token);
    assert.ok(r.status >= 400);
  });

  test('5. Cam bien thay xe vao o -> parked, dat cho fulfilled', async () => {
    await sensor.park(3);
    const s = (await get(`/api/sessions/${sessionId}`, { token: me, expect: 200 })).data;
    assert.equal(s.phase, 'parked');
    assert.equal((await get(`/api/reservations/${resv.id}`, { token: me })).data.status, 'fulfilled');
  });

  test('6. Gia han them 60 phut -> phi du kien moi', async () => {
    const s = (await post(`/api/sessions/${sessionId}/extend`, { token: me, body: { minutes: 60 }, expect: 200 })).data;
    assert.equal(s.plannedMinutes, 120);
    assert.equal(s.cost.planned, 20000);
  });

  test('7. Ra cong khi xe con trong o -> chan (still_parked)', async () => {
    const qr = (await get(`/api/reservations/${resv.id}/pass`, { token: me, expect: 200 })).data;
    assert.equal(qr.gate, 'exit');
    assert.equal((await scan('exit', qr.token)).data.error, 'still_parked');
  });

  test('8. Gui 70 phut, xe roi o -> chot phi 20.000d (2 gio), chua tra -> cong ra bao payment_required', async () => {
    await db.query(`UPDATE parking_sessions SET started_at = started_at - interval '70 minutes',
      planned_end_at = planned_end_at - interval '70 minutes', parked_at = parked_at - interval '70 minutes' WHERE id = $1`, [sessionId]);
    await sensor.leave(3);
    const s = (await get(`/api/sessions/${sessionId}`, { token: me })).data;
    assert.deepEqual([s.phase, s.cost.final, s.cost.total, s.canPay], ['left', true, 20000, true]);
    assert.ok((await types(me)).includes('left_slot'));
    const qr = (await get(`/api/reservations/${resv.id}/pass`, { token: me })).data;
    assert.equal(qr.block.error, 'payment_required');
    const r = await scan('exit', qr.token);
    assert.equal(r.status, 402);
  });

  test('9. Thanh toan MoMo: tao don -> trang MoMo; IPN co chu ky -> da tra, bien nhan, thong bao', async () => {
    order = (await post(`/api/sessions/${sessionId}/checkout`, { token: me, body: { method: 'momo' }, expect: 201 })).data;
    assert.equal(order.amount, 20000);
    assert.match(order.payUrl, /^https:\/\/test-payment\.momo\.vn/);
    await post('/api/payments/momo/ipn', { body: ipnBody(order.orderId, 20000, 0), expect: 204 });
    const o = (await get(`/api/payments/orders/${order.orderId}`, { token: me, expect: 200 })).data;
    assert.equal(o.status, 'paid');
    payment = o.payment;
    assert.match(payment.receiptNo, /^BL\d{8}-\d{6}$/);
    assert.equal(payment.amount, 20000);
    assert.ok((await types(me)).includes('paid'));
    const html = await fetch(base + new URL(payment.receiptUrl).pathname + new URL(payment.receiptUrl).search);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /20\.000/);
  });

  test('10. IPN gui lai (MoMo retry) -> khong tao giao dich thu 2', async () => {
    await post('/api/payments/momo/ipn', { body: ipnBody(order.orderId, 20000, 0), expect: 204 });
    assert.equal((await get('/api/payments', { token: me })).data.length, 1);
  });

  test('11. Ma QR cong ra -> barie mo -> phien ket thuc, het xe trong bai', async () => {
    const qr = (await get(`/api/reservations/${resv.id}/pass`, { token: me })).data;
    assert.equal(qr.block, null);
    await scan('exit', qr.token, 200);
    const s = (await get(`/api/sessions/${sessionId}`, { token: me })).data;
    assert.equal(s.phase, 'completed');
    assert.equal((await get('/api/sessions/active', { token: me })).data.session, null);
    assert.ok((await types(me)).includes('exited'));
    assert.equal((await get(`/api/lots/${LOT}/live?wait=0`)).data.carsInLot, 0);
  });

  test('12. Sau chuyen di: lich su co phien da tra; duoc danh gia bai; quan tri thay doanh thu', async () => {
    const h = (await get('/api/history', { token: me })).data;
    assert.equal(h.summary.sessions, 1);
    assert.equal(h.summary.paid, 20000);
    assert.equal(h.items[0].session.paid, true);
    await call('PUT', `/api/lots/${LOT}/reviews/mine`, { token: me, body: { rating: 5, tags: ['gate_fast'] }, expect: 201 });
    const o = (await get('/api/admin/overview', { token: staff, expect: 200 })).data;
    assert.equal(o.todayStats.revenue, 20000);
    const scans = (await get('/api/gates/scans', { token: staff })).data;
    assert.ok(scans.filter((x) => x.result === 'granted').length >= 2);
  });
});

describe('Nhanh thay the va gian doan', () => {
  test('Thanh toan bi tu choi (1006) -> that bai, tra lai bang the ATM; IPN khong toi -> app tra cuu -> thanh cong', async () => {
    const me = await signup('e2e_minh');
    const r = (await post(`/api/lots/${LOT}/reservations`, { token: me, body: { slotNumber: 1, durationMinutes: 60 }, expect: 201 })).data;
    const sid = (await scan('entry', (await get(`/api/reservations/${r.id}/pass`, { token: me })).data.token, 200)).data.sessionId;
    await sensor.park(1); await sensor.leave(1);
    const o1 = (await post(`/api/sessions/${sid}/checkout`, { token: me, body: { method: 'momo' }, expect: 201 })).data;
    await post('/api/payments/momo/ipn', { body: ipnBody(o1.orderId, o1.amount, 1006), expect: 204 });
    assert.equal((await get(`/api/payments/orders/${o1.orderId}`, { token: me })).data.status, 'failed');
    assert.ok((await types(me)).includes('payment_failed'));
    const o2 = (await post(`/api/sessions/${sid}/checkout`, { token: me, body: { method: 'atm' }, expect: 201 })).data;
    assert.notEqual(o2.orderId, o1.orderId);
    momo.query[o2.orderId] = { resultCode: 0, amount: o2.amount, transId: 4300000001, payType: 'napas' }; // IPN mat, MoMo bao da tra
    const o = (await get(`/api/payments/orders/${o2.orderId}`, { token: me })).data;
    assert.equal(o.status, 'paid');
    assert.equal(o.payment.method, 'atm');
    const qr = (await get(`/api/reservations/${r.id}/pass`, { token: me })).data;
    await scan('exit', qr.token, 200);
  });

  test('Cong MoMo mat ket noi -> 502 ro rang, phien van cho thanh toan; MoMo hoat dong lai -> tra duoc', async () => {
    const me = await signup('e2e_hoa');
    const r = (await post(`/api/lots/${LOT}/reservations`, { token: me, body: { slotNumber: 2 }, expect: 201 })).data;
    const sid = (await scan('entry', (await get(`/api/reservations/${r.id}/pass`, { token: me })).data.token, 200)).data.sessionId;
    await sensor.park(2); await sensor.leave(2);
    momo.down = true;
    const fail = await post(`/api/sessions/${sid}/checkout`, { token: me, body: { method: 'momo' } });
    momo.down = false;
    assert.deepEqual([fail.status, fail.data.error], [502, 'gateway_unavailable']);
    assert.equal((await get(`/api/sessions/${sid}`, { token: me })).data.canPay, true);
    const o = (await post(`/api/sessions/${sid}/checkout`, { token: me, body: { method: 'momo' }, expect: 201 })).data;
    await post('/api/payments/momo/ipn', { body: ipnBody(o.orderId, o.amount, 0), expect: 204 });
    assert.equal((await get(`/api/sessions/${sid}`, { token: me })).data.paid, true);
  });

  test('Thiet bi khong phan hoi khi quet cong vao -> 504, dat cho van dung duoc; thu lai -> vao duoc', async () => {
    const me = await signup('e2e_tuan');
    const r = (await post(`/api/lots/${LOT}/reservations`, { token: me, body: { slotNumber: 4 }, expect: 201 })).data;
    device.state.mode = 'timeout';
    const qr = (await get(`/api/reservations/${r.id}/pass`, { token: me })).data;
    const t = await scan('entry', qr.token);
    device.state.mode = 'ok';
    assert.equal(t.status, 504);
    assert.equal((await get('/api/sessions/active', { token: me })).data.session, null, 'chua tinh la vao bai');
    const qr2 = (await get(`/api/reservations/${r.id}/pass`, { token: me })).data;
    const ok = (await scan('entry', qr2.token, 200)).data;
    assert.ok(ok.sessionId);
  });

  test('Bai mat ket noi (ESP32 offline) -> khong dat cho duoc (503), co thong bao ro rang', async () => {
    const me = await signup('e2e_offline');
    await db.query('UPDATE parking_lots SET online = false WHERE id = $1', [LOT]);
    const r = await post(`/api/lots/${LOT}/reservations`, { token: me, body: {} });
    await db.query('UPDATE parking_lots SET online = true WHERE id = $1', [LOT]);
    assert.deepEqual([r.status, r.data.error], [503, 'device_offline']);
  });

  test('Huy dat cho -> o tro ve trong; khong den -> het han, thong bao, lich su ghi "khong den"', async () => {
    const me = await signup('e2e_huy');
    const free = (await get(`/api/lots/${LOT}`)).data.slots.find((s) => s.state === 'free').slotNumber;
    const r1 = (await post(`/api/lots/${LOT}/reservations`, { token: me, body: { slotNumber: free }, expect: 201 })).data;
    await call('DELETE', `/api/reservations/${r1.id}`, { token: me, expect: 200 });
    assert.equal((await get(`/api/lots/${LOT}`)).data.slots.find((s) => s.slotNumber === free).state, 'free');
    const r2 = (await post(`/api/lots/${LOT}/reservations`, { token: me, body: { slotNumber: free, minutes: 5 }, expect: 201 })).data;
    await db.query(`UPDATE reservations SET expires_at = now() - interval '2 minutes' WHERE id = $1`, [r2.id]);
    assert.equal((await get(`/api/reservations/${r2.id}`, { token: me })).data.status, 'expired');
    assert.ok((await types(me)).includes('reservation_expired'));
    const h = (await get('/api/history', { token: me })).data;
    assert.deepEqual([h.summary.cancelled, h.summary.noShows], [1, 1]);
  });

  test('App mat mang giua chung: long-poll bi ngat roi goi lai voi phien ban cu -> nhan ngay thay doi da bo lo', async () => {
    const { version } = (await get('/api/live?wait=0')).data;
    const ctrl = new AbortController();
    const pending = fetch(`${base}/api/live?v=${version}&wait=10`, { signal: ctrl.signal }).catch((e) => e.name);
    ctrl.abort(); // mat mang
    assert.equal(await pending, 'AbortError');
    await sensor.park(1); // thay doi xay ra khi app dang mat mang
    const t0 = Date.now();
    const again = (await get(`/api/live?v=${version}&wait=10`)).data;
    assert.equal(again.changed, true);
    assert.ok(Date.now() - t0 < 3000, 'tra ngay, khong cho het 10s');
    await sensor.leave(1);
  });
});
