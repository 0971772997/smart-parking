// KIEM THU DON VI - HA TANG & GIAN DOAN: cau noi MQTT (ack, het thoi gian, mat ket noi broker), long-poll,
// thong bao day (loi mang / token het han), xu ly loi API khi CSDL mat ket noi (khong can DB that).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const request = require('supertest');
const { createMqttBridge } = require('../../src/mqttBridge');
const { createLiveHub } = require('../../src/live');
const { createPushService } = require('../../src/push');
const { createApp } = require('../../src/app');
const { createAuth } = require('../../src/auth');

// Client MQTT gia: ghi lai lenh publish, cho phep gia lap tin den / mat ket noi
function fakeMqtt() {
  const c = new EventEmitter();
  c.connected = true;
  c.published = [];
  c.subscribed = [];
  c.subscribe = (t) => c.subscribed.push(t);
  c.publish = (topic, payload) => c.published.push({ topic, payload: JSON.parse(payload) });
  c.end = (_f, _o, cb) => cb && cb();
  c.deliver = (topic, data) => c.emit('message', topic, Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
  return c;
}
const fakeSync = () => {
  const calls = [];
  return { calls, handleStatus: async (l, d) => calls.push(['status', l, d]), handleEvent: async (l, d) => calls.push(['event', l, d]),
    handleOnline: async (l, d) => calls.push(['online', l, d]) };
};
const tick = () => new Promise((r) => setImmediate(r));
const quietly = async (fn) => {
  const { log, error } = console;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = error; }
};

describe('Cau noi MQTT <-> ESP32', () => {
  test('Gui lenh -> ack dung requestId tra ve; ack la bi bo qua', async () => {
    const c = fakeMqtt();
    const sync = fakeSync();
    const bridge = await quietly(() => createMqttBridge({ url: 'x', topicPrefix: 'sp' }, sync, { timeoutMs: 500, connect: () => c }));
    c.emit('connect');
    assert.deepEqual(c.subscribed, ['sp/+/status', 'sp/+/event', 'sp/+/online']);
    const p = bridge.sendCommand('L1', { action: 'reserve', slot: 2 });
    const sent = c.published[0];
    assert.equal(sent.topic, 'sp/L1/cmd');
    assert.ok(sent.payload.requestId);
    c.deliver('sp/L1/event', { type: 'ack', requestId: 'khac', ok: true });
    c.deliver('sp/L1/event', { type: 'ack', requestId: sent.payload.requestId, ok: true });
    const ack = await p;
    assert.equal(ack.ok, true);
    assert.equal(ack.requestId, sent.payload.requestId);
  });

  test('Thiet bi khong tra loi -> null sau timeout (khong treo mai)', async () => {
    const c = fakeMqtt();
    const bridge = await quietly(() => createMqttBridge({ url: 'x', topicPrefix: 'sp' }, fakeSync(), { timeoutMs: 80, connect: () => c }));
    const t0 = Date.now();
    assert.equal(await bridge.sendCommand('L1', { action: 'open_gate', gate: 'entry' }), null);
    assert.ok(Date.now() - t0 < 1000);
  });

  test('May chu mat ket noi broker -> bao loi NGAY, khong publish, khong cho het timeout', async () => {
    const c = fakeMqtt();
    c.connected = false;
    const bridge = await quietly(() => createMqttBridge({ url: 'x', topicPrefix: 'sp' }, fakeSync(), { timeoutMs: 5000, connect: () => c }));
    const t0 = Date.now();
    assert.equal(await bridge.sendCommand('L1', { action: 'reserve', slot: 1 }), null);
    assert.ok(Date.now() - t0 < 100);
    assert.equal(c.published.length, 0);
    assert.equal(bridge.connected(), false);
  });

  test('Dinh tuyen tin den; tin rac (khong phai JSON) va loi xu ly khong lam sap cau noi', async () => {
    const c = fakeMqtt();
    const sync = fakeSync();
    await quietly(async () => {
      createMqttBridge({ url: 'x', topicPrefix: 'sp' }, sync, { connect: () => c });
      c.deliver('sp/L1/status', { slots: [] });
      c.deliver('sp/L1/online', '1');
      c.deliver('sp/L1/event', 'khong phai json {');
      sync.handleEvent = async () => { throw new Error('DB loi'); };
      c.deliver('sp/L1/event', { type: 'slot_changed' });
      await tick();
    });
    assert.deepEqual(sync.calls.map((x) => x[0]), ['status', 'online']);
  });
});

