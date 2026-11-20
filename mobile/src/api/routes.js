import { request } from './client';

// Lo trinh thuong di cua tai xe (bang driver_routes tren server)
export const routesApi = {
  /** Danh sach lo trinh cua toi (kem lot {name, freeSlots, online...}, vehiclePlate) */
  list: (opts) => request('/routes', opts),

  /** Them lo trinh: { name, lotId, departTime 'HH:MM', days [1..7], origin?, vehicleId?, minutes?, note?, active? } */
  create: (body, opts) => request('/routes', { method: 'POST', body, ...opts }),

  /** Sua mot phan, vd { active: false } */
  update: (id, body, opts) => request(`/routes/${id}`, { method: 'PATCH', body, ...opts }),

  /** Xoa lo trinh */
  remove: (id, opts) => request(`/routes/${id}`, { method: 'DELETE', ...opts }),
};
