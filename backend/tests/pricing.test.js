// Dieu chinh gia (admin tang / giam gia gui xe): xem truoc, ap dung, lich su, gia da chot cho xe dang gui,
// thong bao tai xe, phan quyen, kiem tra du lieu, 2 admin bam cung luc. Chay: npm test (nhanh DB "test")
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
const LOT2 = 'pr-lot-02';
const HOUR = 3600 * 1000;
let db, app, device, sync, admin;
const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456', fullName: `Le ${username}` }).expect(201)).body.token;
const price = async (id = LOT) => (await db.one('SELECT price_per_hour FROM parking_lots WHERE id = $1', [id])).price_per_hour;
const adjust = (body, expect = 200) => api().post('/api/admin/pricing').set(auth(admin)).send(body).expect(expect);
const setPrice = (value, lotIds = [LOT]) => adjust({ lotIds, mode: 'set', value });
const park = (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); };
const leave = (n) => { device.state.slots[n - 1].occupied = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); };
const reserve = async (token, slot) => (await api().post(`/api/lots/${LOT}/reservations`).set(auth(token))
  .send({ slotNumber: slot, durationMinutes: 60 }).expect(201)).body;
async function enter(token, resv) {
  const pass = (await api().get(`/api/reservations/${resv.id}/pass`).set(auth(token)).expect(200)).body;
  return (await api().post('/api/gates/scan').set(auth(admin)).send({ lotId: LOT, gate: 'entry', token: pass.token }).expect(200)).body.sessionId;
}
const session = async (token, id) => (await api().get(`/api/sessions/${id}`).set(auth(token)).expect(200)).body;
// Dua gio bat dau phien ve qua khu (gia lap da gui lau)
const ago = (id, ms) => db.query(
  `UPDATE parking_sessions SET started_at = started_at - make_interval(secs => $2), parked_at = parked_at - make_interval(secs => $2),
     planned_end_at = planned_end_at - make_interval(secs => $2) WHERE id = $1`, [id, ms / 1000]);

before(async () => {
  db = createDb(config.databaseUrl);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await db.query(`UPDATE parking_lots SET online = true WHERE id = $1`, [LOT]);
  await db.query(`INSERT INTO parking_lots (id, name, total_slots, price_per_hour) VALUES ($1, 'Bãi phụ', 2, 5000)`, [LOT2]);
  await db.query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@test.vn', $1, 'Admin', 'admin')`,
    [await bcrypt.hash('admin123', 4)]);
  device = createFakeDevice(4);
  sync = createSync(db, { live: createLiveHub() });
  sync.attachDevice(device);
  app = createApp({ db, auth: createAuth(config, { db }), device, gatePass: createGatePass('pricing-test'), live: createLiveHub() });
  admin = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
});
after(async () => db && db.end());

describe('Phan quyen + kiem tra du lieu', () => {
  test('Tai xe / khach khong xem / doi gia duoc', async () => {
    const t = await register('pr_guest');
    await api().get('/api/admin/pricing').set(auth(t)).expect(403);
    await api().post('/api/admin/pricing').set(auth(t)).send({ mode: 'set', value: 0 }).expect(403);
    await api().post('/api/admin/pricing').send({ mode: 'set', value: 0 }).expect(401);
    assert.equal(await price(), 10000);
  });

  test('Du lieu sai -> 400 / 404, gia khong doi', async () => {
    const bad = [
      { mode: 'double', value: 10 }, { mode: 'percent' }, { mode: 'percent', value: 0 }, { mode: 'percent', value: -95 },
      { mode: 'percent', value: 501 }, { mode: 'amount', value: 1.5 }, { mode: 'amount', value: '2000' },
      { mode: 'set', value: -1 }, { mode: 'set', value: 10000001 }, { mode: 'set', value: 1000, lotIds: [] },
      { mode: 'set', value: 1000, lotIds: LOT }, { mode: 'set', value: 1000, lotIds: [1] },
      { mode: 'set', value: 1000, reason: 'x'.repeat(201) },
    ];
    for (const b of bad) {
      const r = await adjust(b, 400);
      assert.equal(r.body.error, 'validation_error', JSON.stringify(b));
    }
    const nf = await adjust({ mode: 'set', value: 1000, lotIds: [LOT, 'khong-co'] }, 404);
    assert.deepEqual(nf.body.details.lotIds, ['khong-co']);
    assert.deepEqual([await price(), await price(LOT2)], [10000, 5000]);
  });
});

