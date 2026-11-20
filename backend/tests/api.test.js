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
const { createFakeDevice } = require('./fakeDevice');
const { createSocialVerifier } = require('../src/social');

if (!/ep-lucky-mountain/.test(config.databaseUrl) && !process.env.ALLOW_ANY_TEST_DB) {
  throw new Error('Test phai chay tren nhanh DB "test" (.env.test) - dung lai de tranh xoa DB that');
}

const LOT = 'sp-demo-01';
let db, app, device, sync, userToken, user2Token, adminToken, vehicleId;

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

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
  // Google / Facebook gia lap: token -> phan hoi cua API that
  const fakeFetch = async (url) => {
    const token = decodeURIComponent(new URL(url).searchParams.get('id_token') || new URL(url).searchParams.get('access_token'));
    const ok = (data) => ({ ok: true, json: async () => data });
    const bad = { ok: false, json: async () => ({ error: 'invalid' }) };
    if (url.includes('googleapis')) {
      if (token === 'g-good-new') return ok({ sub: 'g-111', aud: 'test-client', iss: 'https://accounts.google.com', email: 'google.user@gmail.com', email_verified: 'true', name: 'Nguyễn Văn Gờ', picture: 'http://img/g.png' });
      if (token === 'g-good-link') return ok({ sub: 'g-222', aud: 'test-client', iss: 'accounts.google.com', email: 'an@test.vn', email_verified: 'true', name: 'An' });
      if (token === 'g-other-app') return ok({ sub: 'g-333', aud: 'app-khac', iss: 'accounts.google.com', email: 'x@gmail.com', email_verified: 'true' });
      return bad;
    }
    if (url.includes('graph.facebook.com/app')) return token.startsWith('fb-good') ? ok({ id: '999' }) : ok({ id: '123' });
    if (url.includes('graph.facebook.com/me')) return token === 'fb-good-noemail' ? ok({ id: 'fb-777', name: 'Fb User' }) : bad;
    return bad;
  };
  const social = createSocialVerifier({ googleClientIds: ['test-client'], facebookAppId: '999', fetchFn: fakeFetch });
  app = createApp({ db, auth: createAuth(config), device, social });
});

after(async () => db && db.end());

