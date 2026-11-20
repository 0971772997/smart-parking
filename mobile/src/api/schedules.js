import { request } from './client';

// Lich gui xe thuong xuyen cua tai xe (bang parking_schedules tren server)
export const schedulesApi = {
  /** Danh sach lich gui xe cua toi (kem lot {name, freeSlots, online...}, vehiclePlate) */
  list: (opts) => request('/schedules', opts),

  /** Them lich: { name, lotId, arriveTime 'HH:MM', days [1..7], vehicleId?, minutes?, note?, active? } */
  create: (body, opts) => request('/schedules', { method: 'POST', body, ...opts }),

  /** Sua mot phan, vd { active: false } */
  update: (id, body, opts) => request(`/schedules/${id}`, { method: 'PATCH', body, ...opts }),

  /** Xoa lich */
  remove: (id, opts) => request(`/schedules/${id}`, { method: 'DELETE', ...opts }),
};
