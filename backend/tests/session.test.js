// Phien gui xe + toan bo quy trinh xe VAO -> do -> gia han / qua gio -> roi o -> thanh toan -> RA,
// thoi gian thuc (long-poll), thong bao, mat ket noi / dong bo lai, cac tinh huong ngoai le.
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
const { sessionFee } = require('../src/sessions');
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const PRICE = 10000;
const gp = createGatePass('session-test-secret');
const live = createLiveHub();
let db, app, device, sync, adminToken;

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const register = async (username) => (await api().post('/api/auth/register')
  .send({ username, email: `${username}@test.vn`, password: '123456' }).expect(201)).body.token;
const reserve = async (token, slotNumber, durationMinutes = 60) => (await api().post(`/api/lots/${LOT}/reservations`)
  .set(auth(token)).send({ slotNumber, durationMinutes }).expect(201)).body;
const pass = async (token, id) => (await api().get(`/api/reservations/${id}/pass`).set(auth(token)).expect(200)).body;
const scan = (gate, token) => api().post('/api/gates/scan').set(auth(adminToken)).send({ lotId: LOT, gate, token });
const active = async (token) => (await api().get('/api/sessions/active').set(auth(token)).expect(200)).body;
const notes = async (token) => (await api().get('/api/notifications').set(auth(token)).expect(200)).body;
const lot = async () => (await api().get(`/api/lots/${LOT}/live?wait=0`).expect(200)).body;
// Cam bien gia lap: xe vao / roi o (cap nhat ca thiet bi gia lap)
const park = (n) => { device.state.slots[n - 1].occupied = true; device.state.slots[n - 1].reserved = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'occupied' }); };
const leave = (n) => { device.state.slots[n - 1].occupied = false;
  return sync.handleEvent(LOT, { type: 'slot_changed', slot: n, state: 'free' }); };
const ago = (sessionId, minutes) => db.query(
  `UPDATE parking_sessions SET started_at = started_at - make_interval(mins => $2),
     planned_end_at = planned_end_at - make_interval(mins => $2) WHERE id = $1`, [sessionId, minutes]);
const until = async (fn, ms = 2000) => {
  for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await new Promise((ok) => setTimeout(ok, 50)); }
  return false;
};

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
  app = createApp({ db, auth: createAuth(config), device, gatePass: gp, live });
  adminToken = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
});

after(async () => db && db.end());

describe('Tinh phi phien gui xe', () => {
  const t0 = new Date('2026-11-21T08:00:00Z');
  const at = (min) => new Date(t0.getTime() + min * 60000);
  test('Lam tron len theo gio, toi thieu 1 gio', () => {
    assert.equal(sessionFee({ startedAt: t0, endAt: at(5), pricePerHour: PRICE }).total, 10000);
    assert.equal(sessionFee({ startedAt: t0, endAt: at(61), pricePerHour: PRICE }).total, 20000);
  });
  test('Qua gio du kien (+5 phut an han) -> phu phi 50%/gio', () => {
    const f = sessionFee({ startedAt: t0, endAt: at(125), pricePerHour: PRICE, plannedEndAt: at(60) });
    assert.deepEqual([f.hours, f.base, f.overtimeHours, f.overtime, f.total], [3, 30000, 1, 5000, 35000]);
    assert.equal(sessionFee({ startedAt: t0, endAt: at(64), pricePerHour: PRICE, plannedEndAt: at(60) }).overtime, 0);
  });
  test('Vao bai roi ra luon trong 15 phut (chua do) -> mien phi', () => {
    assert.equal(sessionFee({ startedAt: t0, endAt: at(10), pricePerHour: PRICE, parked: false }).total, 0);
    assert.equal(sessionFee({ startedAt: t0, endAt: at(30), pricePerHour: PRICE, parked: false }).total, 10000);
  });
});