describe('He thong', () => {
  test('GET /api/health', async () => {
    const r = await api().get('/api/health').expect(200);
    assert.equal(r.body.ok, true);
  });
  test('API khong ton tai -> 404', async () => {
    const r = await api().get('/api/khong-co').expect(404);
    assert.equal(r.body.error, 'not_found');
  });
  test('JSON loi -> 400 invalid_json', async () => {
    const r = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{abc').expect(400);
    assert.equal(r.body.error, 'invalid_json');
  });
});

describe('Xac thuc', () => {
  test('Dang ky thanh cong', async () => {
    const r = await api().post('/api/auth/register')
      .send({ username: 'an_nguyen', email: 'An@Test.vn', password: '123456', confirmPassword: '123456',
        fullName: 'Nguyen Van An', phone: '+84 901 234 567' }).expect(201);
    assert.equal(r.body.user.username, 'an_nguyen');
    assert.equal(r.body.user.phone, '0901234567');
    assert.ok(r.body.token);
    assert.equal(r.body.user.email, 'an@test.vn');
    assert.equal(r.body.user.role, 'user');
    assert.equal(r.body.user.password_hash, undefined);
    userToken = r.body.token;
  });
  test('Dang ky trung email -> 409', async () => {
    const r = await api().post('/api/auth/register')
      .send({ username: 'an_khac', email: 'an@test.vn', password: '123456' }).expect(409);
    assert.equal(r.body.error, 'email_taken');
    const r2 = await api().post('/api/auth/register')
      .send({ username: 'AN_NGUYEN', email: 'khac@test.vn', password: '123456' }).expect(409);
    assert.equal(r2.body.error, 'username_taken');
  });
  test('Dang ky thieu/sai du lieu -> 400', async () => {
    const reg = (b) => api().post('/api/auth/register').send(b);
    await reg({ username: 'binh01', email: 'sai-email', password: '123456' }).expect(400);
    await reg({ username: 'binh01', email: 'b@test.vn', password: '123' }).expect(400);
    await reg({ email: 'b@test.vn', password: '123456' }).expect(400);
    await reg({ username: 'a b', email: 'b@test.vn', password: '123456' }).expect(400);
    await reg({ username: 'binh01', email: 'b@test.vn', password: '123456', phone: '12345' }).expect(400);
    const m = await reg({ username: 'binh01', email: 'b@test.vn', password: '123456', confirmPassword: '654321' }).expect(400);
    assert.equal(m.body.error, 'password_mismatch');
  });
  test('Dang nhap dung / sai mat khau', async () => {
    const ok = await api().post('/api/auth/login').send({ email: 'an@test.vn', password: '123456' }).expect(200);
    assert.ok(ok.body.token);
    const bad = await api().post('/api/auth/login').send({ email: 'an@test.vn', password: 'sai' }).expect(401);
    assert.equal(bad.body.error, 'invalid_credentials');
    const admin = await api().post('/api/auth/login').send({ email: 'admin@test.vn', password: 'admin123' }).expect(200);
    adminToken = admin.body.token;
    const u2 = await api().post('/api/auth/register').send({ username: 'binh', email: 'binh@test.vn', password: '123456' });
    user2Token = u2.body.token;
  });
  test('GET /me can token hop le', async () => {
    await api().get('/api/auth/me').expect(401);
    await api().get('/api/auth/me').set(auth('abc.def.ghi')).expect(401);
    const r = await api().get('/api/auth/me').set(auth(userToken)).expect(200);
    assert.equal(r.body.fullName, 'Nguyen Van An');
  });
});

describe('OTP: dang nhap ten + SDT, tim ID, quen mat khau', () => {
  const otp = (b) => api().post('/api/auth/otp').send(b);

  test('Dang nhap bang ten + SDT qua OTP', async () => {
    const o = await otp({ purpose: 'login_phone', username: 'An_Nguyen', phone: '0901 234 567' }).expect(201);
    assert.match(o.body.devCode, /^\d{6}$/);
    assert.equal(o.body.sentTo, '090****567');
    const wrong = o.body.devCode === '000000' ? '111111' : '000000';
    const bad = await api().post('/api/auth/login/phone').send({ otpId: o.body.otpId, code: wrong }).expect(400);
    assert.equal(bad.body.error, 'otp_wrong');
    assert.equal(bad.body.details.attemptsLeft, 4);
    const ok = await api().post('/api/auth/login/phone').send({ otpId: o.body.otpId, code: o.body.devCode }).expect(200);
    assert.equal(ok.body.user.username, 'an_nguyen');
    assert.ok(ok.body.token);
    // ma da dung khong dung lai duoc
    await api().post('/api/auth/login/phone').send({ otpId: o.body.otpId, code: o.body.devCode }).expect(400);
  });
  test('Gui lai ma qua nhanh -> 429; sai ten/SDT -> 404', async () => {
    const r = await otp({ purpose: 'login_phone', username: 'an_nguyen', phone: '0901234567' }).expect(429);
    assert.equal(r.body.error, 'otp_too_soon');
    await otp({ purpose: 'login_phone', username: 'an_nguyen', phone: '0999999999' }).expect(404);
    await otp({ purpose: 'xyz', username: 'an_nguyen', phone: '0901234567' }).expect(400);
  });
  test('Tim ID (email)', async () => {
    const o = await otp({ purpose: 'find_id', username: 'an_nguyen', phone: '0901234567' }).expect(201);
    const r = await api().post('/api/auth/find-id').send({ otpId: o.body.otpId, code: o.body.devCode }).expect(200);
    assert.equal(r.body.email, 'an@test.vn');
    assert.equal(r.body.maskedEmail, 'an***@test.vn');
    // OTP cua find_id khong dung de dang nhap duoc
    await api().post('/api/auth/login/phone').send({ otpId: o.body.otpId, code: o.body.devCode }).expect(400);
  });
  test('Quen mat khau -> dat lai -> dang nhap bang mat khau moi', async () => {
    const o = await otp({ purpose: 'reset_password', email: 'an@test.vn' }).expect(201);
    await api().post('/api/auth/reset-password')
      .send({ otpId: o.body.otpId, code: o.body.devCode, newPassword: 'moi123', confirmPassword: 'khac' }).expect(400);
    await api().post('/api/auth/reset-password')
      .send({ otpId: o.body.otpId, code: o.body.devCode, newPassword: 'moi123' }).expect(200);
    await api().post('/api/auth/login').send({ email: 'an@test.vn', password: '123456' }).expect(401);
    const l = await api().post('/api/auth/login').send({ email: 'an@test.vn', password: 'moi123' }).expect(200);
    userToken = l.body.token;
    await otp({ purpose: 'reset_password', email: 'khongco@test.vn' }).expect(404);
  });
  test('Cap nhat SDT cho tai khoan', async () => {
    const r = await api().patch('/api/auth/me').set(auth(user2Token)).send({ phone: '0912345678' }).expect(200);
    assert.equal(r.body.phone, '0912345678');
  });
});

describe('Dang nhap Google / Facebook', () => {
  const social = (b) => api().post('/api/auth/social').send(b);
  test('Google lan dau -> tao tai khoan moi; lan sau -> cung tai khoan', async () => {
    const r = await social({ provider: 'google', token: 'g-good-new' }).expect(200);
    assert.equal(r.body.isNew, true);
    assert.equal(r.body.user.email, 'google.user@gmail.com');
    assert.equal(r.body.user.username, 'google.user');
    assert.equal(r.body.user.linked.google, true);
    const r2 = await social({ provider: 'google', token: 'g-good-new' }).expect(200);
    assert.equal(r2.body.isNew, false);
    assert.equal(r2.body.user.id, r.body.user.id);
  });
  test('Google trung email tai khoan co san -> lien ket, khong tao moi', async () => {
    const r = await social({ provider: 'google', token: 'g-good-link' }).expect(200);
    assert.equal(r.body.isNew, false);
    assert.equal(r.body.user.username, 'an_nguyen');
    assert.equal(r.body.user.linked.google, true);
  });
  test('Token sai / cua app khac -> 401', async () => {
    const a = await social({ provider: 'google', token: 'g-bad-token' }).expect(401);
    assert.equal(a.body.error, 'social_token_invalid');
    await social({ provider: 'google', token: 'g-other-app' }).expect(401);
    await social({ provider: 'facebook', token: 'fb-of-other-app' }).expect(401);
    await social({ provider: 'twitter', token: 'xxxxxxxxxxxx' }).expect(400);
  });
  test('Facebook khong co email -> tao tai khoan voi email tam', async () => {
    const r = await social({ provider: 'facebook', token: 'fb-good-noemail' }).expect(200);
    assert.equal(r.body.isNew, true);
    assert.equal(r.body.user.linked.facebook, true);
    assert.match(r.body.user.email, /^facebook_fb-777@users\.smartpark\.local$/);
  });
});

describe('Xe', () => {
  test('Them, xem, chong trung bien so', async () => {
    const r = await api().post('/api/vehicles').set(auth(userToken))
      .send({ plateNumber: '51a-123.45', brand: 'Toyota', color: 'Trang' }).expect(201);
    assert.equal(r.body.plateNumber, '51A-123.45');
    vehicleId = r.body.id;
    const list = await api().get('/api/vehicles').set(auth(userToken)).expect(200);
    assert.equal(list.body.length, 1);
    await api().post('/api/vehicles').set(auth(user2Token)).send({ plateNumber: '51A-123.45' }).expect(409);
  });
  test('Khong xoa duoc xe cua nguoi khac', async () => {
    await api().delete(`/api/vehicles/${vehicleId}`).set(auth(user2Token)).expect(404);
  });
});

describe('Lich gui xe', () => {
  let schedId;
  test('Them lich -> tra ve kem thong tin bai va bien so', async () => {
    const r = await api().post('/api/schedules').set(auth(userToken))
      .send({ name: 'Di lam', lotId: LOT, vehicleId, arriveTime: '07:30', days: [5, 1, 3, 1], minutes: 30 })
      .expect(201);
    schedId = r.body.id;
    assert.deepEqual(r.body.days, [1, 3, 5]);
    assert.equal(r.body.active, true);
    assert.equal(r.body.arriveTime, '07:30');
    assert.equal(r.body.lot.name.length > 0, true);
    assert.equal(typeof r.body.lot.freeSlots, 'number');
    assert.equal(r.body.vehiclePlate, '51A-123.45');
    const d = await api().post('/api/schedules').set(auth(userToken))
      .send({ name: 'Cuoi tuan', lotId: LOT, arriveTime: '06:05' }).expect(201);
    assert.deepEqual(d.body.days, [1, 2, 3, 4, 5]);
    assert.equal(d.body.minutes, 15);
    const list = await api().get('/api/schedules').set(auth(userToken)).expect(200);
    assert.deepEqual(list.body.map((x) => x.arriveTime), ['06:05', '07:30']);
  });
  test('Validate: gio sai, ngay sai, bai khong ton tai, xe cua nguoi khac, chua dang nhap', async () => {
    const base = { name: 'X', lotId: LOT, arriveTime: '08:00' };
    await api().post('/api/schedules').set(auth(userToken)).send({ ...base, arriveTime: '24:00' }).expect(400);
    await api().post('/api/schedules').set(auth(userToken)).send({ ...base, days: [0] }).expect(400);
    await api().post('/api/schedules').set(auth(userToken)).send({ ...base, days: [] }).expect(400);
    const nl = await api().post('/api/schedules').set(auth(userToken)).send({ ...base, lotId: 'khong-co' }).expect(400);
    assert.equal(nl.body.error, 'lot_not_found');
    await api().post('/api/schedules').set(auth(user2Token)).send({ ...base, vehicleId }).expect(400);
    await api().post('/api/schedules').send(base).expect(401);
  });
  test('Sua mot phan, bat/tat', async () => {
    const r = await api().patch(`/api/schedules/${schedId}`).set(auth(userToken))
      .send({ active: false, arriveTime: '08:15', vehicleId: null }).expect(200);
    assert.equal(r.body.active, false);
    assert.equal(r.body.arriveTime, '08:15');
    assert.equal(r.body.vehicleId, null);
    assert.equal(r.body.name, 'Di lam');
    await api().patch(`/api/schedules/${schedId}`).set(auth(userToken)).send({}).expect(400);
    await api().patch(`/api/schedules/${schedId}`).set(auth(userToken)).send({ active: 'no' }).expect(400);
  });
  test('Nguoi khac khong xem/sua/xoa duoc; xoa thanh cong', async () => {
    await api().get(`/api/schedules/${schedId}`).set(auth(user2Token)).expect(404);
    await api().patch(`/api/schedules/${schedId}`).set(auth(user2Token)).send({ name: 'hack' }).expect(404);
    await api().delete(`/api/schedules/${schedId}`).set(auth(user2Token)).expect(404);
    const l2 = await api().get('/api/schedules').set(auth(user2Token)).expect(200);
    assert.equal(l2.body.length, 0);
    await api().delete(`/api/schedules/${schedId}`).set(auth(userToken)).expect(204);
    await api().get(`/api/schedules/${schedId}`).set(auth(userToken)).expect(404);
  });
});

describe('Bai do', () => {
  test('Danh sach bai do (khong can dang nhap)', async () => {
    const r = await api().get('/api/lots').expect(200);
    assert.equal(r.body[0].id, LOT);
    assert.equal(r.body[0].freeSlots, 4);
  });
  test('Chi tiet bai do kem danh sach o', async () => {
    const r = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(r.body.slots.length, 4);
    assert.equal(r.body.freeSlots, 4);
    await api().get('/api/lots/khong-co').expect(404);
  });
  test('Admin tao bai moi, user thuong bi chan', async () => {
    const body = { id: 'sp-q1', name: 'Bai Quan 1', totalSlots: 6, pricePerHour: 15000 };
    await api().post('/api/lots').set(auth(userToken)).send(body).expect(403);
    const r = await api().post('/api/lots').set(auth(adminToken)).send(body).expect(201);
    assert.equal(r.body.totalSlots, 6);
    const slots = await api().get('/api/lots/sp-q1/slots').expect(200);
    assert.equal(slots.body.length, 6);
    await api().post('/api/lots').set(auth(adminToken)).send(body).expect(409);
  });
});

describe('Dat cho', () => {
  let resvId;
  test('Dat cho thanh cong -> o chuyen sang reserved', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(userToken))
      .send({ slotNumber: 2, minutes: 15, vehicleId }).expect(201);
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.slotNumber, 2);
    assert.ok(r.body.expiresAt);
    resvId = r.body.id;
    assert.equal(device.state.log.at(-1).action, 'reserve');
    const lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[1].state, 'reserved');
  });
  test('Moi nguoi chi 1 dat cho / o da dat khong dat lai duoc', async () => {
    const a = await api().post(`/api/lots/${LOT}/reservations`).set(auth(userToken)).send({ slotNumber: 3 }).expect(409);
    assert.equal(a.body.error, 'already_has_reservation');
    const b = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 2 }).expect(409);
    assert.equal(b.body.error, 'slot_not_free');
  });
  test('Validate: o ngoai pham vi, phut sai, xe cua nguoi khac, chua dang nhap', async () => {
    await api().post(`/api/lots/${LOT}/reservations`).send({ slotNumber: 1 }).expect(401);
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 9 }).expect(400);
    await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 1, minutes: 500 }).expect(400);
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token))
      .send({ slotNumber: 1, vehicleId }).expect(400);
    assert.equal(r.body.error, 'vehicle_not_found');
  });
  test('Xem danh sach / chi tiet dat cho; nguoi khac khong xem duoc', async () => {
    const list = await api().get('/api/reservations?status=active').set(auth(userToken)).expect(200);
    assert.equal(list.body.length, 1);
    await api().get(`/api/reservations/${resvId}`).set(auth(userToken)).expect(200);
    await api().get(`/api/reservations/${resvId}`).set(auth(user2Token)).expect(404);
  });
  test('Gia han dat cho', async () => {
    const r = await api().post(`/api/reservations/${resvId}/extend`).set(auth(userToken)).send({ minutes: 10 }).expect(200);
    assert.equal(r.body.minutes, 25);
  });
  test('Huy dat cho -> o tro ve free', async () => {
    const r = await api().delete(`/api/reservations/${resvId}`).set(auth(userToken)).expect(200);
    assert.equal(r.body.status, 'cancelled');
    const lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[1].state, 'free');
    await api().delete(`/api/reservations/${resvId}`).set(auth(userToken)).expect(409);
  });
  test('Thiet bi khong phan hoi -> 504, dat cho chuyen failed', async () => {
    device.state.mode = 'timeout';
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 4 }).expect(504);
    assert.equal(r.body.error, 'device_timeout');
    assert.equal(r.body.details.status, 'failed');
    device.state.mode = 'ok';
  });
  test('Thiet bi offline -> 503', async () => {
    await db.query('UPDATE parking_lots SET online = false WHERE id = $1', [LOT]);
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 4 }).expect(503);
    assert.equal(r.body.error, 'device_offline');
    await db.query('UPDATE parking_lots SET online = true WHERE id = $1', [LOT]);
  });
});

