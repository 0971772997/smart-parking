// GIAO DICH + BIEN NHAN DIEN TU
//   recordPayment : ghi 1 giao dich thanh cong cho phien gui xe (1 phien chi 1 giao dich - UNIQUE session_id),
//                   cap so bien nhan BLyyyymmdd-000123 va chup lai chi tiet phi (breakdown) tai thoi diem thanh toan
//   settleOrder   : ap ket qua tu cong thanh toan (IPN / redirect / tra cuu) vao don -> tao giao dich khi thanh cong
//   receiptHtml   : bien nhan dang trang HTML (in / chia se qua lien ket co chu ky)
const crypto = require('crypto');
const { conflict } = require('./errors');
const { closeSession, notify, vnd } = require('./sessions');
const { outcome, describe } = require('./paymentGateway');
const { RULES } = require('./booking');

const METHOD_LABEL = {
  cash: 'Tiền mặt', momo: 'Ví MoMo', atm: 'Thẻ ATM nội địa', card: 'Thẻ Visa/Master', zalopay: 'ZaloPay', bank: 'Chuyển khoản',
};
const PROVIDER_LABEL = {
  momo: 'MoMo (môi trường thử nghiệm)', cash: 'Thu tại quầy', transfer: 'Chuyển khoản – nhân viên xác nhận', mock: 'Giả lập',
};

const PAYMENT_SELECT = `
  SELECT p.*, s.slot_number, s.zone, s.lot_id, l.name AS lot_name, l.address AS lot_address,
         ps.started_at, ps.ended_at, ps.duration_seconds, ps.reservation_id,
         veh.plate_number AS vehicle_plate, cu.full_name AS collector_name
  FROM payments p
  JOIN parking_sessions ps ON ps.id = p.session_id
  JOIN slots s ON s.id = ps.slot_id
  JOIN parking_lots l ON l.id = s.lot_id
  LEFT JOIN vehicles veh ON veh.id = ps.vehicle_id
  LEFT JOIN users cu ON cu.id = p.collected_by`;

const vnDate = (d = new Date()) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');

// Ma giao dich: GD + ngay (gio VN) + 6 ky tu ngau nhien
function newCode() {
  const rnd = crypto.randomBytes(6).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(6, 'X').slice(0, 6);
  return `GD${vnDate()}-${rnd}`;
}

// Chi tiet phi chup lai luc thanh toan (bien nhan khong doi du sau nay gia thay doi)
function breakdownOf(s) {
  const fee = s.fee || 0;
  const overtime = s.overtime_fee || 0;
  const hold = s.hold_fee || 0;
  const seconds = s.duration_seconds ?? 0;
  const base = fee - overtime - hold;
  const hours = base > 0 ? Math.max(1, Math.ceil(seconds / 3600)) : 0;
  const lines = [];
  if (base > 0) lines.push({ label: `Phí gửi xe ${hours} giờ × ${vnd(s.price_per_hour)}`, amount: base });
  if (overtime > 0) lines.push({ label: 'Phụ phí quá giờ dự kiến', amount: overtime });
  if (hold > 0) {
    const n = Math.round(hold / RULES.extend.fee);
    lines.push({ label: `Phí gia hạn giữ chỗ (${n} lần × ${vnd(RULES.extend.fee)})`, amount: hold });
  }
  if (fee === 0) lines.push({ label: 'Miễn phí (rời bãi trong thời gian ân hạn)', amount: 0 });
  return {
    lotName: s.lot_name, lotAddress: s.lot_address, zone: s.zone, slotNumber: s.slot_number,
    vehiclePlate: s.vehicle_plate ?? null, reservationCode: s.reservation_code ?? null,
    startedAt: s.started_at, parkedAt: s.parked_at, endedAt: s.ended_at, durationSeconds: seconds,
    plannedEndAt: s.planned_end_at, pricePerHour: s.price_per_hour, hours,
    base, overtime, holdFee: hold, total: fee, lines,
  };
}

