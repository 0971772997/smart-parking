import { request } from './client';

export const reservationsApi = {
  /** Danh sach dat cho cua toi (co the loc theo status) */
  list: (opts) => request('/reservations', opts),

  /** Chi tiet 1 dat cho */
  detail: (id, opts) => request(`/reservations/${id}`, opts),

  /** Dat cho moi */
  create: (lotId, body, opts) =>
    request(`/lots/${lotId}/reservations`, { method: 'POST', body, ...opts }),

  /** Huy dat cho */
  cancel: (id, opts) => request(`/reservations/${id}`, { method: 'DELETE', ...opts }),

  /** Gia han dat cho */
  extend: (id, minutes, opts) =>
    request(`/reservations/${id}/extend`, { method: 'POST', body: { minutes }, ...opts }),
};