describe('Dong bo tu ESP32 (MQTT -> DB)', () => {
  test('status cap nhat trang thai o va barie', async () => {
    await sync.handleStatus(LOT, {
      fw: '1.1.0', gates: { entry: 'open', exit: 'closed' },
      slots: [{ id: 1, state: 'occupied', distance: 20 }, { id: 2, state: 'free', distance: 400 },
        { id: 3, state: 'free', distance: 400 }, { id: 4, state: 'free', distance: 400 }],
    });
    const lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[0].state, 'occupied');
    assert.equal(lot.body.gates.entry, 'open');
    assert.equal(lot.body.fwVersion, '1.1.0');
  });
  test('Xe vao dung o da dat -> reservation fulfilled + mo luot do; xe ra -> tinh phi', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(user2Token)).send({ slotNumber: 3 }).expect(201);
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 3, state: 'occupied', reservationFulfilled: true });
    const resv = await api().get(`/api/reservations/${r.body.id}`).set(auth(user2Token)).expect(200);
    assert.equal(resv.body.status, 'fulfilled');

    // gia lap xe do 61 phut -> phi 2 gio
    await db.query(`UPDATE parking_sessions SET started_at = now() - interval '61 minutes' WHERE ended_at IS NULL
                    AND slot_id = (SELECT id FROM slots WHERE lot_id = $1 AND slot_number = 3)`, [LOT]);
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 3, state: 'free', parkedSeconds: 3660 });
    const sessions = await api().get(`/api/lots/${LOT}/sessions`).set(auth(adminToken)).expect(200);
    const s = sessions.body.find((x) => x.slotNumber === 3);
    assert.ok(s.endedAt);
    assert.equal(s.fee, 20000);
    assert.equal(s.reservationId, r.body.id);
  });
  test('Event slot_changed (khong co khoang cach) -> status ke tiep bo sung khoang cach', async () => {
    const slots = (d3) => [{ id: 1, state: 'occupied', distance: 20 }, { id: 2, state: 'free', distance: 400 },
      { id: 3, ...d3 }, { id: 4, state: 'free', distance: 400 }];
    await sync.handleStatus(LOT, { slots: slots({ state: 'free', distance: 400 }) });
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 3, state: 'occupied' });
    await sync.handleStatus(LOT, { slots: slots({ state: 'occupied', distance: 25 }) });
    let lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[2].state, 'occupied');
    assert.equal(lot.body.slots[2].distanceCm, 25);
    // xe ra: event truoc, status sau -> khoang cach ve 400
    await sync.handleEvent(LOT, { type: 'slot_changed', slot: 3, state: 'free' });
    await sync.handleStatus(LOT, { slots: slots({ state: 'free', distance: 400 }) });
    lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[2].state, 'free');
    assert.equal(lot.body.slots[2].distanceCm, 400);
  });
  test('reservation_expired -> dat cho het han, o tro ve free', async () => {
    const r = await api().post(`/api/lots/${LOT}/reservations`).set(auth(userToken)).send({ slotNumber: 4 }).expect(201);
    await sync.handleEvent(LOT, { type: 'reservation_expired', slot: 4 });
    const resv = await api().get(`/api/reservations/${r.body.id}`).set(auth(userToken)).expect(200);
    assert.equal(resv.body.status, 'expired');
    const lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.slots[3].state, 'free');
  });
  test('online "0" -> bai offline', async () => {
    await sync.handleOnline(LOT, '0');
    const lot = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot.body.online, false);
    // status "retained" cu den sau khi thiet bi da mat ket noi -> van phai offline
    await sync.handleStatus(LOT, { fw: '1.2.0', gates: { entry: 'closed', exit: 'closed' }, slots: [] });
    const lot2 = await api().get(`/api/lots/${LOT}`).expect(200);
    assert.equal(lot2.body.online, false);
    await sync.handleOnline(LOT, '1');
  });
  test('Su kien la ghi vao nhat ky; bai la bi bo qua', async () => {
    await sync.handleEvent('bai-khong-ton-tai', { type: 'gate', gate: 'entry', state: 'open' });
    const ev = await api().get(`/api/lots/${LOT}/events?type=slot_changed`).set(auth(adminToken)).expect(200);
    assert.ok(ev.body.length >= 2);
  });
});

