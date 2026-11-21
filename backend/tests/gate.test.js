// Ma QR qua cong: cap ma, xac thuc, mo barie, xac nhan vao/ra, xu ly loi quet
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
const { createFakeDevice } = require('./fakeDevice');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
const gp = createGatePass('qr-test-secret');
let db, app, device, sync, adminToken, userToken, user2Token, resvId, tokenA;

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const scan = (body, t = adminToken) => api().post('/api/gates/scan').set(auth(t)).send({ lotId: LOT, ...body });
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
  app = createApp({ db, auth: createAuth(config), device, gatePass: gp });
  adminToken = (await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200)).body.token;
  userToken = await register('qr_an');
  user2Token = await register('qr_binh');
  await api().post('/api/lots').set(auth(adminToken)).send({ id: 'sp-khac-02', name: 'Bai khac', totalSlots: 2 }).expect(201);
});

after(async () => db && db.end());

describe('Ma QR qua cong', () => {
  test('Dat cho -> app lay ma QR cong VAO (ngan han, co chu ky); nguoi khac khong lay duoc', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(userToken)).send({ slotNumber: 1 }).expect(201);
    resvId = r.body.id;
    assert.equal(r.body.nextGate, 'entry');
    const p = await api().get(`/api/reservations/${resvId}/pass`).set(auth(userToken)).expect(200);
    assert.equal(p.body.gate, 'entry');
    assert.match(p.body.token, /^SP1\.[0-9a-z]+\.E\.[0-9a-z]+\.[\w-]{8}\.[\w-]{16}$/);
    assert.equal(p.body.ttlSeconds, 120);
    assert.equal(p.body.block, null);
    tokenA = p.body.token;
    await api().get(`/api/reservations/${resvId}/pass`).set(auth(user2Token)).expect(404);
  });

  test('Chi admin/nhan vien duoc quet; ma rac / bi sua / sai cong / sai bai / het han bi tu choi', async () => {
    await scan({ gate: 'entry', token: tokenA }, userToken).expect(403);
    assert.equal((await scan({ gate: 'entry', token: 'https://vi-du.com' }).expect(400)).body.error, 'qr_invalid');
    const parts = tokenA.split('.');
    parts[1] = (resvId + 1).toString(36); // doi id dat cho -> sai chu ky
    assert.equal((await scan({ gate: 'entry', token: parts.join('.') }).expect(400)).body.error, 'qr_invalid');
    // Ma ky bang khoa khac (vd may chu khac) -> khong hop le
    const foreign = createGatePass('khoa-khac').issue(resvId, 'entry').token;
    assert.equal((await scan({ gate: 'entry', token: foreign }).expect(400)).body.error, 'qr_invalid');
    const wg = await scan({ gate: 'exit', token: tokenA }).expect(409);
    assert.equal(wg.body.error, 'wrong_gate');
    assert.equal(wg.body.details.reservation.id, resvId);
    const wl = await scan({ lotId: 'sp-khac-02', gate: 'entry', token: tokenA }).expect(409);
    assert.equal(wl.body.error, 'wrong_lot');
    assert.equal(wl.body.details.expectedLot.id, LOT);
    const old = gp.issue(resvId, 'entry', -60).token;
    assert.equal((await scan({ gate: 'entry', token: old }).expect(410)).body.error, 'qr_expired');
    await scan({ gate: 'sideway', token: tokenA }).expect(400);
    await scan({ lotId: 'khong-co', gate: 'entry', token: tokenA }).expect(404);
  });

  test('Thiet bi offline -> 503; khong phan hoi -> 504 (barie chua mo, chua tinh la vao)', async () => {
    await db.query('UPDATE parking_lots SET online = false WHERE id = $1', [LOT]);
    assert.equal((await scan({ gate: 'entry', token: tokenA }).expect(503)).body.error, 'device_offline');
    await db.query('UPDATE parking_lots SET online = true WHERE id = $1', [LOT]);
    device.state.mode = 'timeout';
    assert.equal((await scan({ gate: 'entry', token: tokenA }).expect(504)).body.error, 'device_timeout');
    device.state.mode = 'ok';
    const r = await api().get(`/api/reservations/${resvId}`).set(auth(userToken)).expect(200);
    assert.equal(r.body.enteredAt, null);
  });

  test('Ack mo barie den tre (qua MQTT) -> van xac nhan xe da vao; ma vao dung lai bi chan', async () => {
    const cmd = device.state.log.at(-1);
    assert.equal(cmd.action, 'open_gate');
    assert.equal(cmd.gate, 'entry');
    assert.equal(cmd.slot, 1);
    await sync.handleEvent(LOT, { type: 'ack', action: 'open_gate', ok: true, gate: 'entry', requestId: cmd.requestId });
    const r = await api().get(`/api/reservations/${resvId}`).set(auth(userToken)).expect(200);
    assert.ok(r.body.enteredAt);
    assert.equal(r.body.nextGate, 'exit');
    assert.equal((await scan({ gate: 'entry', token: tokenA }).expect(409)).body.error, 'already_entered');
  });

  test('Da qua cong vao -> khong bi tinh "khong den" khi het gio giu cho', async () => {
    await db.query(`UPDATE reservations SET expires_at = now() - interval '10 minutes' WHERE id = $1`, [resvId]);
    const r = await api().get(`/api/reservations/${resvId}`).set(auth(userToken)).expect(200);
    assert.equal(r.body.status, 'active');
  });

  test('Cong RA: xe con trong o -> still_parked; chua tra phi -> 402; tra xong -> mo barie, xac nhan ra', async () => {
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'occupied' });
    const pass = await api().get(`/api/reservations/${resvId}/pass`).set(auth(userToken)).expect(200);
    assert.equal(pass.body.gate, 'exit');
    assert.equal(pass.body.block.error, 'still_parked');
    const out = pass.body.token;
    assert.equal((await scan({ gate: 'exit', token: out }).expect(409)).body.error, 'still_parked');

    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'free' });
    const unpaid = await scan({ gate: 'exit', token: out }).expect(402);
    assert.equal(unpaid.body.error, 'payment_required');
    assert.equal(unpaid.body.details.fee, 10000);
    const p2 = await api().get(`/api/reservations/${resvId}/pass`).set(auth(userToken)).expect(200);
    assert.equal(p2.body.block.error, 'payment_required');

    await api().post(`/api/sessions/${unpaid.body.details.sessionId}/pay`).set(auth(userToken)).send({ method: 'momo' }).expect(201);
    const ok = await scan({ gate: 'exit', token: out }).expect(200);
    assert.equal(ok.body.gate, 'exit');
    assert.ok(ok.body.confirmedAt);
    assert.ok(ok.body.reservation.exitedAt);
    assert.equal(ok.body.reservation.nextGate, null);
    assert.equal(device.state.log.at(-1).action, 'open_gate');
    assert.equal(device.state.log.at(-1).gate, 'exit');

    assert.equal((await scan({ gate: 'exit', token: out }).expect(409)).body.error, 'already_exited');
    assert.equal((await api().get(`/api/reservations/${resvId}/pass`).set(auth(userToken)).expect(409)).body.error, 'already_exited');
  });

  test('2 may quet cung 1 ma cung luc -> chi mo barie 1 lan; vao roi ra khi chua do -> tra o', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 2 }).expect(201);
    const { token } = (await api().get(`/api/reservations/${r.body.id}/pass`).set(auth(user2Token)).expect(200)).body;
    const opens = () => device.state.log.filter((c) => c.action === 'open_gate').length;
    const n0 = opens();
    const res = await Promise.all([scan({ gate: 'entry', token }), scan({ gate: 'entry', token })]);
    assert.deepEqual(res.map((x) => x.status).sort(), [200, 409]);
    assert.ok(['scan_in_progress', 'already_entered'].includes(res.find((x) => x.status === 409).body.error));
    assert.equal(opens(), n0 + 1);

    const out = (await api().get(`/api/reservations/${r.body.id}/pass`).set(auth(user2Token)).expect(200)).body;
    assert.equal(out.gate, 'exit');
    assert.equal(out.block, null); // chua do o nao -> ra mien phi
    const ok = await scan({ gate: 'exit', token: out.token }).expect(200);
    assert.equal(ok.body.reservation.status, 'cancelled');
    assert.equal(ok.body.reservation.error, 'left_without_parking');
    assert.equal(device.state.log.at(-1).action, 'cancel_reservation');
    const lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[1].state, 'free');
  });

  test('Dat cho da huy / het han -> khong cap ma', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 3 }).expect(201);
    await api().delete(`/api/reservations/${r.body.id}`).set(auth(user2Token)).expect(200);
    const p = await api().get(`/api/reservations/${r.body.id}/pass`).set(auth(user2Token)).expect(409);
    assert.equal(p.body.error, 'reservation_not_active');
  });

  test('Nhat ky quet ghi ca lan loi (de doi chieu su co)', async () => {
    const r = await api().get(`/api/gates/scans?lotId=${LOT}&limit=50`).set(auth(adminToken)).expect(200);
    const errors = new Set(r.body.filter((x) => x.result === 'denied').map((x) => x.error));
    for (const e of ['qr_invalid', 'wrong_gate', 'qr_expired', 'device_offline', 'already_entered', 'still_parked', 'payment_required']) {
      assert.ok(errors.has(e), `thieu ${e}`);
    }
    // lan timeout da duoc xac nhan lai thanh 'granted' khi ack den tre
    assert.ok(r.body.some((x) => x.result === 'granted' && x.gate === 'entry' && x.reservationId === resvId));
    assert.equal(r.body.filter((x) => x.result === 'granted').length, 4);
    assert.equal(r.body.find((x) => x.reservationId === resvId).reservationCode.slice(0, 3), 'DC-');
    await api().get('/api/gates/scans').set(auth(userToken)).expect(403);
  });
});
