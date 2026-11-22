// THANH TOAN PHI GUI XE qua CONG THANH TOAN (MoMo - moi truong thu nghiem) + lich su giao dich + bien nhan dien tu
// Gan tai /api (xac thuc tung route).
//   GET  /payments/config                  phuong thuc ho tro, che do thu nghiem (+ thong tin the test)
//   POST /sessions/:id/checkout            tao don thanh toan { method: momo | atm | card } -> payUrl (trang MoMo)
//   GET  /payments/orders/:orderId         trang thai don (dang cho -> hoi MoMo) + giao dich khi thanh cong
//   POST /payments/momo/ipn                MoMo bao ket qua (may chu - may chu, co chu ky)
//   GET  /payments/momo/return             trinh duyet quay ve sau khi thanh toan -> trang ket qua
//   GET  /payments                         lich su giao dich cua toi (+ tong chi tieu)
//   GET  /payments/:id                     chi tiet giao dich = bien nhan dien tu (JSON)
//   GET  /receipts/:receiptNo?t=...        bien nhan dang trang in duoc (lien ket co chu ky, chia se duoc)
//   POST /sessions/:id/pay                 thanh toan GIA LAP tuc thi (chi khi bat ALLOW_MOCK_PAYMENTS / ngoai production)
//   POST /lots/:lotId/sessions/:id/pay     admin thu tien mat tai cong
const crypto = require('crypto');
const express = require('express');
const { wrap, badRequest, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const { audit } = require('../admin');
const { SESSION_SELECT, closeSession } = require('../sessions');
const {
  PAYMENT_SELECT, recordPayment, settleOrder, paymentView, orderView, receiptToken, receiptHtml,
} = require('../payments');

const GATEWAY_METHODS = ['momo', 'atm', 'card'];
const MOCK_METHODS = ['card', 'momo', 'zalopay', 'bank', 'atm'];
const ADMIN_METHODS = ['cash', ...MOCK_METHODS];
const ORDER_TTL_MIN = 20;
const MIN_AMOUNT = 1000; // MoMo khong nhan don < 1.000d

// Thong tin thanh toan thu tren sandbox MoMo (cong khai trong tai lieu MoMo, khong phai tien that)
const SANDBOX_HINTS = {
  momo: 'Quét mã QR bằng app MoMo bản thử nghiệm (MoMo UAT), hoặc chọn thẻ ATM/Visa để nhập thẻ test.',
  atm: 'Thẻ test: chọn ngân hàng NCB • Số thẻ 9704 0000 0000 0018 • Tên NGUYEN VAN A • Ngày phát hành 03/07 • OTP: OTP',
  card: 'Dùng thẻ Visa/Master thử nghiệm theo hướng dẫn trên trang MoMo (không trừ tiền thật).',
};

function parseMethod(body, allowed) {
  const m = v.str(body, 'method', { max: 10 });
  if (!allowed.includes(m)) throw badRequest('validation_error', `'method' phai la ${allowed.join(' | ')}`);
  return m;
}

module.exports = function paymentRoutes({ db, auth, gateway, publicUrl, receiptSecret, allowMock = false, live }) {
  const r = express.Router();
  const user = auth.requireAuth;
  const admin = [auth.requireAuth, auth.requireAdmin];
  const ctx = { publicUrl, secret: receiptSecret };
  const view = (p) => paymentView(p, ctx);
  const loadSession = (id) => db.one(`${SESSION_SELECT} WHERE ps.id = $1`, [id]);
  const loadPayment = (id) => db.one(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);

  // Ap ket qua vao don; don vua chot (thanh cong / that bai) -> bao app dang cho (long-poll)
  async function settle(o, result) {
    const after = await settleOrder(db, o, result, { loadSession });
    if (after && after.status !== o.status && live) live.bump();
    return after;
  }

  async function orderOut(o) {
    // Don vua chuyen 'paid' nhung giao dich dang duoc ghi (IPN dang xu ly) -> tim theo phien
    const pid = o.payment_id
      || (o.status === 'paid' ? (await db.one('SELECT id FROM payments WHERE session_id = $1', [o.session_id]))?.id : null);
    return orderView(o, pid ? view(await loadPayment(pid)) : null);
  }

  // Hoi cong ve don dang cho (du phong khi IPN khong toi) -> don moi nhat
  async function refreshOrder(o) {
    if (o.status !== 'pending') return o;
    try {
      const q = await gateway.query({ orderId: o.order_id, requestId: o.request_id });
      return await settle(o, q);
    } catch (e) {
      console.error('[PAY] Loi tra cuu don', o.order_id, e.message);
      return o;
    }
  }

  // ---------- Tai xe ----------
  r.get('/payments/config', user, (_req, res) => {
    res.json({
      provider: gateway.name, sandbox: gateway.sandbox, methods: GATEWAY_METHODS, minAmount: MIN_AMOUNT,
      orderTtlMinutes: ORDER_TTL_MIN, hints: gateway.sandbox ? SANDBOX_HINTS : {}, mockEnabled: allowMock,
    });
  });

  r.post('/sessions/:id/checkout', user, wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const method = parseMethod(req.body, GATEWAY_METHODS);
    let s = await loadSession(id);
    if (!s || s.owner_id !== req.user.id) throw notFound('session_not_found', 'Khong tim thay luot do');
    if (s.payment_id) throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
    if (!s.ended_at) {
      // Vao bai nhung chua do o nao -> chot phi luc thanh toan; dang do trong o -> chua thanh toan duoc
      if (s.source !== 'gate' || s.parked_at) throw conflict('session_not_ended', 'Xe chua roi bai, chua thanh toan duoc');
      await closeSession(db, s.id);
      s = await loadSession(id);
    }
    const amount = s.fee || 0;
    if (amount <= 0) throw conflict('no_payment_needed', 'Luot do nay mien phi');
    if (amount < MIN_AMOUNT) throw conflict('amount_too_small', 'So tien qua nho de thanh toan qua cong');

    // Don cu dang cho cung phuong thuc / so tien -> dung lai (bam "Thanh toan" nhieu lan khong tao don moi)
    const reuse = await db.one(
      `SELECT * FROM payment_orders WHERE session_id = $1 AND method = $2 AND amount = $3 AND status = 'pending'
         AND expires_at > now() + interval '2 minutes' ORDER BY id DESC LIMIT 1`, [s.id, method, amount]);
    if (reuse) return res.json(await orderOut(reuse));

    const orderId = `SP${s.id}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    let g;
    try {
      g = await gateway.create({
        orderId, requestId: orderId, amount, method,
        orderInfo: `SmartPark - phi gui xe o ${s.slot_number} (${s.lot_name})`.slice(0, 200),
        redirectUrl: `${publicUrl}/api/payments/momo/return`, ipnUrl: `${publicUrl}/api/payments/momo/ipn`,
      });
    } catch (e) {
      console.error('[PAY] Loi ket noi cong thanh toan:', e.message);
      throw new HttpError(502, 'gateway_unavailable', 'Khong ket noi duoc cong thanh toan');
    }
    if (!g.ok) throw Object.assign(new HttpError(502, 'gateway_error', g.message), { details: { resultCode: g.resultCode } });
    const o = await db.one(
      `INSERT INTO payment_orders (order_id, request_id, session_id, user_id, provider, method, amount, pay_url, deeplink,
         qr_code_url, result_code, message, expires_at)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, 1000, 'Đang chờ thanh toán', now() + make_interval(mins => $10)) RETURNING *`,
      [orderId, s.id, req.user.id, gateway.name, method, amount, g.payUrl, g.deeplink, g.qrCodeUrl, ORDER_TTL_MIN]);
    res.status(201).json(await orderOut(o));
  }));

  r.get('/payments/orders/:orderId', user, wrap(async (req, res) => {
    let o = await db.one('SELECT * FROM payment_orders WHERE order_id = $1', [String(req.params.orderId)]);
    if (!o || (o.user_id !== req.user.id && req.user.role !== 'admin')) throw notFound('order_not_found', 'Khong tim thay don thanh toan');
    o = await refreshOrder(o);
    res.json(await orderOut(o));
  }));

  // MoMo -> may chu: ket qua thanh toan (xac thuc chu ky, idempotent). Luon tra 204 de MoMo khong gui lai vo han.
  r.post('/payments/momo/ipn', wrap(async (req, res) => {
    const b = req.body || {};
    if (!gateway.verifyResult(b)) {
      console.warn('[PAY] IPN sai chu ky', b.orderId);
      return res.status(400).json({ error: 'invalid_signature' });
    }
    const o = await db.one('SELECT * FROM payment_orders WHERE order_id = $1', [String(b.orderId)]);
    if (o && Number(b.amount) === o.amount) await settle(o, b);
    res.status(204).end();
  }));

  // Trinh duyet quay ve sau trang MoMo: xac thuc ket qua -> trang thong bao (tai xe quay lai app)
  r.get('/payments/momo/return', wrap(async (req, res) => {
    const q = req.query || {};
    let o = q.orderId ? await db.one('SELECT * FROM payment_orders WHERE order_id = $1', [String(q.orderId)]) : null;
    if (o && gateway.verifyResult(q) && Number(q.amount) === o.amount) o = await settle(o, q);
    else if (o) o = await refreshOrder(o);
    const ok = o && o.status === 'paid';
    const pending = o && o.status === 'pending';
    const title = !o ? 'Không tìm thấy đơn thanh toán' : ok ? 'Thanh toán thành công' : pending ? 'Đang xử lý thanh toán' : 'Thanh toán chưa thành công';
    const color = ok ? '#16a34a' : pending ? '#d97706' : '#dc2626';
    const amount = o ? `${o.amount.toLocaleString('vi-VN')}đ` : '';
    res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – SmartPark</title><style>body{font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;padding:32px;text-align:center;color:#0f172a}
.c{max-width:380px;margin:auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.i{font-size:48px;color:${color}}h1{font-size:20px;color:${color}}p{color:#64748b;font-size:14px}</style></head><body><div class="c">
<div class="i">${ok ? '✓' : pending ? '…' : '✕'}</div><h1>${title}</h1>${amount ? `<p><b>${amount}</b> • Mã đơn ${String(o.order_id).replace(/[<>&"]/g, '')}</p>` : ''}
<p>${o && o.message ? String(o.message).replace(/[<>&"]/g, '') : ''}</p>
<p>Hãy đóng trang này và quay lại ứng dụng <b>SmartPark</b> để xem kết quả và biên nhận.</p></div></body></html>`);
  }));

  r.get('/payments', user, wrap(async (req, res) => {
    const limit = v.int(req.query, 'limit', { min: 1, max: 200, def: 50 });
    const { rows } = await db.query(
      `${PAYMENT_SELECT} WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT $2`, [req.user.id, limit]);
    res.json(rows.map(view));
  }));

  r.get('/payments/:id', user, wrap(async (req, res) => {
    const row = await loadPayment(v.int(req.params, 'id', { min: 1 }));
    if (!row || (row.user_id !== req.user.id && req.user.role !== 'admin')) {
      throw notFound('payment_not_found', 'Khong tim thay giao dich');
    }
    res.json(view(row));
  }));

  // Bien nhan HTML cong khai qua lien ket co chu ky (gui cho nguoi khac / in ra)
  r.get('/receipts/:receiptNo', wrap(async (req, res) => {
    const no = String(req.params.receiptNo);
    const t = Buffer.from(String(req.query.t || ''));
    const expected = Buffer.from(receiptToken(receiptSecret, no));
    if (t.length !== expected.length || !crypto.timingSafeEqual(t, expected)) throw notFound('receipt_not_found', 'Khong tim thay bien nhan');
    const row = await db.one(`${PAYMENT_SELECT} WHERE p.receipt_no = $1`, [no]);
    if (!row) throw notFound('receipt_not_found', 'Khong tim thay bien nhan');
    res.type('html').send(receiptHtml(view(row)));
  }));

  // Thanh toan gia lap tuc thi (khong qua cong) - chi dung khi phat trien / kiem thu
  r.post('/sessions/:id/pay', user, wrap(async (req, res) => {
    if (!allowMock) throw new HttpError(403, 'use_gateway', 'Hay thanh toan qua cong thanh toan');
    const id = v.int(req.params, 'id', { min: 1 });
    const method = parseMethod(req.body, MOCK_METHODS);
    const s = await loadSession(id);
    if (!s || s.owner_id !== req.user.id) throw notFound('session_not_found', 'Khong tim thay luot do');
    res.status(201).json(view(await recordPayment(db, s, { userId: req.user.id, method, provider: 'mock' })));
  }));

  // ---------- Quan tri ----------
  r.post('/lots/:lotId/sessions/:id/pay', admin, wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const method = parseMethod({ method: 'cash', ...req.body }, ADMIN_METHODS);
    const s = await db.one(`${SESSION_SELECT} WHERE ps.id = $1 AND s.lot_id = $2`, [id, req.params.lotId]);
    if (!s) throw notFound('session_not_found', 'Khong tim thay luot do');
    const p = await recordPayment(db, s, {
      userId: s.owner_id || null, method, provider: method === 'cash' ? 'cash' : 'mock', collectedBy: req.user.id,
    });
    await audit(db, req, 'session.collect', 'session', s.id, { method, amount: p?.amount });
    res.status(201).json(view(p));
  }));

  return r;
};
