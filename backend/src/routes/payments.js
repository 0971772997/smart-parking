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
//   POST /lots/:lotId/sessions/:id/pay     admin thu tien mat tai cong { method, openGate? }
// TRA TRUC TIEP (tien mat / chuyen khoan MB / vi MoMo vao tai khoan cua bai) - admin xac nhan da nhan tien:
//   POST /sessions/:id/manual-pay          tai xe chon { method: cash | bank | momo } -> don cho xac nhan
//                                          (+ thong tin chuyen khoan, ma VietQR, noi dung CK = ma don)
//   GET  /payments/pending?lotId=          (admin) don dang cho xac nhan
//   POST /payments/orders/:orderId/confirm (admin) da nhan tien { openGate } -> ghi giao dich + mo barie cong ra
//   POST /payments/orders/:orderId/reject  (admin) chua nhan duoc tien { reason }
const crypto = require('crypto');
const express = require('express');
const { wrap, badRequest, notFound, conflict, HttpError } = require('../errors');
const v = require('../validate');
const { audit } = require('../admin');
const { SESSION_SELECT, closeSession } = require('../sessions');
const {
  PAYMENT_SELECT, recordPayment, settleOrder, paymentView, orderView, receiptToken, receiptHtml,
} = require('../payments');
const { buildVietQR } = require('../vietqr');
const { createGateOps } = require('../gateOps');

const GATEWAY_METHODS = ['momo', 'atm', 'card'];
const MANUAL_METHODS = ['cash', 'bank', 'momo'];
const MANUAL_TTL_HOURS = 24;
const MANUAL_LABEL = { cash: 'Tiền mặt', bank: 'Chuyển khoản ngân hàng', momo: 'Chuyển tiền ví MoMo' };
const waitingMessage = (m) => (m === 'cash'
  ? 'Đưa tiền mặt cho nhân viên tại cổng – nhân viên xác nhận xong barie sẽ mở'
  : 'Đang chờ nhân viên xác nhận đã nhận tiền chuyển khoản');
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