describe('Quy trinh xe vao -> ra (day du)', () => {
  let an, resv, sid;
  before(async () => { an = await register('ss_an'); });

  test('Quet ma cong vao thanh cong -> bat dau phien gui xe (phase entered), co thong bao', async () => {
    resv = await reserve(an, 1, 60);
    assert.equal((await active(an)).session, null);
    const r = await scan('entry', (await pass(an, resv.id)).token).expect(200);
    assert.ok(r.body.sessionId);
    sid = r.body.sessionId;
    const { session, unread } = await active(an);
    assert.equal(session.id, sid);
    assert.equal(session.phase, 'entered');
    assert.equal(session.slotNumber, 1);
    assert.equal(session.zone, 'A');
    assert.equal(session.reservationCode, resv.code);
    assert.ok(session.startedAt);
    assert.equal(session.plannedMinutes, 60);
    assert.equal(session.cost.total, 0); // chua do o nao: ra trong 15 phut thi mien phi
    assert.equal(session.cost.final, false);
    assert.ok(unread >= 1);
    assert.equal((await notes(an)).items[0].type, 'session_started');
    const d = await api().get(`/api/reservations/${resv.id}`).set(auth(an)).expect(200);
    assert.equal(d.body.sessionId, sid);
  });

  test('Thoi gian thuc: app dang cho /live duoc danh thuc ngay khi cam bien bao xe vao o', async () => {
    const { version } = (await api().get('/api/live?wait=0').expect(200)).body;
    const started = Date.now();
    const waiting = api().get(`/api/live?v=${version}&wait=10`).then((r) => r);
    await new Promise((ok) => setTimeout(ok, 300));
    await park(1);
    const r = await waiting;
    assert.equal(r.body.changed, true);
    assert.notEqual(r.body.version, version);
    assert.ok(Date.now() - started < 5000);
    const l = r.body.lots.find((x) => x.id === LOT);
    assert.equal(l.occupiedSlots, 1);
    assert.equal(l.carsInLot, 1);
  });

  test('Xe vao o -> phase parked, dat cho fulfilled, thong bao "Xe da vao o"', async () => {
    const { session } = await active(an);
    assert.equal(session.phase, 'parked');
    assert.ok(session.parkedAt);
    const d = await api().get(`/api/reservations/${resv.id}`).set(auth(an)).expect(200);
    assert.equal(d.body.status, 'fulfilled');
    assert.ok((await notes(an)).items.some((n) => n.type === 'parked'));
    const l = await lot();
    assert.equal(l.slots[0].state, 'occupied');
    assert.equal(l.carsInLot, 1);
  });

  test('Qua gio du kien -> canh bao + phu phi; phi tang -> thong bao thay doi chi phi', async () => {
    await ago(sid, 124); // vao bai 124 phut truoc, du kien 60 phut -> qua gio 59 phut (> 5 phut an han)
    const { session } = await active(an);
    assert.equal(session.overtime, true);
    assert.equal(session.cost.hours, 3);
    assert.equal(session.cost.overtime, 5000);
    assert.equal(session.cost.total, 35000);
    assert.ok(new Date(session.cost.nextChangeAt) > new Date());
    const types = (await notes(an)).items.map((n) => n.type);
    assert.ok(types.includes('overtime'));
    assert.ok(types.includes('fee_changed'));
    // mo app lan nua -> khong bao trung
    const again = (await notes(an)).items.filter((n) => n.type === 'overtime');
    assert.equal(again.length, 1);
  });

  test('Gia han phien dang hoat dong -> het qua gio, phi du kien moi; vuot gioi han -> 409', async () => {
    const r = await api().post(`/api/sessions/${sid}/extend`).set(auth(an)).send({ minutes: 120 }).expect(200);
    assert.equal(r.body.plannedMinutes, 180);
    assert.equal(r.body.extendCount, 1);
    assert.equal(r.body.overtime, false);
    assert.equal(r.body.cost.overtime, 0);
    assert.equal(r.body.cost.total, 30000);
    assert.equal(r.body.cost.planned, 30000);
    assert.ok((await notes(an)).items.some((n) => n.type === 'extended'));
    const big = await api().post(`/api/sessions/${sid}/extend`).set(auth(an)).send({ minutes: 240 });
    assert.equal(big.status, 200); // 420 phut
    for (let i = 0; i < 3; i++) await api().post(`/api/sessions/${sid}/extend`).set(auth(an)).send({ minutes: 240 }).expect(200);
    const tooLong = await api().post(`/api/sessions/${sid}/extend`).set(auth(an)).send({ minutes: 240 }).expect(409);
    assert.equal(tooLong.body.error, 'extend_limit'); // da 5 lan
    const other = await register('ss_la');
    await api().post(`/api/sessions/${sid}/extend`).set(auth(other)).send({ minutes: 30 }).expect(404);
  });

  test('Cap nhat phien: doi xe (chi xe cua minh)', async () => {
    const veh = (await api().post('/api/vehicles').set(auth(an)).send({ plateNumber: '43A-111.11' }).expect(201)).body;
    const r = await api().patch(`/api/sessions/${sid}`).set(auth(an)).send({ vehicleId: veh.id }).expect(200);
    assert.equal(r.body.vehiclePlate, '43A-111.11');
    await api().patch(`/api/sessions/${sid}`).set(auth(an)).send({ vehicleId: 99999 }).expect(400);
  });

  test('Cam bien chap chon (roi o roi thay lai ngay) -> noi tiep phien, khong chot phi', async () => {
    await leave(1);
    await park(1);
    const { session } = await active(an);
    assert.equal(session.id, sid);
    assert.equal(session.phase, 'parked');
    assert.ok(session.flags.includes('sensor_gap'));
    const n = await db.one('SELECT COUNT(*)::int AS n FROM parking_sessions WHERE reservation_id = $1', [resv.id]);
    assert.equal(n.n, 1);
  });

  test('ESP32 khoi dong lai (uptime < 15s, cam bien chua doc) -> khong chot phi nham', async () => {
    await sync.handleStatus(LOT, { uptime: 3, slots: [1, 2, 3, 4].map((id) => ({ id, state: 'free', distance: 400 })) });
    assert.equal((await active(an)).session.phase, 'parked');
    assert.equal((await lot()).slots[0].state, 'occupied');
  });

  test('Cong ra khi xe con trong o -> still_parked', async () => {
    const p = await pass(an, resv.id);
    assert.equal(p.gate, 'exit');
    assert.equal(p.block.error, 'still_parked');
    assert.equal((await scan('exit', p.token).expect(409)).body.error, 'still_parked');
  });

  test('Xe roi o -> chot phi (phase left), thong bao phi; quet ra khi chua tra -> 402', async () => {
    await leave(1);
    const { session } = await active(an);
    assert.equal(session.phase, 'left');
    assert.equal(session.cost.final, true);
    assert.equal(session.fee, 30000); // 124 phut -> 3 gio, da gia han nen khong phu phi
    assert.equal(session.amountDue, 30000);
    assert.equal(session.canPay, true);
    const left = (await notes(an)).items.find((n) => n.type === 'left_slot');
    assert.equal(left.data.fee, 30000);
    const p = await pass(an, resv.id);
    assert.equal(p.block.error, 'payment_required');
    assert.equal(p.block.fee, 30000);
    const r = await scan('exit', p.token).expect(402);
    assert.equal(r.body.details.fee, 30000);
  });

  test('Thanh toan -> quet ra -> barie mo, ket thuc phien (completed), het xe trong bai', async () => {
    const pay = await api().post(`/api/sessions/${sid}/pay`).set(auth(an)).send({ method: 'momo' }).expect(201);
    assert.equal(pay.body.amount, 30000);
    assert.ok((await notes(an)).items.some((n) => n.type === 'paid'));
    const r = await scan('exit', (await pass(an, resv.id)).token).expect(200);
    assert.equal(r.body.fee, 30000);
    assert.equal((await active(an)).session, null);
    const d = await api().get(`/api/sessions/${sid}`).set(auth(an)).expect(200);
    assert.equal(d.body.phase, 'completed');
    assert.ok(d.body.exitedAt);
    assert.equal(d.body.paid, true);
    const tl = d.body.timeline.map((n) => n.type);
    for (const t of ['session_started', 'parked', 'overtime', 'extended', 'left_slot', 'paid', 'exited']) assert.ok(tl.includes(t), t);
    assert.equal((await lot()).carsInLot, 0);
    const mine = (await api().get('/api/sessions/mine').set(auth(an)).expect(200)).body;
    assert.equal(mine[0].status, 'paid');
  });

  test('Danh dau da doc thong bao', async () => {
    assert.ok((await notes(an)).unread > 0);
    const r = await api().post('/api/notifications/read').set(auth(an)).send({ all: true }).expect(200);
    assert.equal(r.body.unread, 0);
    await api().post('/api/notifications/read').set(auth(an)).send({}).expect(400);
  });
});

