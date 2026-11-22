// KIEM THU DON VI: tinh phi, trang thai phien, du lieu phien tra ve app, chi tiet phi tren bien nhan (khong can DB)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sessionFee, phaseOf, sessionView } = require('../../src/sessions');
const { estimateFee, RULES } = require('../../src/booking');
const { breakdownOf } = require('../../src/payments');

const T0 = new Date('2026-11-22T01:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);
const PRICE = 10000;

describe('sessionFee - bang tinh phi', () => {
  // [mo ta, phut gui, phut du kien | null, da do?, tong, gio, phu phi]
  const cases = [
    ['0 phut (da do) -> toi thieu 1 gio', 0, null, true, 10000, 1, 0],
    ['59 phut -> 1 gio', 59, null, true, 10000, 1, 0],
    ['60 phut dung -> 1 gio', 60, null, true, 10000, 1, 0],
    ['61 phut -> 2 gio (lam tron len)', 61, null, true, 20000, 2, 0],
    ['24 gio', 1440, null, true, 240000, 24, 0],
    ['qua du kien 4 phut (trong an han 5 phut) -> khong phu phi', 64, 60, true, 20000, 2, 0],
    ['qua du kien 6 phut -> phu phi 1 gio x 50%', 66, 60, true, 25000, 2, 5000],
    ['qua du kien 2 gio 10 phut -> phu phi 3 gio', 190, 60, true, 40000 + 15000, 4, 15000],
    ['chua do, roi bai sau 15 phut -> mien phi', 15, null, false, 0, 0, 0],
    ['chua do, sau 16 phut -> tinh 1 gio', 16, null, false, 10000, 1, 0],
  ];
  for (const [name, min, planned, parked, total, hours, ot] of cases) {
    test(name, () => {
      const f = sessionFee({ startedAt: T0, endAt: at(min), pricePerHour: PRICE, plannedEndAt: planned == null ? null : at(planned), parked });
      assert.equal(f.total, total);
      assert.equal(f.hours, hours);
      assert.equal(f.overtime, ot);
      assert.ok(f.nextChangeAt instanceof Date);
    });
  }

  test('Moc doi phi tiep theo: dau gio ke tiep, hoac luc bat dau tinh phu phi neu som hon', () => {
    assert.equal(sessionFee({ startedAt: T0, endAt: at(10), pricePerHour: PRICE }).nextChangeAt.getTime(), at(60).getTime());
    const f = sessionFee({ startedAt: T0, endAt: at(10), pricePerHour: PRICE, plannedEndAt: at(30) });
    assert.equal(f.nextChangeAt.getTime(), at(30 + RULES.session.overtimeGraceMinutes).getTime());
  });

  test('Gia 0 / thieu gia -> phi 0, khong loi; gio dong ho lui (end < start) -> khong am', () => {
    assert.equal(sessionFee({ startedAt: T0, endAt: at(90), pricePerHour: 0 }).total, 0);
    assert.equal(sessionFee({ startedAt: T0, endAt: at(90), pricePerHour: null }).total, 0);
    const f = sessionFee({ startedAt: T0, endAt: at(-30), pricePerHour: PRICE });
    assert.equal(f.total, PRICE);
    assert.ok(f.total >= 0);
  });

  test('Phi khong giam theo thoi gian (don dieu)', () => {
    let prev = 0;
    for (let m = 0; m <= 600; m += 7) {
      const t = sessionFee({ startedAt: T0, endAt: at(m), pricePerHour: PRICE, plannedEndAt: at(120) }).total;
      assert.ok(t >= prev, `phi giam tai phut ${m}`);
      prev = t;
    }
  });

  test('estimateFee (phi du kien khi dat cho) khop sessionFee khi lay xe dung gio', () => {
    for (const m of [30, 60, 61, 120, 179, 480]) {
      assert.equal(estimateFee(PRICE, m), sessionFee({ startedAt: T0, endAt: at(m), pricePerHour: PRICE }).total);
    }
  });
});

describe('phaseOf + sessionView', () => {
  const base = {
    id: 1, source: 'gate', started_at: T0, parked_at: at(2), ended_at: null, exited_at: null, planned_end_at: at(60),
    price_per_hour: PRICE, extend_count: 0, flags: [], slot_number: 3, zone: 'B', lot_id: 'L', lot_name: 'Bai', online: true,
  };
  test('Vong doi entered -> parked -> left -> completed; phien sensor ket thuc khi roi o', () => {
    assert.equal(phaseOf({ ...base, parked_at: null }), 'entered');
    assert.equal(phaseOf(base), 'parked');
    assert.equal(phaseOf({ ...base, ended_at: at(50) }), 'left');
    assert.equal(phaseOf({ ...base, ended_at: at(50), exited_at: at(55) }), 'completed');
    assert.equal(phaseOf({ ...base, source: 'sensor', ended_at: at(50) }), 'completed');
  });

  test('Dang gui: phi tam tinh, chua thanh toan duoc, gia han duoc', () => {
    const v = sessionView(base, at(30).getTime());
    assert.equal(v.phase, 'parked');
    assert.equal(v.cost.final, false);
    assert.equal(v.cost.total, 10000);
    assert.equal(v.estimatedFee, 10000);
    assert.equal(v.fee, null);
    assert.equal(v.canPay, false);
    assert.equal(v.canExtend, true);
    assert.equal(v.elapsedSeconds, 1800);
    assert.equal(v.plannedMinutes, 60);
  });

  test('Da roi o, chua tra: phi chot, phai tra; da tra: amountDue 0', () => {
    const left = { ...base, ended_at: at(70), fee: 25000, overtime_fee: 5000, duration_seconds: 4200 };
    let v = sessionView(left, at(80).getTime());
    assert.deepEqual([v.phase, v.cost.final, v.cost.total, v.cost.base, v.cost.overtime, v.canPay, v.amountDue],
      ['left', true, 25000, 20000, 5000, true, 25000]);
    v = sessionView({ ...left, payment_id: 9, payment_amount: 25000, payment_method: 'momo' }, at(80).getTime());
    assert.deepEqual([v.paid, v.amountDue, v.canPay, v.status], [true, 0, false, 'paid']);
  });

  test('Qua gio du kien -> overtime true; het luot gia han -> canExtend false', () => {
    assert.equal(sessionView(base, at(70).getTime()).overtime, true);
    assert.equal(sessionView({ ...base, extend_count: RULES.session.extend.maxTimes }, at(10).getTime()).canExtend, false);
  });
});

describe('breakdownOf (chi tiet phi tren bien nhan)', () => {
  test('Co phu phi -> 2 dong; mien phi -> 1 dong 0d', () => {
    const b = breakdownOf({ fee: 25000, overtime_fee: 5000, duration_seconds: 4200, price_per_hour: PRICE });
    assert.equal(b.lines.length, 2);
    assert.equal(b.hours, 2);
    assert.equal(b.base + b.overtime, b.total);
    assert.equal(b.lines.reduce((a, l) => a + l.amount, 0), 25000);
    const free = breakdownOf({ fee: 0, duration_seconds: 300, price_per_hour: PRICE });
    assert.deepEqual(free.lines.map((l) => l.amount), [0]);
    assert.equal(free.hours, 0);
  });
});
