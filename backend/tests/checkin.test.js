// Tai xe tu quet ma QR cua CONG (admin hien ma tai cong) + khai bao xe (bien so, ten xe, loai xe)
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
let db, app, device, sync, adminToken, an, binh, vehAn, vehBinh;

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const display = (gate, lotId = LOT, t = adminToken) => api().get(`/api/gates/display?lotId=${lotId}&gate=${gate}`).set(auth(t));
const gateToken = async (gate, lotId = LOT) => (await display(gate, lotId).expect(200)).body.token;
const checkin = (t, body) => api().post('/api/gates/checkin').set(auth(t)).send(body);
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
  an = await register('ci_an');
  binh = await register('ci_binh');
  await api().post('/api/lots').set(auth(adminToken)).send({ id: 'sp-khac-02', name: 'Bai khac', totalSlots: 2 }).expect(201);
});

after(async () => db && db.end());

describe('Xe cua toi: bien so, ten xe, loai xe', () => {
  test('Them xe kem loai xe; mac dinh o to; loai / bien so sai bi tu choi', async () => {
    const r = await api().post('/api/vehicles').set(auth(an))
      .send({ plateNumber: ' 59x1  234.56 ', brand: 'Honda Vision', vehicleType: 'motorbike', color: 'Do' }).expect(201);
    assert.equal(r.body.plateNumber, '59X1 234.56');
    assert.equal(r.body.vehicleType, 'motorbike');
    assert.equal(r.body.brand, 'Honda Vision');
    vehAn = r.body;
    const car = await api().post('/api/vehicles').set(auth(binh)).send({ plateNumber: '43A-999.99' }).expect(201);
    assert.equal(car.body.vehicleType, 'car');
    vehBinh = car.body;
    assert.equal((await api().post('/api/vehicles').set(auth(an))
      .send({ plateNumber: '43A-111.11', vehicleType: 'tank' }).expect(400)).body.error, 'invalid_vehicle_type');
    assert.equal((await api().post('/api/vehicles').set(auth(an))
      .send({ plateNumber: '<script>' }).expect(400)).body.error, 'invalid_plate');
    assert.equal((await api().post('/api/vehicles').set(auth(an))
      .send({ plateNumber: 'ABCD-EF' }).expect(400)).body.error, 'invalid_plate');
  });

  test('Sua xe: doi loai / ten, xoa mau; khong sua duoc xe nguoi khac; trung bien so -> 409', async () => {
    const r = await api().put(`/api/vehicles/${vehAn.id}`).set(auth(an))
      .send({ vehicleType: 'electric', brand: 'VinFast Evo', color: '' }).expect(200);
    assert.equal(r.body.vehicleType, 'electric');
    assert.equal(r.body.brand, 'VinFast Evo');
    assert.equal(r.body.color, null);
    assert.equal(r.body.plateNumber, '59X1 234.56');
    await api().put(`/api/vehicles/${vehAn.id}`).set(auth(binh)).send({ brand: 'x' }).expect(404);
    await api().put(`/api/vehicles/${vehAn.id}`).set(auth(an)).send({ plateNumber: '43A-999.99' }).expect(409);
    const list = await api().get('/api/vehicles').set(auth(an)).expect(200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].vehicleType, 'electric');
  });
});

