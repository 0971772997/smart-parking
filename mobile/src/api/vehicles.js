import { request } from './client';

export const vehiclesApi = {
  /** Danh sach xe cua toi */
  list: (opts) => request('/vehicles', opts),

  /** Them xe moi */
  create: (body, opts) => request('/vehicles', { method: 'POST', body, ...opts }),

  /** Xoa xe */
  remove: (id, opts) => request(`/vehicles/${id}`, { method: 'DELETE', ...opts }),
};

