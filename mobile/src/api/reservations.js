import { request } from './client';

export const reservationsApi = {
  /** Danh sach dat cho cua toi. status: 'active' | 'active,pending' ... */
  list: (opts = {}) => {
    const { status, ...rest } = opts;
    return request(`/reservations${status ? `?status=${encodeURIComponent(status)}` : ''}`, rest);
  },

  /** Chi tiet 1 dat cho */
  detail: (id, opts) => request(`/reservations/${id}`, opts),

  /** Quy tac dat cho (giu cho, gia han, khong den) + tinh trang cua toi */
  rules: (opts) => request('/reservations/rules', opts),

  /**
   * Dat cho moi. body: { zone?, slotNumber?, minutes (giu cho), durationMinutes (gui du kien), vehicleId? }
   * Khong co slotNumber -> may chu tu chon o trong trong khu.
   */
  create: (lotId, body, opts) =>
    request(`/lots/${lotId}/reservations`, { method: 'POST', body, ...opts }),

  /** Huy dat cho */
  cancel: (id, opts) => request(`/reservations/${id}`, { method: 'DELETE', ...opts }),

  /** Gia han dat cho */
  extend: (id, minutes, opts) =>
    request(`/reservations/${id}/extend`, { method: 'POST', body: { minutes }, ...opts }),
};
