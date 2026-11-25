// KIEM THU DON VI APP - nhan dien ma QR cong, thong bao loi cho tai xe, loai xe / bien so
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyQr, driverError, gateLabel } from '../src/utils/gate.js';
import { normalizePlate, plateError, vehicleType, vehicleTitle, VEHICLE_TYPES } from '../src/utils/vehicles.js';

describe('Ma QR cua cong', () => {
  test('Nhan dien ma cong vao / ra, ma dat cho, ma la', () => {
    assert.deepEqual(classifyQr('SPG1.c3AtZGVtby0wMQ.G.mhx1k2.abcdefgh.0123456789abcdef'), { kind: 'gate', gate: null });
    assert.deepEqual(classifyQr('SPG1.c3AtZGVtby0wMQ.E.mhx1k2.abcdefgh.0123456789abcdef'), { kind: 'gate', gate: 'entry' });
    assert.deepEqual(classifyQr(' SPG1.c3A.X.mhx1k2.abcdefgh.0123456789abcdef '), { kind: 'gate', gate: 'exit' });
    assert.deepEqual(classifyQr('SP1.1.E.mhx1k2.abcdefgh.0123456789abcdef'), { kind: 'reservation' });
    assert.deepEqual(classifyQr('SPG1.c3A.Z.1.2.3'), { kind: 'other' });
    assert.deepEqual(classifyQr('https://vi-du.com'), { kind: 'other' });
    assert.deepEqual(classifyQr(null), { kind: 'other' });
  });
  test('Thong bao loi cho tai xe', () => {
    assert.equal(driverError('no_reservation').title, 'Bạn chưa đặt chỗ ở bãi này');
    assert.equal(driverError('payment_required').title, 'Chưa thanh toán phí');
    assert.deepEqual(driverError('la_hoac', 'Loi X'), { title: 'Không mở được barie', help: 'Loi X' });
    assert.equal(gateLabel('exit'), 'cổng RA');
    assert.equal(gateLabel('entry'), 'cổng VÀO');
  });
});

describe('Xe: loai xe, bien so', () => {
  test('Loai xe + nhan hien thi', () => {
    assert.equal(VEHICLE_TYPES.length, 5);
    assert.equal(vehicleType('motorbike').label, 'Xe máy');
    assert.equal(vehicleType(undefined).key, 'car');
    assert.equal(vehicleTitle({ vehicleType: 'electric', brand: 'VinFast Evo' }), 'Xe điện • VinFast Evo');
    assert.equal(vehicleTitle({ vehicleType: 'car' }), 'Ô tô');
  });
  test('Chuan hoa + kiem tra bien so (giong may chu)', () => {
    assert.equal(normalizePlate(' 59x1  234.56 '), '59X1 234.56');
    assert.equal(plateError('43A-123.45'), '');
    assert.equal(plateError('59x1 234.56'), '');
    assert.equal(plateError(''), 'Vui lòng nhập biển số xe');
    assert.match(plateError('12'), /4–20/);
    assert.match(plateError('<script>'), /chữ, số/);
    assert.match(plateError('ABCD-EF'), /chữ, số/);
  });
});
