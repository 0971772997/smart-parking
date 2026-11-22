// KIEM THU PHAN QUYEN, TOKEN VA BAO MAT DU LIEU (tich hop, DB "test")
//  - Ma tran truy cap cheo: tai xe B thu doc / sua / xoa moi tai nguyen cua tai xe A (IDOR)
//  - Ma tran API quan tri: khach -> 401, tai xe -> 403
//  - Token: het han, sai khoa, bi sua, tai khoan da xoa / bi khoa / bi ha quyen
//  - Do mat khau: gioi han lan sai; mat khau luu bcrypt
//  - Ro ri du lieu: khong tra hash mat khau / email nguoi khac; injection, mass assignment, nham kieu
process.env.NODE_ENV = 'test';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
// Cong thanh toan gia (khong goi mang) - chi can tao duoc don
const gateway = {
  name: 'momo', sandbox: true, create: async () => ({ ok: true, payUrl: 'https://pay.test/x' }),
  query: async () => ({ resultCode: 1000 }), verifyResult: () => false,
};
let db, app, device, sync, admin, A, B, a; // a = id tai nguyen cua A
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: 'matkhau123', fullName: `Nguoi ${username}` }).expect(201)).body.token;
const park = (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); };
const leave = (n) => { device.state.slots[n - 1].occupied = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); };

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
  app = createApp({ db, auth: createAuth(config, { db }), device, gatePass: createGatePass('sec-test'), live: createLiveHub(),
    gateway, loginLimits: { account: { max: 5 }, ip: { max: 1000 } } });
  admin = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
  A = await register('sec_a');
  B = await register('sec_b');

  // Tai nguyen cua A: xe, lich, dat cho -> qua cong -> do -> roi o -> thanh toan, phien chua tra, don MoMo, yeu cau ho tro, danh gia
  const veh = (await api().post('/api/vehicles').set(auth(A)).send({ plateNumber: '43A-111.11' }).expect(201)).body;
  const sch = (await api().post('/api/schedules').set(auth(A)).send({ name: 'Di lam', lotId: LOT, arriveTime: '07:30' }).expect(201)).body;
  const r1 = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(A)).send({ slotNumber: 1, vehicleId: veh.id }).expect(201)).body;
  const p1 = (await api().get(`/api/reservations/${r1.id}/pass`).set(auth(A)).expect(200)).body;
  const s1 = (await api().post('/api/gates/scan').set(auth(admin)).send({ lotId: LOT, gate: 'entry', token: p1.token }).expect(200)).body.sessionId;
  await park(1); await leave(1);
  const pay = (await api().post(`/api/sessions/${s1}/pay`).set(auth(A)).send({ method: 'card' }).expect(201)).body;
  const r2 = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(A)).send({ slotNumber: 2 }).expect(201)).body;
  const p2 = (await api().get(`/api/reservations/${r2.id}/pass`).set(auth(A)).expect(200)).body;
  const s2 = (await api().post('/api/gates/scan').set(auth(admin)).send({ lotId: LOT, gate: 'entry', token: p2.token }).expect(200)).body.sessionId;
  await park(2); await leave(2);
  const ord = (await api().post(`/api/sessions/${s2}/checkout`).set(auth(A)).send({ method: 'momo' }).expect(201)).body;
  const r3 = (await api().post(`/api/lots/${LOT}/reservations`).set(auth(A)).send({ slotNumber: 3 }).expect(201)).body; // dang giu cho
  const tk = (await api().post('/api/support/tickets').set(auth(A)).send({
    kind: 'incident', category: 'gate', subject: 'Barie loi', description: 'Mo ta su co barie loi', sessionId: s1 }).expect(201)).body;
  await api().put(`/api/lots/${LOT}/reviews/mine`).set(auth(A)).send({ rating: 4, comment: 'Tot' }).expect(201);
  const notes = (await api().get('/api/notifications?unread=1').set(auth(A)).expect(200)).body.items;
  a = { veh: veh.id, sch: sch.id, r1: r1.id, r3: r3.id, s1, s2, pay: pay.id, receiptNo: pay.receiptNo, order: ord.orderId, ticket: tk.id,
    note: notes[0].id };
});
after(async () => db && db.end());