describe('Tai xe quet ma QR cua cong', () => {
  let resvId;

  test('Chi admin lay duoc ma cong; ma ngan han, ky rieng tung bai + cong', async () => {
    await display('entry', LOT, an).expect(403);
    await display('sideway').expect(400);
    await display('entry', 'khong-co').expect(404);
    const d = (await display('entry').expect(200)).body;
    assert.match(d.token, /^SPG1\.[\w-]+\.E\.[0-9a-z]+\.[\w-]{8}\.[\w-]{16}$/);
    assert.equal(d.ttlSeconds, 60);
    assert.equal(d.lotName.length > 0, true);
    const v = gp.verifyGate(d.token);
    assert.equal(v.ok, true);
    assert.equal(v.lotId, LOT);
    assert.equal(v.gate, 'entry');
  });

  test('Ma rac / ma dat cho / ky khoa khac / bi sua / het han bi tu choi', async () => {
    assert.equal((await checkin(an, { token: 'https://vi-du.com' }).expect(400)).body.error, 'qr_invalid');
    await checkin(an, {}).expect(400);
    // Ma QR dat cho (SP1) khong phai ma cong
    assert.equal((await checkin(an, { token: gp.issue(1, 'entry').token }).expect(400)).body.error, 'qr_invalid');
    const foreign = createGatePass('khoa-khac').issueGate(LOT, 'entry').token;
    assert.equal((await checkin(an, { token: foreign }).expect(400)).body.error, 'qr_invalid');
    const parts = (await gateToken('entry')).split('.');
    parts[1] = Buffer.from('sp-khac-02').toString('base64url'); // doi bai -> sai chu ky
    assert.equal((await checkin(an, { token: parts.join('.') }).expect(400)).body.error, 'qr_invalid');
    const old = gp.issueGate(LOT, 'entry', -60).token;
    const exp = await checkin(an, { token: old }).expect(410);
    assert.equal(exp.body.error, 'qr_expired');
    assert.equal(exp.body.details.lot.id, LOT);
    // Ma hop le nhung bai da bi xoa
    assert.equal((await checkin(an, { token: gp.issueGate('da-xoa', 'entry').token }).expect(404)).body.error, 'lot_not_found');
    await api().post('/api/gates/checkin').send({ token: await gateToken('entry') }).expect(401);
  });

  test('Chua dat cho -> no_reservation (kem bai de app goi y dat ngay)', async () => {
    const r = await checkin(an, { token: await gateToken('entry') }).expect(404);
    assert.equal(r.body.error, 'no_reservation');
    assert.equal(r.body.details.lot.id, LOT);
  });

  test('Dat cho o bai khac -> quet cong bai nay van la no_reservation', async () => {
    const r = await api().post('/api/lots/sp-khac-02/reservations').set(auth(binh)).send({ slotNumber: 1 });
    // Bai khac offline (chua co thiet bi) -> dat cho that bai; du the nao cung khong dung duoc o bai demo
    assert.ok([201, 503, 504].includes(r.status));
    assert.equal((await checkin(binh, { token: await gateToken('entry') }).expect(404)).body.error, 'no_reservation');
  });

  test('Thiet bi offline -> 503, khong tinh la vao', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(an)).send({ slotNumber: 1 }).expect(201);
    resvId = r.body.id;
    assert.equal(r.body.vehicleId, null);
    await db.query('UPDATE parking_lots SET online = false WHERE id = $1', [LOT]);
    assert.equal((await checkin(an, { token: await gateToken('entry') }).expect(503)).body.error, 'device_offline');
    await db.query('UPDATE parking_lots SET online = true WHERE id = $1', [LOT]);
  });

  test('Quet ma cong RA khi chua vao -> not_entered; xe nguoi khac -> vehicle_not_found', async () => {
    assert.equal((await checkin(an, { token: await gateToken('exit') }).expect(409)).body.error, 'not_entered');
    const bad = await checkin(an, { token: await gateToken('entry'), vehicleId: vehBinh.id }).expect(400);
    assert.equal(bad.body.error, 'vehicle_not_found');
  });

  test('Quet ma cong VAO -> mo barie, gan xe da chon, bat dau phien; quet lai -> already_entered', async () => {
    const n0 = device.state.log.filter((c) => c.action === 'open_gate').length;
    const ok = await checkin(an, { token: await gateToken('entry'), vehicleId: vehAn.id }).expect(200);
    assert.equal(ok.body.gate, 'entry');
    assert.equal(ok.body.lotId, LOT);
    assert.ok(ok.body.confirmedAt);
    assert.ok(ok.body.sessionId);
    assert.equal(ok.body.reservation.id, resvId);
    assert.equal(ok.body.reservation.vehicleId, vehAn.id);
    assert.equal(ok.body.reservation.vehiclePlate, '59X1 234.56');
    assert.equal(ok.body.reservation.vehicleType, 'electric');
    assert.equal(ok.body.reservation.nextGate, 'exit');
    const cmd = device.state.log.at(-1);
    assert.deepEqual([cmd.action, cmd.gate, cmd.slot], ['open_gate', 'entry', 1]);
    assert.equal(device.state.log.filter((c) => c.action === 'open_gate').length, n0 + 1);
    const s = await api().get(`/api/sessions/${ok.body.sessionId}`).set(auth(an)).expect(200);
    assert.equal(s.body.vehiclePlate, '59X1 234.56');

    assert.equal((await checkin(an, { token: await gateToken('entry') }).expect(409)).body.error, 'already_entered');
  });

  test('Quet ma cong RA: xe con trong o -> still_parked; chua tra -> 402; tra xong -> mo barie', async () => {
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'occupied' });
    assert.equal((await checkin(an, { token: await gateToken('exit') }).expect(409)).body.error, 'still_parked');
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 1, state: 'free' });
    const unpaid = await checkin(an, { token: await gateToken('exit') }).expect(402);
    assert.equal(unpaid.body.error, 'payment_required');
    assert.ok(unpaid.body.details.fee > 0);
    await api().post(`/api/sessions/${unpaid.body.details.sessionId}/pay`).set(auth(an)).send({ method: 'momo' }).expect(201);
    const ok = await checkin(an, { token: await gateToken('exit') }).expect(200);
    assert.equal(ok.body.gate, 'exit');
    assert.ok(ok.body.reservation.exitedAt);
    assert.equal(device.state.log.at(-1).gate, 'exit');
    // Da ra bai -> khong con dat cho nao o bai nay
    assert.equal((await checkin(an, { token: await gateToken('exit') }).expect(404)).body.error, 'no_reservation');
  });

  test('Bam quet 2 lan cung luc -> chi mo barie 1 lan', async () => {
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(binh)).send({ slotNumber: 2, vehicleId: vehBinh.id }).expect(201);
    const token = await gateToken('entry');
    const opens = () => device.state.log.filter((c) => c.action === 'open_gate').length;
    const n0 = opens();
    const res = await Promise.all([checkin(binh, { token }), checkin(binh, { token })]);
    assert.deepEqual(res.map((x) => x.status).sort(), [200, 409]);
    assert.equal(opens(), n0 + 1);
  });

  test('Nhat ky cong ghi lan quet cua tai xe (mode driver), loc theo cong', async () => {
    const r = await api().get(`/api/gates/scans?lotId=${LOT}&gate=entry&limit=50`).set(auth(adminToken)).expect(200);
    assert.ok(r.body.length > 0);
    assert.ok(r.body.every((x) => x.gate === 'entry'));
    assert.ok(r.body.every((x) => x.mode === 'driver'));
    const granted = r.body.find((x) => x.result === 'granted' && x.reservationId === resvId);
    assert.equal(granted.vehiclePlate, '59X1 234.56');
    assert.equal(granted.vehicleType, 'electric');
    assert.ok(granted.sessionId);
    const errors = new Set(r.body.map((x) => x.error));
    for (const e of ['qr_expired', 'no_reservation', 'device_offline', 'already_entered']) assert.ok(errors.has(e), `thieu ${e}`);
    const exits = await api().get(`/api/gates/scans?lotId=${LOT}&gate=exit`).set(auth(adminToken)).expect(200);
    assert.ok(new Set(exits.body.map((x) => x.error)).has('payment_required'));
  });
});
