import { request } from './client';

export const gatesApi = {
  /** Nhan vien quet ma QR tai cong. body: { lotId, gate: 'entry'|'exit', token } */
  scan: (body, opts) => request('/gates/scan', { method: 'POST', body, timeoutMs: 30000, ...opts }),

  /** Nhat ky quet ma (ca lan loi) */
  scans: (lotId, limit = 20, opts) => request(`/gates/scans?lotId=${encodeURIComponent(lotId)}&limit=${limit}`, opts),
};

// Giu duong dan import cu
export { paymentsApi } from './payments';