describe('Truy cap cheo (IDOR): tai xe B khong dung duoc tai nguyen cua A', () => {
  const cases = [
    ['GET', () => `/api/reservations/${a.r1}`], ['GET', () => `/api/reservations/${a.r3}/pass`],
    ['DELETE', () => `/api/reservations/${a.r3}`], ['POST', () => `/api/reservations/${a.r3}/extend`, { minutes: 10 }],
    ['GET', () => `/api/sessions/${a.s1}`], ['POST', () => `/api/sessions/${a.s2}/extend`, { minutes: 30 }],
    ['PATCH', () => `/api/sessions/${a.s2}`, { vehicleId: 1 }], ['POST', () => `/api/sessions/${a.s2}/checkout`, { method: 'momo' }],
    ['POST', () => `/api/sessions/${a.s2}/pay`, { method: 'card' }], ['GET', () => `/api/payments/${a.pay}`],
    ['GET', () => `/api/payments/orders/${a.order}`], ['GET', () => `/api/support/tickets/${a.ticket}`],
    ['POST', () => `/api/support/tickets/${a.ticket}/messages`, { body: 'xen vao' }],
    ['PATCH', () => `/api/support/tickets/${a.ticket}`, { status: 'closed' }],
    ['GET', () => `/api/schedules/${a.sch}`], ['PATCH', () => `/api/schedules/${a.sch}`, { active: false }],
    ['DELETE', () => `/api/schedules/${a.sch}`], ['DELETE', () => `/api/vehicles/${a.veh}`],
  ];
  for (const [method, path, body] of cases) {
    test(`${method} ${path.toString().match(/`(.*)`/)[1]} -> 404 (khong tiet lo ton tai)`, async () => {
      const r = await api()[method.toLowerCase()](path()).set(auth(B)).send(body || {});
      assert.equal(r.status, 404, JSON.stringify(r.body));
    });
  }

  test('Tai nguyen cua A khong bi thay doi sau cac lan thu', async () => {
    assert.equal((await api().get(`/api/reservations/${a.r3}`).set(auth(A)).expect(200)).body.status, 'active');
    assert.equal((await api().get(`/api/schedules/${a.sch}`).set(auth(A)).expect(200)).body.active, true);
    assert.equal((await api().get(`/api/support/tickets/${a.ticket}`).set(auth(A)).expect(200)).body.messages.length, 0);
    assert.equal((await api().get('/api/vehicles').set(auth(A)).expect(200)).body.length, 1);
  });

  test('Danh sach cua B khong chua du lieu cua A', async () => {
    for (const path of ['/api/reservations', '/api/sessions/mine', '/api/payments', '/api/support/tickets', '/api/schedules',
      '/api/vehicles', '/api/favorites']) {
      const r = await api().get(path).set(auth(B)).expect(200);
      assert.equal(r.body.length, 0, path);
    }
    const h = (await api().get('/api/history').set(auth(B)).expect(200)).body;
    assert.equal(h.items.length, 0);
    assert.equal((await api().get('/api/sessions/active').set(auth(B)).expect(200)).body.session, null);
  });

  test('B danh dau "da doc" thong bao cua A -> khong co tac dung', async () => {
    await api().post('/api/notifications/read').set(auth(B)).send({ ids: [a.note] }).expect(200);
    const n = (await api().get('/api/notifications?unread=1').set(auth(A)).expect(200)).body.items;
    assert.ok(n.some((x) => x.id === a.note));
  });

  test('B dung xe / phien cua A khi tao du lieu cua minh -> bi chan', async () => {
    let r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(B)).send({ slotNumber: 4, vehicleId: a.veh });
    assert.equal(r.status, 400);
    r = await api().post('/api/support/tickets').set(auth(B))
      .send({ kind: 'support', category: 'other', subject: 'Hoi', description: 'Noi dung cau hoi', sessionId: a.s1 });
    assert.equal(r.status, 404);
  });

  test('Bien nhan HTML: khong co / sai chu ky -> 404; chu ky dung -> 200', async () => {
    await api().get(`/api/receipts/${a.receiptNo}`).expect(404);
    await api().get(`/api/receipts/${a.receiptNo}?t=gia-mao`).expect(404);
    const p = (await api().get(`/api/payments/${a.pay}`).set(auth(A)).expect(200)).body;
    const url = new URL(p.receiptUrl);
    await api().get(url.pathname + url.search).expect(200);
  });
});