// Ghi giao dich thanh cong. session: dong SESSION_SELECT (src/sessions.js)
async function recordPayment(db, session, { userId, method, provider, collectedBy = null, orderId = null, transId = null }) {
  if (session.payment_id) throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
  if (!session.ended_at) {
    // Qua cong vao nhung chua do o nao -> chot phi ngay bay gio de ra bai
    if (session.source !== 'gate' || session.parked_at) throw conflict('session_not_ended', 'Xe chua roi bai, chua thanh toan duoc');
    Object.assign(session, await closeSession(db, session.id));
  }
  const breakdown = breakdownOf(session);
  let row;
  try {
    row = await db.one(
      `INSERT INTO payments (code, session_id, user_id, amount, method, collected_by, provider, order_id, gateway_trans_id, breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at`,
      [newCode(), session.id, userId, session.fee || 0, method, collectedBy, provider, orderId, transId, breakdown]);
  } catch (e) {
    if (e.code === '23505') throw conflict('already_paid', 'Luot do nay da duoc thanh toan');
    throw e;
  }
  const receiptNo = `BL${vnDate(row.created_at)}-${String(row.id).padStart(6, '0')}`;
  await db.query('UPDATE payments SET receipt_no = $2 WHERE id = $1', [row.id, receiptNo]);
  const p = await db.one(`${PAYMENT_SELECT} WHERE p.id = $1`, [row.id]);
  await notify(db, { userId: session.owner_id, sessionId: session.id, type: 'paid', key: `s${session.id}:paid`,
    title: 'Thanh toán thành công',
    body: `Đã thanh toán ${vnd(p.amount)} bằng ${METHOD_LABEL[method] || method} • Biên nhận ${receiptNo}. Quét mã QR cổng ra để rời bãi.`,
    data: { amount: p.amount, method, code: p.code, paymentId: p.id, receiptNo } });
  return p;
}