describe('Xem truoc + ap dung', () => {
  test('GET /pricing: gia tung bai + quy tac', async () => {
    const b = (await api().get('/api/admin/pricing').set(auth(admin)).expect(200)).body;
    assert.deepEqual(b.lots.map((l) => [l.id, l.pricePerHour]).sort(), [[LOT2, 5000], [LOT, 10000]].sort());
    assert.equal(b.rules.roundTo, 1000);
    assert.deepEqual(b.rules.limits.percent, [-90, 500]);
    assert.deepEqual(b.history, []);
  });

  test('Xem truoc (dryRun) tang 15% tat ca bai: lam tron 1.000d, KHONG ghi DB', async () => {
    const r = (await adjust({ mode: 'percent', value: 15, dryRun: true })).body;
    assert.equal(r.applied, false);
    const byId = Object.fromEntries(r.changes.map((c) => [c.lotId, c]));
    assert.deepEqual([byId[LOT].oldPrice, byId[LOT].newPrice, byId[LOT].diff, byId[LOT].percent], [10000, 12000, 2000, 20]); // 11.500 -> 12.000
    assert.deepEqual([byId[LOT2].oldPrice, byId[LOT2].newPrice], [5000, 6000]); // 5.750 -> 6.000
    assert.deepEqual([await price(), await price(LOT2)], [10000, 5000]);
    assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM price_changes')).n), 0);
  });

  test('Tang 2.000d cho 1 bai -> doi gia, ghi lich su + nhat ky; bai khac giu nguyen', async () => {
    const r = (await adjust({ lotIds: [LOT], mode: 'amount', value: 2000, reason: 'Giờ cao điểm' })).body;
    assert.equal(r.applied, true);
    assert.deepEqual(r.changes.map((c) => [c.lotId, c.oldPrice, c.newPrice]), [[LOT, 10000, 12000]]);
    assert.deepEqual([await price(), await price(LOT2)], [12000, 5000]);
    // Tai xe thay gia moi
    const lots = (await api().get('/api/lots').expect(200)).body;
    assert.equal(lots.find((l) => l.id === LOT).pricePerHour, 12000);
    const h = (await api().get('/api/admin/pricing').set(auth(admin)).expect(200)).body.history;
    assert.equal(h.length, 1);
    assert.deepEqual([h[0].lotId, h[0].oldPrice, h[0].newPrice, h[0].diff, h[0].reason, h[0].changedBy], [LOT, 10000, 12000, 2000, 'Giờ cao điểm', 'Admin']);
    const a = (await api().get('/api/admin/audit').set(auth(admin)).expect(200)).body[0];
    assert.deepEqual([a.action, a.label, a.targetId], ['lot.price', 'Điều chỉnh giá', LOT]);
  });

  test('Giam 50% tat ca bai; gia tri trung gia cu -> khong ghi lich su thua', async () => {
    const r = (await adjust({ mode: 'percent', value: -50 })).body;
    assert.deepEqual(r.changes.map((c) => [c.lotId, c.newPrice]).sort(), [[LOT, 6000], [LOT2, 3000]].sort()); // 2.500 -> 3.000
    const before = Number((await db.one('SELECT COUNT(*) AS n FROM price_changes')).n);
    const same = (await setPrice(6000)).body;
    assert.deepEqual([same.changes.length, same.unchanged], [0, 1]);
    assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM price_changes')).n), before);
  });

  test('Gioi han: khong am, khong vuot 10.000.000d; dat 0d = mien phi', async () => {
    assert.equal((await adjust({ lotIds: [LOT2], mode: 'amount', value: -9000000 })).body.changes[0].newPrice, 0);
    assert.equal((await adjust({ lotIds: [LOT2], mode: 'percent', value: 500 })).body.changes.length, 0); // 0 x 6 = 0
    assert.equal((await adjust({ lotIds: [LOT2], mode: 'amount', value: 10000000 })).body.changes[0].newPrice, 10000000);
    assert.equal((await adjust({ lotIds: [LOT2], mode: 'amount', value: 5000 })).body.changes.length, 0);
    assert.equal((await adjust({ lotIds: [LOT2], mode: 'percent', value: -90 })).body.changes[0].newPrice, 1000000);
  });

  test('Sua gia qua PUT /lots/:id cung ghi lich su gia', async () => {
    await api().put(`/api/lots/${LOT2}`).set(auth(admin)).send({ pricePerHour: 7000 }).expect(200);
    const h = (await api().get(`/api/admin/pricing?lotId=${LOT2}`).set(auth(admin)).expect(200)).body.history;
    assert.deepEqual([h[0].oldPrice, h[0].newPrice, h[0].reason], [1000000, 7000, 'Sửa thông tin bãi']);
    assert.ok(h.every((x) => x.lotId === LOT2));
  });

  test('2 admin cung bam "+10%" mot luc -> ca 2 lan deu tinh tren gia moi nhat (khong mat lan nao)', async () => {
    await setPrice(10000);
    await Promise.all([adjust({ lotIds: [LOT], mode: 'percent', value: 10 }), adjust({ lotIds: [LOT], mode: 'percent', value: 10 })]);
    assert.equal(await price(), 12000); // 10.000 -> 11.000 -> 12.100 -> 12.000
    const h = (await db.query('SELECT old_price, new_price FROM price_changes WHERE lot_id = $1 ORDER BY id DESC LIMIT 2', [LOT])).rows;
    assert.deepEqual(h.map((x) => [x.old_price, x.new_price]).reverse(), [[10000, 11000], [11000, 12000]]);
  });
});

