import { request } from './client';

export const paymentsApi = {
  /** Cau hinh thanh toan: cong MoMo, phuong thuc tra truc tiep + tai khoan nhan tien (manual.payee) */
  config: (opts) => request('/payments/config', opts),

  /** Tao don thanh toan qua cong MoMo (thu nghiem). method: momo | atm | card -> { orderId, payUrl, ... } */
  checkout: (sessionId, method, opts) =>
    request(`/sessions/${sessionId}/checkout`, { method: 'POST', body: { method }, timeoutMs: 40000, ...opts }),

  /**
   * Tra truc tiep: method cash (tien mat tai cong) | bank (chuyen khoan) | momo (chuyen vi MoMo)
   * -> don cho admin xac nhan { orderId, status, payInfo: { bankName, accountNo, accountName, momoPhone, content, vietqr } }
   */
  manualPay: (sessionId, method, opts) =>
    request(`/sessions/${sessionId}/manual-pay`, { method: 'POST', body: { method }, ...opts }),

  /** Trang thai don -> { status: pending|paid|failed|expired, payment?, payInfo? } */
  order: (orderId, opts) => request(`/payments/orders/${encodeURIComponent(orderId)}`, { timeoutMs: 30000, ...opts }),

  /** Lich su giao dich cua toi */
  list: (limit = 100, opts) => request(`/payments?limit=${limit}`, opts),

  /** Chi tiet giao dich = bien nhan dien tu */
  receipt: (id, opts) => request(`/payments/${id}`, opts),

  // ----- Admin -----
  /** Don tra truc tiep dang cho xac nhan */
  pending: (lotId, opts) => request(`/payments/pending${lotId ? `?lotId=${encodeURIComponent(lotId)}` : ''}`, opts),

  /** Da nhan tien -> ghi giao dich + mo barie cong ra (openGate) -> { payment, gate: { opened, reason, message } } */
  confirm: (orderId, openGate = true, opts) =>
    request(`/payments/orders/${encodeURIComponent(orderId)}/confirm`, { method: 'POST', body: { openGate }, timeoutMs: 30000, ...opts }),

  /** Chua nhan duoc tien */
  reject: (orderId, reason, opts) =>
    request(`/payments/orders/${encodeURIComponent(orderId)}/reject`, { method: 'POST', body: reason ? { reason } : {}, ...opts }),

  /** Nhan vien thu tien tai cong (mac dinh tien mat); openGate -> mo barie cong ra luon */
  collect: (lotId, sessionId, method = 'cash', opts = {}) => {
    const { openGate, ...rest } = opts;
    return request(`/lots/${lotId}/sessions/${sessionId}/pay`,
      { method: 'POST', body: { method, ...(openGate && { openGate: true }) }, timeoutMs: 30000, ...rest });
  },
};
