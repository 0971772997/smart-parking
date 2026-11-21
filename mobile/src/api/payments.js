import { request } from './client';

export const paymentsApi = {
  /** Cau hinh cong thanh toan: phuong thuc, che do thu nghiem, huong dan the test */
  config: (opts) => request('/payments/config', opts),

  /** Tao don thanh toan qua cong MoMo. method: momo (vi) | atm (the noi dia) | card (Visa/Master) -> { orderId, payUrl, ... } */
  checkout: (sessionId, method, opts) =>
    request(`/sessions/${sessionId}/checkout`, { method: 'POST', body: { method }, timeoutMs: 40000, ...opts }),

  /** Trang thai don (may chu tu hoi MoMo neu dang cho) -> { status: pending|paid|failed|expired, payment? } */
  order: (orderId, opts) => request(`/payments/orders/${encodeURIComponent(orderId)}`, { timeoutMs: 30000, ...opts }),

  /** Lich su giao dich cua toi */
  list: (limit = 100, opts) => request(`/payments?limit=${limit}`, opts),

  /** Chi tiet giao dich = bien nhan dien tu */
  receipt: (id, opts) => request(`/payments/${id}`, opts),

  /** Nhan vien thu tien tai cong (mac dinh tien mat) */
  collect: (lotId, sessionId, method = 'cash', opts) =>
    request(`/lots/${lotId}/sessions/${sessionId}/pay`, { method: 'POST', body: { method }, ...opts }),
};