describe('Gia da chot: doi gia khong anh huong xe dang gui', () => {
  test('Dat cho luc 10.000d, admin tang len 20.000d -> vao bai van tinh 10.000d; dat cho moi tinh 20.000d', async () => {
    await setPrice(10000);
    const an = await register('pr_an');
    const resv = await reserve(an, 1);
    assert.deepEqual([resv.hourlyRate, resv.estimatedFee], [10000, 10000]);
    await setPrice(20000);
    const sid = await enter(an, resv);
    await park(1);
    await ago(sid, 2.5 * HOUR); // da gui 2.5 gio (du kien 1 gio): 3 gio x 10.000 + phu phi qua gio 2 x 5.000
    let s = await session(an, sid);
    assert.deepEqual([s.pricePerHour, s.estimatedFee], [10000, 40000]);
    await leave(1);
    s = await session(an, sid);
    assert.deepEqual([s.phase, s.fee], ['left', 40000]);

    const binh = await register('pr_binh');
    const r2 = await reserve(binh, 2);
    assert.deepEqual([r2.hourlyRate, r2.estimatedFee], [20000, 20000]);
  });

  test('Dat cho luc gia cao, admin giam gia truoc khi xe vao -> tinh theo gia thap hon', async () => {
    await setPrice(15000);
    const cuong = await register('pr_cuong');
    const resv = await reserve(cuong, 3);
    await setPrice(8000);
    const sid = await enter(cuong, resv);
    await park(3);
    const s = await session(cuong, sid);
    assert.equal(s.pricePerHour, 8000);
    await leave(3);
  });

  test('Khach vang lai: gia chot luc xe vao o', async () => {
    await setPrice(10000);
    await park(4);
    const s = (await db.one(`SELECT id FROM parking_sessions WHERE slot_id = (SELECT id FROM slots WHERE lot_id = $1 AND slot_number = 4)
      AND ended_at IS NULL`, [LOT]));
    await setPrice(50000);
    await db.query(`UPDATE parking_sessions SET started_at = started_at - interval '90 minutes' WHERE id = $1`, [s.id]);
    await leave(4);
    const done = await db.one('SELECT fee, hourly_rate FROM parking_sessions WHERE id = $1', [s.id]);
    assert.deepEqual([done.hourly_rate, done.fee], [10000, 20000]);
  });

  test('Phien cu (truoc khi co cot hourly_rate) -> dung gia hien tai cua bai nhu truoc', async () => {
    await setPrice(10000);
    await park(4);
    await db.query('UPDATE parking_sessions SET hourly_rate = NULL WHERE ended_at IS NULL');
    await setPrice(13000);
    const id = (await db.one('SELECT id FROM parking_sessions WHERE ended_at IS NULL AND source = $1', ['sensor'])).id;
    await leave(4);
    assert.equal((await db.one('SELECT fee FROM parking_sessions WHERE id = $1', [id])).fee, 13000);
  });
});

describe('Thong bao tai xe', () => {
  test('notify=true -> tai xe yeu thich / tung gui o bai do nhan thong bao; bai khac khong', async () => {
    await setPrice(10000);
    const dung = await register('pr_dung');
    await api().put(`/api/favorites/${LOT2}`).set(auth(dung)).expect((r) => assert.ok([200, 201, 204].includes(r.status)));
    const an = (await api().post('/api/auth/login').send({ email: 'pr_an@test.vn', password: '123456' }).expect(200)).body.token;

    const r = (await adjust({ lotIds: [LOT2], mode: 'amount', value: -2000, reason: 'Khuyến mãi', notify: true })).body;
    assert.equal(r.notified, 1);
    const n = (await api().get('/api/notifications').set(auth(dung)).expect(200)).body.items[0];
    assert.equal(n.type, 'announcement');
    assert.match(n.title, /Bãi phụ giảm giá/);
    assert.match(n.body, /5\.000đ\/giờ[\s\S]*7\.000đ\/giờ[\s\S]*Khuyến mãi/);
    const anItems = (await api().get('/api/notifications').set(auth(an)).expect(200)).body.items;
    assert.ok(!anItems.some((x) => /Bãi phụ/.test(x.title)));

    // Khong notify -> khong ai nhan
    const q = (await adjust({ lotIds: [LOT2], mode: 'amount', value: 1000 })).body;
    assert.equal(q.notified, 0);
    const after = (await api().get('/api/notifications').set(auth(dung)).expect(200)).body.items;
    assert.equal(after.filter((x) => /Bãi phụ/.test(x.title)).length, 1);
  });
});