describe('API quan tri: khach -> 401, tai xe -> 403', () => {
  const ADMIN_ONLY = [
    ['GET', '/api/admin/overview'], ['GET', '/api/admin/users'], ['GET', '/api/admin/users/1'], ['PATCH', '/api/admin/users/1'],
    ['GET', '/api/admin/lots'], ['GET', '/api/admin/reservations'], ['POST', '/api/admin/reservations/1/cancel'],
    ['GET', '/api/admin/sessions'], ['POST', '/api/admin/sessions/1/close'], ['GET', '/api/admin/payments'],
    ['GET', '/api/admin/reviews'], ['DELETE', '/api/admin/reviews/1'], ['POST', '/api/admin/broadcast'], ['GET', '/api/admin/broadcasts'],
    ['GET', '/api/admin/audit'], ['POST', '/api/lots'], ['PUT', `/api/lots/${LOT}`], ['DELETE', `/api/lots/${LOT}`],
    ['POST', `/api/lots/${LOT}/gates/entry/open`], ['GET', `/api/lots/${LOT}/sessions`], ['GET', `/api/lots/${LOT}/events`],
    ['GET', `/api/lots/${LOT}/stats`], ['POST', '/api/gates/scan'], ['GET', '/api/gates/scans'],
    ['POST', `/api/lots/${LOT}/sessions/1/pay`], ['POST', '/api/reviews/1/reply'],
  ];
  test(`${ADMIN_ONLY.length} API quan tri deu bi chan`, async () => {
    for (const [m, p] of ADMIN_ONLY) {
      const anon = await api()[m.toLowerCase()](p).send({});
      assert.equal(anon.status, 401, `khach ${m} ${p}`);
      const user = await api()[m.toLowerCase()](p).set(auth(B)).send({});
      assert.equal(user.status, 403, `tai xe ${m} ${p}`);
    }
    // Bai do van con nguyen
    assert.equal((await api().get(`/api/lots/${LOT}`).expect(200)).body.id, LOT);
  });
  test('Tai xe xin danh sach "tat ca" yeu cau ho tro -> chi nhan cua minh', async () => {
    const r = (await api().get('/api/support/tickets?scope=all').set(auth(B)).expect(200)).body;
    assert.equal(r.length, 0);
  });
});

describe('Xu ly token tren API that', () => {
  const sign = (payload, secret = config.jwtSecret, opts = {}) => jwt.sign(payload, secret, { expiresIn: '1h', ...opts });

  test('Het han / sai khoa / tu cap quyen admin bang khoa gia -> 401', async () => {
    const id = (await db.one(`SELECT id FROM users WHERE email = 'sec_b@test.vn'`)).id;
    for (const t of [sign({ sub: id, role: 'user' }, config.jwtSecret, { expiresIn: -10 }), sign({ sub: id, role: 'admin' }, 'khoa-gia')]) {
      const r = await api().get('/api/admin/overview').set(auth(t));
      assert.equal(r.status, 401);
      assert.equal(r.body.error, 'invalid_token');
    }
  });

  test('Token hop le nhung ghi role admin cho tai khoan thuong -> quyen lay tu DB -> 403', async () => {
    const id = (await db.one(`SELECT id FROM users WHERE email = 'sec_b@test.vn'`)).id;
    await api().get('/api/admin/overview').set(auth(sign({ sub: id, role: 'admin' }))).expect(403);
  });

  test('Tai khoan da xoa -> token cu 401; bi khoa -> 403', async () => {
    const t = await register('sec_tmp');
    await db.query(`DELETE FROM users WHERE email = 'sec_tmp@test.vn'`);
    assert.equal((await api().get('/api/vehicles').set(auth(t))).status, 401);
    const t2 = await register('sec_lock');
    await db.query(`UPDATE users SET locked_at = now() WHERE email = 'sec_lock@test.vn'`);
    // cache 30s: tai khoan moi chua tung goi API -> kiem tra DB ngay
    assert.equal((await api().get('/api/vehicles').set(auth(t2))).status, 403);
  });
});

describe('Dang nhap & mat khau', () => {
  test('Mat khau luu bcrypt, khong bao gio tra ve', async () => {
    const u = await db.one(`SELECT password_hash FROM users WHERE email = 'sec_a@test.vn'`);
    assert.match(u.password_hash, /^\$2[aby]\$10\$/);
    const r = await api().post('/api/auth/login').send({ email: 'sec_a@test.vn', password: 'matkhau123' }).expect(200);
    assert.ok(!JSON.stringify(r.body).includes('$2'));
  });

  test('Sai mat khau nhieu lan -> 429 (ke ca mat khau dung sau do); tai khoan khac khong bi anh huong', async () => {
    await register('sec_brute');
    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/auth/login').send({ email: 'sec_brute@test.vn', password: `sai${i}` }).expect(401);
    }
    const r = await api().post('/api/auth/login').send({ email: 'sec_brute@test.vn', password: 'matkhau123' });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'too_many_attempts');
    assert.ok(r.body.details.retryAfter > 0);
    await api().post('/api/auth/login').send({ email: 'sec_a@test.vn', password: 'matkhau123' }).expect(200);
  });

  test('Thong bao loi giong nhau cho email khong ton tai va sai mat khau (khong do duoc email)', async () => {
    const x = await api().post('/api/auth/login').send({ email: 'khongco@test.vn', password: 'x12345' });
    const y = await api().post('/api/auth/login').send({ email: 'sec_b@test.vn', password: 'x12345' });
    assert.deepEqual([x.status, x.body], [y.status, y.body]);
  });
});