describe('Long-poll (cap nhat thoi gian thuc)', () => {
  test('Da khac phien ban -> tra ngay; dang cho -> danh thuc khi bump; het gio -> false', async () => {
    const hub = createLiveHub();
    assert.equal(await hub.wait('cu', 1000), true);
    const v = hub.version();
    const waiting = hub.wait(v, 2000);
    assert.equal(hub.waiting(), 1);
    hub.bump();
    assert.equal(await waiting, true);
    assert.equal(hub.waiting(), 0, 'khong ro ri bo nho');
    assert.equal(await hub.wait(hub.version(), 30), false);
    assert.equal(hub.waiting(), 0);
  });
  test('Phien ban gom ma khoi dong: may chu khoi dong lai -> app biet de tai lai', () => {
    assert.notEqual(createLiveHub().version(), createLiveHub().version());
  });
});

describe('Thong bao day khi mang loi', () => {
  const dbFor = (tokens) => {
    const log = [];
    return {
      log,
      one: async (sql) => (/notification_prefs/.test(sql) ? { notification_prefs: {} } : { c: 2 }),
      query: async (sql, params) => { log.push([sql.split(' ')[0], params]); return { rows: /FROM push_tokens/.test(sql) ? tokens : [] }; },
    };
  };
  const n = { id: 5, user_id: 1, type: 'paid', title: 'Thanh toan', body: 'ok', data: {} };

  test('Expo khong ket noi duoc -> dem that bai, khong nem loi ra ngoai', async () => {
    const db = dbFor([{ id: 1, token: 'ExponentPushToken[a]' }]);
    const push = createPushService({ db, fetchFn: async () => { throw new Error('ECONNRESET'); }, log: { error: () => {} } });
    assert.deepEqual(await push.sendNotification(n), { sent: 0, failed: 1 });
  });
  test('Token go app (DeviceNotRegistered) -> xoa; loi khac -> ghi last_error', async () => {
    const db = dbFor([{ id: 1, token: 'ExponentPushToken[a]' }, { id: 2, token: 'ExponentPushToken[b]' }]);
    const fetchFn = async () => ({ json: async () => ({ data: [
      { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageRateExceeded' } }] }) });
    const r = await createPushService({ db, fetchFn }).sendNotification(n);
    assert.deepEqual(r, { sent: 0, failed: 2 });
    assert.deepEqual(db.log.filter((x) => x[0] !== 'SELECT').map((x) => x[0]), ['DELETE', 'UPDATE']);
  });
  test('Khong co thiet bi / loai khong day -> bo qua', async () => {
    const push = createPushService({ db: dbFor([]), fetchFn: async () => assert.fail('khong duoc goi') });
    assert.equal((await push.sendNotification(n)).skipped, 'no_device');
    assert.equal((await push.sendNotification({ ...n, type: 'near_end' })).skipped, 'not_push_type');
  });
});

describe('API khi CSDL mat ket noi / du lieu bat thuong (db gia lap)', () => {
  const down = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432'), { code: 'ECONNREFUSED' });
  const db = { query: async () => { throw down; }, one: async () => { throw down; } };
  const device = { connected: () => false, sendCommand: async () => null };
  const app = createApp({ db, auth: createAuth({ jwtSecret: 's', jwtExpiresIn: '1h' }), device });

  test('CSDL mat ket noi -> 503 service_unavailable, khong lo chi tiet noi bo', async () => {
    const r = await quietly(() => request(app).get('/api/lots'));
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'service_unavailable');
    assert.ok(!/ECONNREFUSED|5432|1\.2\.3\.4|stack/i.test(JSON.stringify(r.body)));
  });
  test('Loi bat ngo -> 500 "Loi may chu" (khong lo thong diep / stack)', async () => {
    const app2 = createApp({ db: { query: async () => { throw new Error('column "secret_x" does not exist'); },
      one: async () => { throw new Error('column "secret_x" does not exist'); } }, auth: createAuth({ jwtSecret: 's' }), device });
    const r = await quietly(() => request(app2).get('/api/lots'));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'internal_error', message: 'Loi may chu' });
  });
  test('Body qua lon -> 413; JSON hong -> 400; header bao mat co mat', async () => {
    let r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(`{"email":"${'a'.repeat(200 * 1024)}"}`);
    assert.equal(r.status, 413);
    assert.equal(r.body.error, 'payload_too_large');
    r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(r.body.error, 'invalid_json');
    r = await request(app).get('/');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-powered-by'], undefined);
  });
});
