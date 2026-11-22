// Ham tinh gia moi khi admin tang / giam gia (khong can DB)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { adjustPrice, parseAdjustment, MAX_PRICE } = require('../../src/pricing');

describe('adjustPrice', () => {
  test('Theo %: lam tron toi 1.000d', () => {
    assert.equal(adjustPrice(10000, 'percent', 10), 11000);
    assert.equal(adjustPrice(10000, 'percent', 15), 12000); // 11.500 -> 12.000
    assert.equal(adjustPrice(10000, 'percent', -15), 9000); // 8.500 -> 9.000
    assert.equal(adjustPrice(5000, 'percent', -50), 3000);  // 2.500 -> 3.000
    assert.equal(adjustPrice(10000, 'percent', -90), 1000);
    assert.equal(adjustPrice(0, 'percent', 500), 0);
  });
  test('Theo so tien + dat gia: khong am, khong vuot tran', () => {
    assert.equal(adjustPrice(10000, 'amount', 2000), 12000);
    assert.equal(adjustPrice(10000, 'amount', -2500), 8000); // 7.500 -> 8.000
    assert.equal(adjustPrice(3000, 'amount', -5000), 0);
    assert.equal(adjustPrice(MAX_PRICE - 1000, 'amount', 5000), MAX_PRICE);
    assert.equal(adjustPrice(10000, 'set', 15400), 15000);
    assert.equal(adjustPrice(10000, 'set', 0), 0);
  });
  test('parseAdjustment kiem tra mode / value', () => {
    assert.deepEqual(parseAdjustment({ mode: 'percent', value: -20 }), { mode: 'percent', value: -20 });
    assert.deepEqual(parseAdjustment({ mode: 'set', value: 0 }), { mode: 'set', value: 0 });
    for (const b of [null, {}, { mode: 'x', value: 1 }, { mode: 'percent', value: 0 }, { mode: 'amount', value: '1' },
      { mode: 'percent', value: -91 }, { mode: 'percent', value: 2.5 }, { mode: 'set', value: MAX_PRICE + 1 }]) {
      assert.throws(() => parseAdjustment(b), (e) => e.status === 400 && e.code === 'validation_error', JSON.stringify(b));
    }
  });
});