describe('Ro ri du lieu, injection, mass assignment', () => {
  const SECRET_RE = /password|\$2[aby]\$|code_hash|google_id|facebook_id|locked_reason/i;

  test('Khong API nao cua tai xe tra hash mat khau / ma bi mat', async () => {
    const paths = ['/api/auth/me', '/api/vehicles', '/api/reservations', `/api/reservations/${a.r1}`, '/api/sessions/mine',
      `/api/sessions/${a.s1}`, '/api/payments', `/api/payments/${a.pay}`, '/api/notifications', '/api/history',
      '/api/support/tickets', `/api/support/tickets/${a.ticket}`, '/api/favorites', '/api/schedules'];
    for (const p of paths) {
      const r = await api().get(p).set(auth(A)).expect(200);
      assert.ok(!SECRET_RE.test(JSON.stringify(r.body)), p);
    }
  });

  test('API cong khai khong lo email / SDT nguoi dung', async () => {
    for (const p of ['/api/lots', `/api/lots/${LOT}`, `/api/lots/${LOT}/reviews`, '/api/support/info', '/api/live?wait=0']) {
      const s = JSON.stringify((await api().get(p).expect(200)).body);
      assert.ok(!/sec_a@|@test\.vn|password/.test(s), p);
    }
    const rv = (await api().get(`/api/lots/${LOT}/reviews`).set(auth(B)).expect(200)).body.items[0];
    assert.equal(rv.author, 'Nguoi s.');
    assert.equal(rv.mine, false);
  });

  test('Chen SQL vao o tim kiem / tham so duong dan -> khong loi, khong lo them du lieu', async () => {
    for (const q of ["' OR 1=1 --", "%' OR '1'='1", '"; DROP TABLE users; --', '\\', '%_%']) {
      const r = await api().get(`/api/admin/users?q=${encodeURIComponent(q)}`).set(auth(admin)).expect(200);
      assert.equal(r.body.total, 0, q);
    }
    await api().get(`/api/lots/${encodeURIComponent("x' OR '1'='1")}`).expect(404);
    await api().get(`/api/history?lotId=${encodeURIComponent("' OR 1=1 --")}`).set(auth(A)).expect(200);
    assert.ok((await db.one('SELECT COUNT(*)::int AS n FROM users')).n >= 3, 'bang users con nguyen');
  });

  test('Mass assignment: dang ky / sua ho so kem role, locked... -> bi bo qua', async () => {
    const r = await api().post('/api/auth/register').send({ username: 'sec_mass', email: 'sec_mass@test.vn', password: 'matkhau123',
      role: 'admin', locked_at: null, id: 1, __proto__: { role: 'admin' } }).expect(201);
    assert.equal(r.body.user.role, 'user');
    const me = await api().patch('/api/auth/me').set(auth(r.body.token)).send({ role: 'admin', email: 'doi@x.vn' }).expect(200);
    assert.equal(me.body.role, 'user');
    assert.equal(me.body.email, 'sec_mass@test.vn');
    await api().get('/api/admin/overview').set(auth(r.body.token)).expect(403);
  });

  test('Nham kieu du lieu (mang / doi tuong thay cho so, chuoi) -> 400, khong 500', async () => {
    const bad = [
      ['post', `/api/lots/${LOT}/reservations`, { slotNumber: [1] }],
      ['post', `/api/lots/${LOT}/reservations`, { slotNumber: { $gt: 0 } }],
      ['post', '/api/auth/login', { email: { $ne: '' }, password: 'x' }],
      ['post', '/api/support/tickets', { kind: ['incident'], category: 'gate', subject: 'abc', description: 'mo ta dai hon 10' }],
      ['put', `/api/lots/${LOT}/reviews/mine`, { rating: '5 OR 1=1' }],
      ['post', '/api/vehicles', { plateNumber: { a: 1 } }],
    ];
    for (const [m, p, body] of bad) {
      const r = await api()[m](p).set(auth(B)).send(body);
      assert.ok(r.status === 400, `${m} ${p} ${JSON.stringify(body)} -> ${r.status}`);
    }
  });
});
