// KIEM THU DON VI: kiem tra du lieu dau vao, ngay thang (gio VN), so dien thoai, ma sinh ra, an thong tin nhay cam
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../src/validate');
const { parseDate, parseRange, addDays, inRange, vnToday } = require('../../src/dates');
const { normalizePhone } = require('../../src/routes/auth');
const { displayName, ticketCode } = require('../../src/feedback');
const { newCode } = require('../../src/booking');
const map = require('../../src/mappers');

const throws400 = (fn) => assert.throws(fn, (e) => e.status === 400);

describe('validate.str / int / email', () => {
  test('Chuoi: cat khoang trang, gioi han do dai, bat buoc / tuy chon, mau', () => {
    assert.equal(v.str({ a: '  xin chao ' }, 'a'), 'xin chao');
    assert.equal(v.str({}, 'a', { optional: true }), null);
    throws400(() => v.str({}, 'a'));
    throws400(() => v.str({ a: 'x'.repeat(256) }, 'a'));
    throws400(() => v.str({ a: 'ab' }, 'a', { min: 3 }));
    throws400(() => v.str({ a: 'abc' }, 'a', { pattern: /^\d+$/ }));
  });
  test('Chong nham kieu (mang / doi tuong / so thay cho chuoi) -> 400 thay vi loi 500', () => {
    for (const bad of [['x'], { $ne: 1 }, 123, true]) throws400(() => v.str({ a: bad }, 'a'));
    for (const bad of ['1.5', 'abc', '1e3x', [1], { a: 1 }, '9007199254740993']) throws400(() => v.int({ n: bad }, 'n'));
  });
  test('So nguyen: chuoi so hop le, khoang min..max, mac dinh', () => {
    assert.equal(v.int({ n: '42' }, 'n'), 42);
    assert.equal(v.int({}, 'n', { def: 5 }), 5);
    throws400(() => v.int({ n: 0 }, 'n', { min: 1 }));
    throws400(() => v.int({ n: 101 }, 'n', { max: 100 }));
  });
  test('Email: chuan hoa chu thuong; sai dinh dang -> 400', () => {
    assert.equal(v.email({ email: ' An@Test.VN ' }), 'an@test.vn');
    for (const bad of ['a', 'a@', '@b.c', 'a b@c.d', 'a@b']) throws400(() => v.email({ email: bad }));
  });
});

describe('Ngay thang (gio Viet Nam)', () => {
  test('parseDate: dung dinh dang + ngay co that', () => {
    assert.equal(parseDate({ d: '2026-02-28' }, 'd'), '2026-02-28');
    assert.equal(parseDate({}, 'd', 'X'), 'X');
    for (const bad of ['2026-02-30', '2026-13-01', '26-1-1', '2026/01/01', "2026-01-01' OR 1=1", '2026-01-01T00:00']) {
      throws400(() => parseDate({ d: bad }, 'd'));
    }
  });
  test('parseRange: mac dinh N ngay gan nhat, nguoc -> 400, qua dai -> 400', () => {
    const r = parseRange({}, { days: 7 });
    assert.equal(r.to, vnToday());
    assert.equal(r.from, addDays(r.to, -6));
    throws400(() => parseRange({ from: '2026-05-02', to: '2026-05-01' }));
    throws400(() => parseRange({ from: '2024-01-01', to: '2026-01-01' }));
    assert.deepEqual(parseRange({ from: '2026-05-01', to: '2026-05-01' }), { from: '2026-05-01', to: '2026-05-01' });
  });
  test('addDays qua thang / nam nhuan; inRange dung tham so (khong noi chuoi gia tri)', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    const sql = inRange('x.t', 2, 3);
    assert.match(sql, /\$2::date/);
    assert.match(sql, /\$3::date \+ 1/);
    assert.match(sql, /Asia\/Ho_Chi_Minh/);
  });
  test('vnToday doi ngay luc 17:00 UTC (00:00 gio VN)', () => {
    const real = Date.now;
    try {
      Date.now = () => Date.parse('2026-11-21T16:59:00Z');
      assert.equal(vnToday(), '2026-11-21');
      Date.now = () => Date.parse('2026-11-21T17:00:00Z');
      assert.equal(vnToday(), '2026-11-22');
    } finally { Date.now = real; }
  });
});

describe('So dien thoai, ma sinh ra, ten hien thi', () => {
  test('Chuan hoa SDT Viet Nam', () => {
    assert.equal(normalizePhone('0901 234 567'), '0901234567');
    assert.equal(normalizePhone('+84901234567'), '0901234567');
    assert.equal(normalizePhone('84901234567'), '0901234567');
    assert.equal(normalizePhone('090-123-4567'), '0901234567');
    assert.equal(normalizePhone('12345'), undefined);
    assert.equal(normalizePhone(''), null);
  });
  test('Ma dat cho / ma yeu cau: dung mau, khong ky tu de nham (0 O 1 I)', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(newCode(), /^DC-[A-HJ-NP-Z2-9]{6}$/);
      assert.match(ticketCode('incident'), /^SC-[A-HJ-NP-Z2-9]{6}$/);
    }
    assert.match(ticketCode('support'), /^HT-/);
  });
  test('Ten hien thi cong khai khong lo email day du', () => {
    assert.equal(displayName({ full_name: 'Nguyen Van An' }), 'Nguyen A.');
    assert.equal(displayName({ full_name: 'An' }), 'An');
    assert.equal(displayName({ username: 'demo_user' }), 'demo***');
    const n = displayName({ email: 'bimat.rieng@gmail.com' });
    assert.ok(!n.includes('@') && !n.includes('rieng'), n);
  });
});

describe('Mappers khong tra du lieu nhay cam', () => {
  test('user: khong co password_hash, google_id, facebook_id, otp', () => {
    const u = map.user({ id: 1, email: 'a@b.c', password_hash: '$2a$10$abc', google_id: 'g', facebook_id: 'f', role: 'user' });
    const json = JSON.stringify(u);
    assert.ok(!/\$2a\$|password|google_id|facebook_id/.test(json), json);
    assert.deepEqual(u.linked, { google: true, facebook: true });
  });
  test('lot: diem danh gia lam tron 1 chu so', () => {
    assert.deepEqual(map.lot({ id: 'L', rating_avg: '4.333', rating_count: '3' }).rating, { average: 4.3, count: 3 });
  });
});
