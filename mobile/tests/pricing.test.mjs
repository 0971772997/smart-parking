// Man hinh dieu chinh gia: lua chon tren giao dien -> yeu cau API, xem truoc giong may chu
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdjustment, adjustPrice, previewChanges, describeAdjustment } from '../src/utils/pricing.js';

describe('buildAdjustment', () => {
  test('Tang / giam theo % va theo so tien', () => {
    assert.deepEqual(buildAdjustment({ direction: 'up', unit: 'percent', amount: '10' }), { mode: 'percent', value: 10 });
    assert.deepEqual(buildAdjustment({ direction: 'down', unit: 'percent', amount: '20' }), { mode: 'percent', value: -20 });
    assert.deepEqual(buildAdjustment({ direction: 'down', unit: 'amount', amount: '2.000' }), { mode: 'amount', value: -2000 });
    assert.deepEqual(buildAdjustment({ direction: 'set', unit: 'percent', amount: '15000' }), { mode: 'set', value: 15000 });
  });
  test('Chua nhap -> null; gia tri sai -> loi tieng Viet', () => {
    assert.equal(buildAdjustment({ direction: 'up', unit: 'percent', amount: '' }), null);
    assert.match(buildAdjustment({ direction: 'up', unit: 'amount', amount: '0' }).error, /lớn hơn 0/);
    assert.match(buildAdjustment({ direction: 'down', unit: 'percent', amount: '95' }).error, /90%/);
    assert.match(buildAdjustment({ direction: 'up', unit: 'percent', amount: '600' }).error, /500%/);
    assert.match(buildAdjustment({ direction: 'set', unit: 'amount', amount: '20000000' }).error, /10\.000\.000/);
  });
});

describe('Xem truoc gia moi', () => {
  const lots = [{ id: 'a', name: 'A', pricePerHour: 10000 }, { id: 'b', name: 'B', pricePerHour: 5000 }, { id: 'c', name: 'C', pricePerHour: 0 }];
  test('Lam tron 1.000d, bo bai khong doi gia', () => {
    const ch = previewChanges(lots, { mode: 'percent', value: 15 });
    assert.deepEqual(ch.map((c) => [c.lotId, c.newPrice, c.diff]), [['a', 12000, 2000], ['b', 6000, 1000]]);
    assert.equal(adjustPrice(3000, { mode: 'amount', value: -5000 }), 0);
    assert.deepEqual(previewChanges(lots, { error: 'x' }), []);
    assert.deepEqual(previewChanges(lots, null), []);
  });
  test('Mo ta ngan cho hop xac nhan', () => {
    assert.equal(describeAdjustment({ mode: 'percent', value: 10 }), 'Tăng 10%');
    assert.match(describeAdjustment({ mode: 'amount', value: -2000 }), /^Giảm 2\.000đ\/giờ$/);
    assert.match(describeAdjustment({ mode: 'set', value: 15000 }), /^Đặt giá 15\.000đ\/giờ$/);
  });
});
