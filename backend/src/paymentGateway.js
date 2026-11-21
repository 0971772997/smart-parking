// CONG THANH TOAN MoMo (API v2) - mac dinh MOI TRUONG THU NGHIEM (test-payment.momo.vn)
//   Khoa test cong khai trong tai lieu MoMo (partnerCode MOMO). Doi sang khoa that bang bien moi truong
//   MOMO_PARTNER_CODE / MOMO_ACCESS_KEY / MOMO_SECRET_KEY / MOMO_ENDPOINT.
//
// Luong: create() -> payUrl (trang thanh toan MoMo) -> tai xe thanh toan
//   -> MoMo goi IPN (POST ipnUrl, co chu ky) + chuyen trinh duyet ve redirectUrl
//   -> du phong: query() hoi trang thai (khi IPN khong toi duoc, vd chay tren may ca nhan)
// Chu ky: HMAC-SHA256 (hex) cua chuoi "key=value&..." theo thu tu chu cai, khoa = secretKey.
const crypto = require('crypto');

const SANDBOX = {
  endpoint: 'https://test-payment.momo.vn',
  partnerCode: 'MOMO',
  accessKey: 'F8BBA842ECF85',
  secretKey: 'K951B6PE1waDMi640xX08PD3vg6EkVlz',
};

// Phuong thuc trong app -> loai yeu cau cua MoMo
const REQUEST_TYPE = { momo: 'captureWallet', atm: 'payWithATM', card: 'payWithCC' };

// resultCode cua MoMo: 0 = thanh cong; cac ma dang xu ly; con lai = that bai
const PENDING_CODES = new Set([1000, 7000, 7002, 9000]);
const RESULT_VI = {
  0: 'Thanh toán thành công',
  1000: 'Đang chờ người dùng xác nhận thanh toán',
  1001: 'Tài khoản không đủ tiền',
  1002: 'Giao dịch bị từ chối bởi nhà phát hành',
  1003: 'Giao dịch đã bị huỷ',
  1004: 'Số tiền vượt hạn mức thanh toán',
  1005: 'Mã thanh toán đã hết hạn',
  1006: 'Người dùng đã từ chối thanh toán',
  1007: 'Tài khoản người dùng đang bị tạm khoá',
  1017: 'Giao dịch bị huỷ bởi đối tác',
  1026: 'Giao dịch bị hạn chế theo thể lệ khuyến mãi',
  1080: 'Giao dịch hoàn tiền thất bại',
  4001: 'Tài khoản bị giới hạn giao dịch',
  4100: 'Người dùng chưa đăng nhập thành công',
  7000: 'Giao dịch đang được xử lý',
  7002: 'Giao dịch đang được xử lý bởi nhà cung cấp',
  9000: 'Giao dịch đã được xác nhận',
};

const outcome = (code) => (code === 0 ? 'paid' : PENDING_CODES.has(code) ? 'pending' : 'failed');
const describe = (code, fallback) => RESULT_VI[code] || fallback || `Lỗi cổng thanh toán (mã ${code})`;

function createMomoGateway({ endpoint, partnerCode, accessKey, secretKey, fetchFn = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const cfg = {
    endpoint: endpoint || SANDBOX.endpoint,
    partnerCode: partnerCode || SANDBOX.partnerCode,
    accessKey: accessKey || SANDBOX.accessKey,
    secretKey: secretKey || SANDBOX.secretKey,
  };
  const sandbox = /test-payment\.momo\.vn/.test(cfg.endpoint);
  const sign = (fields) => crypto.createHmac('sha256', cfg.secretKey)
    .update(Object.keys(fields).sort().map((k) => `${k}=${fields[k] ?? ''}`).join('&')).digest('hex');

  async function post(path, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchFn(cfg.endpoint + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // -> { ok, resultCode, message, payUrl, deeplink, qrCodeUrl }
  async function create({ orderId, requestId, amount, orderInfo, redirectUrl, ipnUrl, method = 'momo', extraData = '' }) {
    const requestType = REQUEST_TYPE[method];
    if (!requestType) throw new Error(`Phuong thuc khong ho tro: ${method}`);
    const f = { accessKey: cfg.accessKey, amount: String(amount), extraData, ipnUrl, orderId, orderInfo,
      partnerCode: cfg.partnerCode, redirectUrl, requestId, requestType };
    const j = await post('/v2/gateway/api/create', {
      partnerCode: cfg.partnerCode, partnerName: 'SmartPark', storeId: 'SmartPark', requestId, amount: Number(amount),
      orderId, orderInfo, redirectUrl, ipnUrl, lang: 'vi', requestType, autoCapture: true, extraData, signature: sign(f),
    });
    return { ok: j.resultCode === 0, resultCode: j.resultCode, message: describe(j.resultCode, j.message),
      payUrl: j.payUrl || null, deeplink: j.deeplink || null, qrCodeUrl: j.qrCodeUrl || null };
  }

  // Hoi trang thai don -> { resultCode, message, transId, payType, amount }
  async function query({ orderId, requestId }) {
    const f = { accessKey: cfg.accessKey, orderId, partnerCode: cfg.partnerCode, requestId };
    const j = await post('/v2/gateway/api/query', { partnerCode: cfg.partnerCode, requestId, orderId, lang: 'vi', signature: sign(f) });
    return { resultCode: j.resultCode, message: describe(j.resultCode, j.message), transId: j.transId ? String(j.transId) : null,
      payType: j.payType || null, amount: j.amount };
  }

  // Ket qua MoMo gui ve (IPN body hoac tham so redirect) -> dung chu ky? (chong gia mao)
  function verifyResult(p) {
    if (!p || typeof p.signature !== 'string' || p.partnerCode !== cfg.partnerCode) return false;
    const f = { accessKey: cfg.accessKey };
    for (const k of ['amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType',
      'requestId', 'responseTime', 'resultCode', 'transId']) f[k] = p[k] ?? '';
    const expected = Buffer.from(sign(f));
    const got = Buffer.from(p.signature);
    return expected.length === got.length && crypto.timingSafeEqual(expected, got);
  }

  return { name: 'momo', sandbox, partnerCode: cfg.partnerCode, create, query, verifyResult, sign };
}

module.exports = { createMomoGateway, outcome, describe, REQUEST_TYPE, SANDBOX };
