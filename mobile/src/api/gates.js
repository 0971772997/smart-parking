import { request } from './client';

export const gatesApi = {
  /** Nhan vien quet ma QR tai cong. body: { lotId, gate: 'entry'|'exit', token } */
  scan: (body, opts) => request('/gates/scan', { method: 'POST', body, timeoutMs: 30000, ...opts }),

  /** Nhat ky quet ma (ca lan loi) */
  scans: (lotId, limit = 20, opts) => request(`/gates/scans?lotId=${encodeURIComponent(lotId)}&limit=${limit}`, opts),
};

export const paymentsApi = {
  /** Tai xe thanh toan luot do da ket thuc (cong thanh toan gia lap). method: card | momo | zalopay | bank */
  paySession: (sessionId, method, opts) =>
    request(`/sessions/${sessionId}/pay`, { method: 'POST', body: { method }, ...opts }),

  /** Nhan vien thu tien tai cong (mac dinh tien mat) */
  collect: (lotId, sessionId, method = 'cash', opts) =>
    request(`/lots/${lotId}/sessions/${sessionId}/pay`, { method: 'POST', body: { method }, ...opts }),
};