// Ap ket qua tu cong vao don (idempotent: don da xong thi bo qua). result: { resultCode, message, transId, payType }
//   -> don sau khi cap nhat
async function settleOrder(db, order, result, { loadSession }) {
  if (order.status !== 'pending') return order;
  const code = Number(result.resultCode);
  const state = outcome(code);
  const message = describe(code, result.message);
  if (state === 'pending') {
    if (new Date(order.expires_at) < new Date()) {
      return (await db.one(`UPDATE payment_orders SET status = 'expired', result_code = $2, message = 'Đơn thanh toán đã hết hạn',
        updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`, [order.id, code])) || order;
    }
    return db.one('UPDATE payment_orders SET result_code = $2, message = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [order.id, code, message]);
  }
  // Khoa don (chi 1 tien trinh chot): pending -> paid/failed
  const locked = await db.one(
    `UPDATE payment_orders SET status = $2, result_code = $3, message = $4, trans_id = $5, pay_type = $6, updated_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [order.id, state, code, message, result.transId ? String(result.transId) : null, result.payType || null]);
  if (!locked) return db.one('SELECT * FROM payment_orders WHERE id = $1', [order.id]);
  if (state === 'failed') {
    await notify(db, { userId: locked.user_id, sessionId: locked.session_id, type: 'payment_failed', key: `o${locked.order_id}:failed`,
      title: 'Thanh toán không thành công', body: `${message}. Bạn có thể thử lại hoặc chọn phương thức khác.`,
      data: { orderId: locked.order_id, resultCode: code } });
    return locked;
  }
  // Thanh cong -> tao giao dich + bien nhan
  const session = await loadSession(locked.session_id);
  let paymentId = session.payment_id;
  if (!paymentId) {
    try {
      const p = await recordPayment(db, session, { userId: locked.user_id, method: locked.method, provider: locked.provider,
        orderId: locked.order_id, transId: locked.trans_id });
      paymentId = p.id;
    } catch (e) {
      if (e.code !== 'already_paid') throw e;
      paymentId = (await db.one('SELECT id FROM payments WHERE session_id = $1', [locked.session_id]))?.id;
    }
  } else {
    // Phien da duoc tra bang cach khac (vd tien mat) -> danh dau de hoan tien
    await db.query(`UPDATE payment_orders SET message = 'Phiên đã được thanh toán trước đó – cần hoàn tiền giao dịch này' WHERE id = $1`, [locked.id]);
  }
  return db.one('UPDATE payment_orders SET payment_id = $2 WHERE id = $1 RETURNING *', [locked.id, paymentId]);
}

// ---------- Bien nhan ----------
const receiptToken = (secret, receiptNo) =>
  crypto.createHmac('sha256', String(secret)).update(`receipt:${receiptNo}`).digest('base64url').slice(0, 22);

function paymentView(p, { publicUrl, secret } = {}) {
  if (!p) return p;
  return {
    id: p.id, code: p.code, receiptNo: p.receipt_no, sessionId: p.session_id, userId: p.user_id, amount: p.amount,
    method: p.method, methodLabel: METHOD_LABEL[p.method] || p.method,
    provider: p.provider, providerLabel: PROVIDER_LABEL[p.provider] || p.provider,
    orderId: p.order_id ?? null, gatewayTransId: p.gateway_trans_id ?? null,
    collectedBy: p.collected_by, collectorName: p.collector_name ?? null, createdAt: p.created_at,
    lotId: p.lot_id, lotName: p.lot_name, lotAddress: p.lot_address, zone: p.zone, slotNumber: p.slot_number,
    vehiclePlate: p.vehicle_plate ?? p.breakdown?.vehiclePlate ?? null,
    startedAt: p.started_at, endedAt: p.ended_at, durationSeconds: p.duration_seconds,
    breakdown: p.breakdown || null,
    receiptUrl: publicUrl && secret && p.receipt_no
      ? `${publicUrl}/api/receipts/${p.receipt_no}?t=${receiptToken(secret, p.receipt_no)}` : null,
  };
}

function orderView(o, payment = null) {
  return {
    orderId: o.order_id, sessionId: o.session_id, amount: o.amount, method: o.method, methodLabel: METHOD_LABEL[o.method],
    provider: o.provider, status: o.status, resultCode: o.result_code, message: o.message, transId: o.trans_id,
    payUrl: o.pay_url, deeplink: o.deeplink, qrCodeUrl: o.qr_code_url,
    paymentId: o.payment_id, payment, createdAt: o.created_at, expiresAt: o.expires_at,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (d) => (d ? new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16)
  .replace(/^(\d{4})-(\d{2})-(\d{2}) (.*)$/, '$4 $3/$2/$1') : '—');
const fmtDur = (sec) => { const m = Math.round((sec || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`; };

// Bien nhan dien tu dang HTML (trang in duoc, khong can dang nhap - lien ket co chu ky)
function receiptHtml(view) {
  const b = view.breakdown || {};
  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const lines = (b.lines || [{ label: 'Phí gửi xe', amount: view.amount }])
    .map((l) => `<tr><td>${esc(l.label)}</td><td>${esc(vnd(l.amount))}</td></tr>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Biên nhận ${esc(view.receiptNo)} – SmartPark</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;margin:0;padding:24px;color:#0f172a}
.r{max-width:420px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0}.muted{color:#64748b;font-size:13px}.paid{display:inline-block;margin-top:8px;padding:4px 10px;border-radius:999px;background:#ecfdf5;color:#16a34a;font-weight:800;font-size:12px;letter-spacing:1px}
table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px}td{padding:6px 0;vertical-align:top}td:last-child{text-align:right;font-weight:600}
.sec{border-top:1px dashed #cbd5e1;margin-top:14px}.total td{font-size:18px;font-weight:900;color:#1d4ed8;padding-top:10px}
.foot{text-align:center;margin-top:18px}button{margin-top:16px;padding:10px 16px;border:0;border-radius:10px;background:#1d4ed8;color:#fff;font-weight:700}
@media print{body{background:#fff;padding:0}.r{box-shadow:none}button{display:none}}
</style></head><body><div class="r">
<h1>SmartPark – Biên nhận điện tử</h1>
<div class="muted">Số: <b>${esc(view.receiptNo)}</b> • Mã GD: ${esc(view.code)}</div>
<span class="paid">ĐÃ THANH TOÁN</span>
<table>${row('Thời gian thanh toán', fmtTime(view.createdAt))}${row('Bãi đỗ', view.lotName)}${row('Khu / Ô', `${b.zone || view.zone || '—'} / #${view.slotNumber}`)}
${row('Biển số', view.vehiclePlate || '—')}${b.reservationCode ? row('Mã đặt chỗ', b.reservationCode) : ''}
${row('Vào bãi', fmtTime(b.startedAt || view.startedAt))}${row('Rời ô / chốt phí', fmtTime(b.endedAt || view.endedAt))}${row('Thời gian gửi', fmtDur(b.durationSeconds ?? view.durationSeconds))}</table>
<div class="sec"></div><table>${lines}<tr class="total"><td>Tổng cộng</td><td>${esc(vnd(view.amount))}</td></tr></table>
<div class="sec"></div><table>${row('Phương thức', view.methodLabel)}${row('Cổng thanh toán', view.providerLabel)}
${view.gatewayTransId ? row('Mã giao dịch MoMo', view.gatewayTransId) : ''}${view.orderId ? row('Mã đơn', view.orderId) : ''}
${view.collectorName ? row('Thu ngân', view.collectorName) : ''}</table>
<div class="foot muted">Biên nhận điện tử có giá trị xác nhận thanh toán phí gửi xe.<br>${view.provider === 'momo' ? 'Giao dịch thực hiện trên môi trường thử nghiệm của MoMo – không trừ tiền thật.' : ''}
<br><button onclick="window.print()">In / Lưu PDF</button></div></div></body></html>`;
}

module.exports = {
  PAYMENT_SELECT, METHOD_LABEL, newCode, breakdownOf, recordPayment, settleOrder, paymentView, orderView,
  receiptToken, receiptHtml,
};
