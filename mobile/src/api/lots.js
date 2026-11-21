import { request } from './client';

export const lotsApi = {
  /** Danh sach tat ca bai do (cong khai, khong can dang nhap) */
  list: (opts) => request('/lots', opts),

  /** Chi tiet 1 bai do kem danh sach o do */
  detail: (lotId, opts) => request(`/lots/${lotId}`, opts),

  /** Danh sach o do cua 1 bai */
  slots: (lotId, opts) => request(`/lots/${lotId}/slots`, opts),

  /** Them bai do moi (Admin) */
  create: (body, opts) => request('/lots', { method: 'POST', body, ...opts }),

  /** Chinh sua thong tin bai do (Admin) */
  update: (lotId, body, opts) => request(`/lots/${lotId}`, { method: 'PUT', body, ...opts }),

  /** Xoa bai do (Admin) */
  remove: (lotId, opts) => request(`/lots/${lotId}`, { method: 'DELETE', ...opts }),
};

