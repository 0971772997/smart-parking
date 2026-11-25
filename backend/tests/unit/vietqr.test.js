// Ma VietQR chuyen khoan (EMVCo): CRC, cau truc, noi dung khong dau
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVietQR, crc16, cleanContent } = require('../../src/vietqr');

test('CRC16-CCITT-FALSE dung vector chuan', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('VietQR MB Bank 0971772997, 10.000d, noi dung ma don', () => {
  const q = buildVietQR({ bin: '970422', accountNo: '0971772997', amount: 10000, content: 'SP12AB34' });
  assert.equal(q, '00020101021238540010A00000072701240006970422011009717729970208QRIBFTTA53037045405100005802VN62120808SP12AB346304' + crc16(q.slice(0, -4)));
  assert.ok(q.startsWith('000201010212'));
});

test('Khong co so tien -> ma tinh (11); noi dung bo dau / ky tu dac biet', () => {
  const q = buildVietQR({ bin: '970422', accountNo: '0971772997' });
  assert.ok(q.startsWith('000201010211'));
  assert.ok(!q.includes('5405'));
  assert.equal(cleanContent('Phí gửi xe #12 – Đà Nẵng'), 'Phi gui xe 12  Da Nang');
});

test('Deeplink app ngan hang: app tu dien co STK@mb, so tien, noi dung; app khong ho tro chi mo app', () => {
  const { bankDeeplinks } = require('../../src/vietqr');
  const apps = bankDeeplinks({
    payee: { accountNo: '0971772997', bankCode: 'mb', accountName: 'VO VIET MINH' },
    amount: 15000, content: 'SP12AB34', returnUrl: 'https://api.vd/api/payments/transfer-return',
  });
  const mb = apps.find((a) => a.appId === 'mb');
  assert.equal(mb.autofill, true);
  const u = new URL(mb.url);
  assert.equal(u.origin + u.pathname, 'https://dl.vietqr.io/pay');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    app: 'mb', ba: '0971772997@mb', am: '15000', tn: 'SP12AB34', bn: 'VO VIET MINH', url: 'https://api.vd/api/payments/transfer-return',
  });
  const vcb = apps.find((a) => a.appId === 'vcb');
  assert.equal(vcb.autofill, false);
  assert.equal(vcb.url, 'https://dl.vietqr.io/pay?app=vcb');
});