describe('Quan tri', () => {
  test('Mo barie: admin duoc, user bi chan, gate sai -> 400', async () => {
    await api().post(`/api/lots/${LOT}/gates/entry/open`).set(auth(userToken)).expect(403);
    const r = await api().post(`/api/lots/${LOT}/gates/exit/open`).set(auth(adminToken)).expect(200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(device.state.log.at(-1), { action: 'open_gate', gate: 'exit' });
    await api().post(`/api/lots/${LOT}/gates/side/open`).set(auth(adminToken)).expect(400);
  });
  test('Thong ke trong ngay', async () => {
    const r = await api().get(`/api/lots/${LOT}/stats`).set(auth(adminToken)).expect(200);
    // Luot do o 3 bat dau 61 phut truoc -> neu chay test trong khoang 00:00-01:01 (gio VN)
    // thi luot do thuoc ngay hom qua, khong tinh vao thong ke hom nay.
    const vnDate = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const sameDay = vnDate(Date.now() - 61 * 60 * 1000) === vnDate(Date.now());
    // + 1 luot do ngan o 3 (test khoang cach) -> phi toi thieu 1 gio = 10000
    assert.equal(r.body.sessions, sameDay ? 3 : 2);
    assert.equal(r.body.completedSessions, sameDay ? 2 : 1);
    assert.equal(r.body.revenue, sameDay ? 30000 : 10000);
    assert.equal(r.body.reservations.fulfilled, 1);
    assert.equal(r.body.reservations.expired, 1);
    assert.equal(r.body.occupancyRate, 25);
    await api().get(`/api/lots/${LOT}/stats?date=19-11-2026`).set(auth(adminToken)).expect(400);
  });
});