describe('Tinh huong ngoai le', () => {
  let binh, chi, dung;
  before(async () => { binh = await register('ss_binh'); chi = await register('ss_chi'); dung = await register('ss_dung'); });

  test('Vao bai roi ra ngay (chua do) trong 15 phut -> mien phi, tra o, phien completed', async () => {
    const r = await reserve(binh, 2);
    await scan('entry', (await pass(binh, r.id)).token).expect(200);
    const p = await pass(binh, r.id);
    assert.equal(p.block, null);
    await scan('exit', p.token).expect(200);
    const d = await api().get(`/api/reservations/${r.id}`).set(auth(binh)).expect(200);
    assert.equal(d.body.status, 'cancelled');
    assert.equal(d.body.error, 'left_without_parking');
    const s = await api().get(`/api/sessions/${d.body.sessionId}`).set(auth(binh)).expect(200);
    assert.equal(s.body.phase, 'completed');
    assert.equal(s.body.fee, 0);
    assert.equal((await lot()).slots[1].state, 'free');
  });

  test('Vao bai qua 15 phut khong do -> nhac "chua vao o"; ra cong phai tra phi (chot phi luc thanh toan)', async () => {
    const r = await reserve(binh, 2);
    const e = await scan('entry', (await pass(binh, r.id)).token).expect(200);
    await ago(e.body.sessionId, 25);
    assert.ok((await notes(binh)).items.some((n) => n.type === 'not_parked'));
    const p = await pass(binh, r.id);
    assert.equal(p.block.error, 'payment_required');
    assert.equal(p.block.fee, 10000);
    assert.equal((await active(binh)).session.canPay, true);
    await api().post(`/api/sessions/${e.body.sessionId}/pay`).set(auth(binh)).send({ method: 'card' }).expect(201);
    await scan('exit', (await pass(binh, r.id)).token).expect(200);
    assert.equal((await active(binh)).session, null);
  });

  test('Do nham o trong (khong ai dat) -> phien chuyen sang o moi, o da dat duoc tra va bao thiet bi huy giu', async () => {
    const r = await reserve(chi, 2);
    const e = await scan('entry', (await pass(chi, r.id)).token).expect(200);
    device.state.log.length = 0;
    await park(4);
    const { session } = await active(chi);
    assert.equal(session.id, e.body.sessionId);
    assert.equal(session.slotNumber, 4);
    assert.equal(session.phase, 'parked');
    assert.ok(session.flags.includes('wrong_slot'));
    assert.ok((await notes(chi)).items.some((n) => n.type === 'wrong_slot'));
    assert.ok(await until(async () => device.state.log.some((c) => c.action === 'cancel_reservation' && c.slot === 2)));
    assert.equal((await lot()).slots[1].state, 'free');
    // roi o 4 -> chot phi, tra tien, ra
    await leave(4);
    await api().post(`/api/sessions/${session.id}/pay`).set(auth(chi)).send({ method: 'bank' }).expect(201);
    await scan('exit', (await pass(chi, r.id)).token).expect(200);
  });

  test('Do nham vao o nguoi khac dang giu (ho chua den) -> doi cho cua ho sang o cua xe do nham', async () => {
    const theirs = await reserve(dung, 3);       // dung giu o 3, chua den
    const mine = await reserve(chi, 1);          // chi giu o 1, qua cong
    await scan('entry', (await pass(chi, mine.id)).token).expect(200);
    await park(3);                               // nhung lai do vao o 3
    assert.equal((await active(chi)).session.slotNumber, 3);
    const moved = await api().get(`/api/reservations/${theirs.id}`).set(auth(dung)).expect(200);
    assert.equal(moved.body.status, 'active');
    assert.equal(moved.body.slotNumber, 1);
    assert.ok((await notes(dung)).items.some((n) => n.type === 'slot_changed'));
    const l = await lot();
    assert.equal(l.slots[0].state, 'reserved');
    assert.equal(l.slots[2].state, 'occupied');
    await api().delete(`/api/reservations/${theirs.id}`).set(auth(dung)).expect(200);
    await leave(3);
    const sid = (await active(chi)).session.id;
    await api().post(`/api/sessions/${sid}/pay`).set(auth(chi)).send({ method: 'momo' }).expect(201);
    await scan('exit', (await pass(chi, mine.id)).token).expect(200);
  });

  test('Mat ket noi: ESP32 khoi dong lai (mat giu cho) -> online lai thi server gui lai lenh giu cho', async () => {
    const r = await reserve(dung, 2);
    await sync.handleOnline(LOT, '0');
    device.state.slots.forEach((s) => { s.reserved = false; });     // RAM cua ESP32 bi xoa
    await sync.handleStatus(LOT, { slots: [1, 2, 3, 4].map((id) => ({ id, state: 'free', distance: 400 })) });
    assert.equal((await lot()).slots[1].state, 'free');
    await db.query('UPDATE parking_lots SET online = true WHERE id = $1', [LOT]);
    const restored = await sync.resyncDevice(LOT);
    assert.equal(restored, 1);
    assert.equal(device.state.slots[1].reserved, true);
    assert.equal((await lot()).slots[1].state, 'reserved');
    assert.equal((await api().get(`/api/reservations/${r.id}`).set(auth(dung)).expect(200)).body.status, 'active');
    // goi lai lan nua (thiet bi van giu) -> khong lam gi
    assert.equal(await sync.resyncDevice(LOT), 0);
    await api().delete(`/api/reservations/${r.id}`).set(auth(dung)).expect(200);
  });

  test('Dat cho het han (khong den) -> thong bao het han', async () => {
    const r = await reserve(dung, 2);
    await db.query(`UPDATE reservations SET expires_at = now() - interval '5 minutes' WHERE id = $1`, [r.id]);
    await api().get('/api/reservations').set(auth(dung)).expect(200);
    const n = (await notes(dung)).items.find((x) => x.type === 'reservation_expired');
    assert.equal(n.reservationId, r.id);
  });

  test('Khach vang lai (vao bang nut) -> phien sensor, ra cong bang nut; luot vao/ra hom nay duoc dem', async () => {
    await sync.handleEvent(LOT, { type: 'gate', gate: 'entry', state: 'open', by: 'button' });
    await park(2);
    let l = await lot();
    assert.equal(l.carsInLot, 1);
    assert.ok(l.today.entries >= 1);
    assert.equal(l.events[0].type, 'slot_changed');
    await leave(2);
    await sync.handleEvent(LOT, { type: 'gate', gate: 'exit', state: 'open', by: 'button' });
    l = await lot();
    assert.equal(l.carsInLot, 0);
    assert.ok(l.today.exits >= 1);
    const s = (await api().get(`/api/lots/${LOT}/sessions`).set(auth(adminToken)).expect(200)).body[0];
    assert.equal(s.source, 'sensor');
    assert.equal(s.fee, PRICE);
  });
});
