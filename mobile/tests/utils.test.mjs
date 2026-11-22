// KIEM THU DON VI APP - ham tien ich hien thi: khoang ngay loc lich su, dinh dang thoi gian / tien, phi du kien
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presetRange, addDays, toYmd, fromYmd, ymdLabel, dayHeading, formatSeconds } from '../src/utils/dates.js';
import { formatCountdown, estimateFee, secondsLeft } from '../src/utils/booking.js';
import { formatElapsed, timeAgo } from '../src/utils/session.js';
import { formatVND } from '../src/utils/schedules.js';

describe('Khoang ngay loc lich su', () => {
  test('Hom nay / 7 ngay / 30 ngay', () => {
    assert.deepEqual(presetRange('today', '2026-11-22'), { from: '2026-11-22', to: '2026-11-22' });
    assert.deepEqual(presetRange('7d', '2026-11-22'), { from: '2026-11-16', to: '2026-11-22' });
    assert.deepEqual(presetRange('30d', '2026-11-22'), { from: '2026-10-24', to: '2026-11-22' });
  });
  test('Thang nay / thang truoc (ke ca qua nam, thang 2 nam nhuan)', () => {
    assert.deepEqual(presetRange('month', '2026-11-22'), { from: '2026-11-01', to: '2026-11-22' });
    assert.deepEqual(presetRange('lastMonth', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
    assert.deepEqual(presetRange('lastMonth', '2028-03-05'), { from: '2028-02-01', to: '2028-02-29' });
    assert.equal(presetRange('khong-co'), null);
  });
  test('Cong / tru ngay, doi qua lai Date, nhan hien thi', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(toYmd(fromYmd('2026-02-28')), '2026-02-28');
    assert.equal(ymdLabel('2026-11-05'), '05/11/2026');
    assert.equal(ymdLabel('2026-11-05', true), '05/11');
  });
  test('Tieu de nhom theo ngay', () => {
    const today = toYmd();
    assert.equal(dayHeading(new Date().toISOString(), today), 'Hôm nay');
    assert.equal(dayHeading(fromYmd(addDays(today, -1)).toISOString(), today), 'Hôm qua');
    assert.match(dayHeading(fromYmd('2026-11-19').toISOString(), '2026-11-22'), /^Thứ 5, 19\/11\/2026$/);
  });
});

describe('Dinh dang thoi gian, tien', () => {
  test('Thoi luong gui xe', () => {
    assert.equal(formatSeconds(0), '0 phút');
    assert.equal(formatSeconds(45 * 60), '45 phút');
    assert.equal(formatSeconds(3600), '1 giờ');
    assert.equal(formatSeconds(5400), '1 giờ 30 phút');
    assert.equal(formatSeconds(null), '0 phút');
  });
  test('Dong ho dem / dong ho chay, khong am', () => {
    assert.equal(formatCountdown(125), '02:05');
    assert.equal(formatCountdown(3725), '1:02:05');
    assert.equal(formatElapsed(-5), '00:00');
    assert.equal(formatElapsed(3725), '1:02:05');
    assert.equal(secondsLeft(new Date(Date.now() - 5000).toISOString()), 0);
  });
  test('Thoi gian tuong doi', () => {
    const now = Date.parse('2026-11-22T10:00:00Z');
    assert.equal(timeAgo('2026-11-22T09:59:30Z', now), 'vừa xong');
    assert.equal(timeAgo('2026-11-22T09:15:00Z', now), '45 phút trước');
    assert.equal(timeAgo('2026-11-22T05:00:00Z', now), '5 giờ trước');
  });
  test('Tien VND va phi du kien (giong may chu)', () => {
    assert.match(formatVND(20000), /^20[.,]000đ$/);
    assert.equal(formatVND(null), '—');
    assert.deepEqual([30, 60, 61, 120, 179].map((m) => estimateFee(10000, m)), [10000, 10000, 20000, 20000, 30000]);
    assert.equal(estimateFee(null, 60), null);
  });
});