module.exports = function paymentRoutes({ db, auth, device, gateway, publicUrl, receiptSecret, allowMock = false, live, payee }) {
  const gateOps = device ? createGateOps({ db, device }) : null;
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
    if (o.status !== 'pending' || o.provider === 'manual') return o; // don tra truc tiep: cho admin xac nhan
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
      manual: { methods: MANUAL_METHODS, payee: payeeView() },
    });
  });

  // ---------- Tra truc tiep: tien mat / chuyen khoan / vi MoMo (admin xac nhan) ----------
  function payeeView() {
    return payee ? {
      bankName: payee.bankName, bankBin: payee.bankBin, accountNo: payee.accountNo,
      accountName: payee.accountName, momoPhone: payee.momoPhone,
    } : null;
  }

  // Thong tin de tai xe chuyen tien: noi dung CK = ma don (admin doi chieu trong app ngan hang)
  function payInfo(o) {
    if (o.provider !== 'manual' || o.method === 'cash' || !payee) return null;
    return {
      ...payeeView(), amount: o.amount, content: o.order_id,
      vietqr: buildVietQR({ bin: payee.bankBin, accountNo: payee.accountNo, amount: o.amount, content: o.order_id }),
    };
  }
  const manualOut = async (o) => ({ ...(await orderOut(o)), payInfo: payInfo(o) });

  r.post('/sessions/:id/manual-pay', user, wrap(async (req, res) => {
    const id = v.int(req.params, 'id', { min: 1 });
    const method = parseMethod(req.body, MANUAL_METHODS);
    let s = await loadSession(id);
    if (!s || s.owner_id !== req.user.id) throw notFound('session_not_found', 'Khong tim thay luot do');
    if (s.payment_id) throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
    if (!s.ended_at) {
      if (s.source !== 'gate' || s.parked_at) throw conflict('session_not_ended', 'Xe chua roi bai, chua thanh toan duoc');
      await closeSession(db, s.id);
      s = await loadSession(id);
    }
    const amount = s.fee || 0;
    if (amount <= 0) throw conflict('no_payment_needed', 'Luot do nay mien phi');

    // 1 phien chi giu 1 don tra truc tiep dang cho: doi phuong thuc -> cap nhat don cu (giu nguyen ma / noi dung CK)
    const cur = await db.one(
      `SELECT * FROM payment_orders WHERE session_id = $1 AND provider = 'manual' AND status = 'pending'
       ORDER BY id DESC LIMIT 1`, [s.id]);
    if (cur) {
      const o = await db.one(
        `UPDATE payment_orders SET method = $2, amount = $3, message = $4, updated_at = now(),
           expires_at = now() + make_interval(hours => $5) WHERE id = $1 RETURNING *`,
        [cur.id, method, amount, waitingMessage(method), MANUAL_TTL_HOURS]);
      if (live) live.bump();
      return res.json(await manualOut(o));
    }
    const orderId = `SP${s.id}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const o = await db.one(
      `INSERT INTO payment_orders (order_id, request_id, session_id, user_id, provider, method, amount, result_code, message, expires_at)
       VALUES ($1, $1, $2, $3, 'manual', $4, $5, 1000, $6, now() + make_interval(hours => $7)) RETURNING *`,
      [orderId, s.id, req.user.id, method, amount, waitingMessage(method), MANUAL_TTL_HOURS]);
    if (live) live.bump();
    res.status(201).json(await manualOut(o));
  }));

  const PENDING_SELECT = `
    SELECT o.*, ps.reservation_id, s.slot_number, s.zone, s.lot_id, l.name AS lot_name, veh.plate_number AS vehicle_plate,
           veh.vehicle_type, u.full_name AS user_name, u.phone AS user_phone, ps.ended_at, ps.exited_at
    FROM payment_orders o
    JOIN parking_sessions ps ON ps.id = o.session_id
    JOIN slots s ON s.id = ps.slot_id
    JOIN parking_lots l ON l.id = s.lot_id
    LEFT JOIN vehicles veh ON veh.id = ps.vehicle_id
    LEFT JOIN users u ON u.id = o.user_id`;
  const pendingView = (o) => ({
    orderId: o.order_id, sessionId: o.session_id, reservationId: o.reservation_id, method: o.method,
    methodLabel: MANUAL_LABEL[o.method] || o.method, amount: o.amount, content: o.order_id, status: o.status,
    lotId: o.lot_id, lotName: o.lot_name, slotNumber: o.slot_number, zone: o.zone,
    vehiclePlate: o.vehicle_plate, vehicleType: o.vehicle_type, userName: o.user_name, userPhone: o.user_phone,
    createdAt: o.created_at, updatedAt: o.updated_at,
  });

  r.get('/payments/pending', admin, wrap(async (req, res) => {
    const lotId = v.str(req.query, 'lotId', { max: 50, optional: true });
    const { rows } = await db.query(
      `${PENDING_SELECT} WHERE o.provider = 'manual' AND o.status = 'pending' AND o.expires_at > now()
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.session_id = o.session_id)
         AND ($1::text IS NULL OR s.lot_id = $1)
       ORDER BY o.updated_at DESC LIMIT 50`, [lotId]);
    res.json(rows.map(pendingView));
  }));

  // Admin da nhan tien -> ghi giao dich (1 lan, chong bam 2 lan) -> mo barie cong ra neu xe dang cho ra
  r.post('/payments/orders/:orderId/confirm', admin, wrap(async (req, res) => {
    const openGate = req.body?.openGate !== false;
    const claimed = await db.one(
      `UPDATE payment_orders SET status = 'paid', result_code = 0, message = 'Admin đã xác nhận nhận tiền', updated_at = now()
       WHERE order_id = $1 AND provider = 'manual' AND status = 'pending' RETURNING *`, [String(req.params.orderId)]);
    if (!claimed) {
      const o = await db.one('SELECT status FROM payment_orders WHERE order_id = $1', [String(req.params.orderId)]);
      if (!o) throw notFound('order_not_found', 'Khong tim thay don thanh toan');
      throw conflict(o.status === 'paid' ? 'already_paid' : 'order_not_pending', 'Don nay da duoc xu ly');
    }
    const s = await loadSession(claimed.session_id);
    let p;
    try {
      p = await recordPayment(db, s, {
        userId: s.owner_id || null, method: claimed.method, provider: claimed.method === 'cash' ? 'cash' : 'transfer',
        collectedBy: req.user.id, orderId: claimed.order_id,
      });
    } catch (e) {
      if (e.code !== 'already_paid') {
        await db.query(`UPDATE payment_orders SET status = 'pending', result_code = 1000, message = $2 WHERE id = $1`,
          [claimed.id, waitingMessage(claimed.method)]);
        throw e;
      }
      p = await db.one(`${PAYMENT_SELECT} WHERE p.session_id = $1`, [s.id]); // da tra bang cach khac
    }
    await db.query('UPDATE payment_orders SET payment_id = $2 WHERE id = $1', [claimed.id, p.id]);
    await audit(db, req, 'payment.confirm', 'session', s.id, { orderId: claimed.order_id, method: claimed.method, amount: p.amount });
    const gate = openGate && gateOps ? await gateOps.openExitAfterPayment(s, req.user.id) : { opened: false, reason: 'skipped' };
    if (live) live.bump();
    res.json({ ok: true, payment: view(await loadPayment(p.id)), gate });
  }));

  r.post('/payments/orders/:orderId/reject', admin, wrap(async (req, res) => {
    const reason = v.str(req.body, 'reason', { max: 200, optional: true }) || 'Chưa nhận được tiền – vui lòng kiểm tra lại';
    const o = await db.one(
      `UPDATE payment_orders SET status = 'failed', result_code = 1006, message = $2, updated_at = now()
       WHERE order_id = $1 AND provider = 'manual' AND status = 'pending' RETURNING *`, [String(req.params.orderId), reason]);
    if (!o) throw conflict('order_not_pending', 'Don nay da duoc xu ly hoac khong ton tai');
    await audit(db, req, 'payment.reject', 'session', o.session_id, { orderId: o.order_id, reason });
    if (live) live.bump();
    res.json(await orderOut(o));
  }));

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
    res.json(o.provider === 'manual' ? await manualOut(o) : await orderOut(o));
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
    // Tai xe dang co don tra truc tiep cho xac nhan -> danh dau da tra
    await db.query(`UPDATE payment_orders SET status = 'paid', payment_id = $2, result_code = 0,
      message = 'Admin đã xác nhận nhận tiền', updated_at = now()
      WHERE session_id = $1 AND provider = 'manual' AND status = 'pending'`, [s.id, p.id]);
    const gate = req.body?.openGate && gateOps ? await gateOps.openExitAfterPayment(s, req.user.id) : undefined;
    if (live) live.bump();
    res.status(201).json(gate ? { ...view(p), gate } : view(p));
  }));

  return r;
};
