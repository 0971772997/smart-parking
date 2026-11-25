import { request } from './client';

export const vehiclesApi = {
  /** Danh sach xe cua toi */
  list: (opts) => request('/vehicles', opts),

  /** Them xe moi. body: { plateNumber, vehicleType?, brand?, color? } */
  create: (body, opts) => request('/vehicles', { method: 'POST', body, ...opts }),

  /** Sua xe (chi gui truong can doi) */
  update: (id, body, opts) => request(`/vehicles/${id}`, { method: 'PUT', body, ...opts }),

  /** Xoa xe */
  remove: (id, opts) => request(`/vehicles/${id}`, { method: 'DELETE', ...opts }),
};
