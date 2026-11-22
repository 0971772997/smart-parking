// KIEM THU DON VI APP - lop goi API: mat mang, het thoi gian, may chu dang khoi dong (Render ngu),
// anh xa ma loi -> thong bao tieng Viet, token, tai khoan bi khoa giua chung.
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { request, setAuthToken, setAccountLockedHandler, ApiError, API_URL } from '../src/api/client.js';

const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
let calls;
beforeEach(() => {
  calls = [];
  setAuthToken(null);
  setAccountLockedHandler(null);
});
const useFetch = (impl) => { globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return impl(url, opts); }; };

describe('Goi API thanh cong', () => {
  test('Tra JSON; gui token + body JSON dung dang', async () => {
    useFetch(() => json(200, { ok: 1 }));
    setAuthToken('abc');
    assert.deepEqual(await request('/x', { method: 'POST', body: { a: 1 } }), { ok: 1 });
    assert.equal(calls[0].url, `${API_URL}/x`);
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer abc');
    assert.equal(calls[0].opts.body, '{"a":1}');
  });
  test('Chua dang nhap -> khong gui header Authorization', async () => {
    useFetch(() => json(200, {}));
    await request('/x');
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  });
  test('Ban production tro toi API Render (khong lot dia chi localhost)', () => {
    assert.match(API_URL, /^https:\/\/.*onrender\.com\/api$/);
  });
});

describe('Gian doan mang', () => {
  test('Mat mang (fetch nem loi) -> network_error, thong bao kiem tra Internet', async () => {
    useFetch(() => { throw new TypeError('Network request failed'); });
    await assert.rejects(request('/x'), (e) => e instanceof ApiError && e.code === 'network_error' && e.status === 0 && /Internet/.test(e.message));
  });
  test('May chu khong tra loi trong timeoutMs -> huy request, bao timeout', async () => {
    useFetch((_u, opts) => new Promise((_ok, fail) => opts.signal.addEventListener('abort', () => fail(Object.assign(new Error('a'), { name: 'AbortError' })))));
    const t0 = Date.now();
    await assert.rejects(request('/x', { timeoutMs: 60 }), (e) => e.code === 'timeout');
    assert.ok(Date.now() - t0 < 1000);
  });
  test('Request > 4 giay -> goi onSlow (hien "may chu dang khoi dong"), xong thi khong goi lai', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let release;
      useFetch(() => new Promise((ok) => { release = () => ok(json(200, { done: true })); }));
      let slow = 0;
      const p = request('/x', { onSlow: () => { slow += 1; } });
      mock.timers.tick(3999);
      assert.equal(slow, 0);
      mock.timers.tick(1);
      assert.equal(slow, 1);
      release();
      assert.deepEqual(await p, { done: true });
      mock.timers.tick(10000);
      assert.equal(slow, 1);
    } finally { mock.timers.reset(); }
  });
  test('Render dang khoi dong / proxy loi: 502-504 tra trang HTML -> service_unavailable (khong vo JSON)', async () => {
    for (const status of [502, 503, 504]) {
      useFetch(() => ({ ok: false, status, text: async () => '<html>Bad Gateway</html>' }));
      await assert.rejects(request('/x'), (e) => e.code === 'service_unavailable' && /khởi động|gián đoạn/.test(e.message));
    }
    useFetch(() => ({ ok: false, status: 500, text: async () => '' }));
    await assert.rejects(request('/x'), (e) => e.code === 'internal_error');
  });
  test('API 503 service_unavailable (CSDL gian doan) -> thong bao thu lai', async () => {
    useFetch(() => json(503, { error: 'service_unavailable', message: 'May chu tam thoi gian doan' }));
    await assert.rejects(request('/x'), (e) => e.status === 503 && /thử lại/.test(e.message));
  });
});

describe('Anh xa loi -> thong bao tieng Viet', () => {
  test('Ma da biet -> cau tieng Viet; ma la -> dung thong diep may chu', async () => {
    useFetch(() => json(409, { error: 'slot_not_free', message: 'x' }));
    await assert.rejects(request('/x'), (e) => e.message === 'Ô đỗ vừa có người đặt. Vui lòng thử lại.');
    useFetch(() => json(418, { error: 'ma_moi_chua_dich', message: 'Thong diep may chu' }));
    await assert.rejects(request('/x'), (e) => e.message === 'Thong diep may chu' && e.code === 'ma_moi_chua_dich');
  });
  test('Chi tiet dong: OTP con N lan thu, dang nhap sai qua nhieu lan -> so phut cho', async () => {
    useFetch(() => json(400, { error: 'otp_wrong', details: { attemptsLeft: 2 } }));
    await assert.rejects(request('/x'), (e) => /còn 2 lần/.test(e.message));
    useFetch(() => json(429, { error: 'too_many_attempts', details: { retryAfter: 840 } }));
    await assert.rejects(request('/x'), (e) => /14 phút/.test(e.message));
  });
  test('Moi ma loi API tra ve deu co thong bao tieng Viet rieng (khong lo tieng Anh / khong dau)', async () => {
    const codes = ['invalid_token', 'account_locked', 'forbidden', 'too_many_attempts', 'device_offline', 'device_timeout', 'payment_required',
      'gateway_unavailable', 'review_not_eligible', 'ticket_closed', 'lot_booking_disabled', 'slots_in_use', 'service_unavailable', 'payload_too_large'];
    for (const code of codes) {
      useFetch(() => json(400, { error: code, message: 'NO_VN' }));
      await assert.rejects(request('/x'), (e) => e.message !== 'NO_VN', code);
    }
  });
});

describe('Tai khoan bi khoa giua chung', () => {
  test('Dang dung app (co token) -> goi handler dang xuat kem ly do', async () => {
    const got = [];
    setAccountLockedHandler((m) => got.push(m));
    setAuthToken('t');
    useFetch(() => json(403, { error: 'account_locked', details: { reason: 'Spam' } }));
    await assert.rejects(request('/x'), (e) => e.code === 'account_locked');
    assert.equal(got.length, 1);
    assert.match(got[0], /Spam/);
  });
  test('O man dang nhap (chua co token) -> chi bao loi, khong goi handler', async () => {
    const got = [];
    setAccountLockedHandler((m) => got.push(m));
    useFetch(() => json(403, { error: 'account_locked' }));
    await assert.rejects(request('/x'));
    assert.equal(got.length, 0);
  });
});
