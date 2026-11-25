import { request } from './client';

export const gatesApi = {
  /** (Admin) Ma QR cua bai de hien tai cong (bo trong gate = 1 ma chung cho vao + ra) - tu doi sau ttlSeconds, goi lai truoc khi het han */
  display: (lotId, gate, opts) =>
    request(`/gates/display?lotId=${encodeURIComponent(lotId)}${gate ? `&gate=${gate}` : ''}`, opts),

  /** (Tai xe) Quet ma QR cua cong -> mo barie. body: { token, reservationId?, vehicleId? } */
  checkin: (body, opts) => request('/gates/checkin', { method: 'POST', body, timeoutMs: 30000, ...opts }),

  /** (Du phong) Nhan vien quet ma QR dat cho cua tai xe. body: { lotId, gate, token } */
  scan: (body, opts) => request('/gates/scan', { method: 'POST', body, timeoutMs: 30000, ...opts }),

  /** (Admin) Nhat ky quet ma (ca lan loi). gate: 'entry' | 'exit' | undefined */
  scans: (lotId, limit = 20, opts = {}) => {
    const { gate, ...rest } = opts;
    return request(`/gates/scans?lotId=${encodeURIComponent(lotId)}&limit=${limit}${gate ? `&gate=${gate}` : ''}`, rest);
  },
};

// Giu duong dan import cu
export { paymentsApi } from './payments';
