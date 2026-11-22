import { request } from './client';

const qs = (o = {}) => {
  const q = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  const s = q.toString();
  return s ? `?${s}` : '';
};

// API trang quan tri (chi tai khoan admin)
export const adminApi = {
  overview: (days = 7, opts) => request(`/admin/overview${qs({ days })}`, opts),

  users: (params, opts) => request(`/admin/users${qs(params)}`, opts),
  user: (id, opts) => request(`/admin/users/${id}`, opts),
  /** { fullName?, phone?, role?, locked?, lockedReason?, resetNoShows? } */
  updateUser: (id, body, opts) => request(`/admin/users/${id}`, { method: 'PATCH', body, ...opts }),

  lots: (opts) => request('/admin/lots', opts),
  createLot: (body, opts) => request('/lots', { method: 'POST', body, ...opts }),
  /** { name?, address?, pricePerHour?, totalSlots?, bookingEnabled? } */
  updateLot: (id, body, opts) => request(`/lots/${encodeURIComponent(id)}`, { method: 'PUT', body, ...opts }),
  deleteLot: (id, opts) => request(`/lots/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts }),
  gate: (lotId, gate, action, opts) => request(`/lots/${encodeURIComponent(lotId)}/gates/${gate}/${action}`, { method: 'POST', ...opts }),

  pricing: (lotId, opts) => request(`/admin/pricing${qs({ lotId })}`, opts),
  /** { lotIds?, mode: percent|amount|set, value, reason?, dryRun?, notify? } */
  adjustPrice: (body, opts) => request('/admin/pricing', { method: 'POST', body, ...opts }),

  reservations: (params, opts) => request(`/admin/reservations${qs(params)}`, opts),
  cancelReservation: (id, reason, opts) => request(`/admin/reservations/${id}/cancel`, { method: 'POST', body: { reason: reason || undefined }, ...opts }),

  sessions: (params, opts) => request(`/admin/sessions${qs(params)}`, opts),
  closeSession: (id, body, opts) => request(`/admin/sessions/${id}/close`, { method: 'POST', body, ...opts }),
  collectCash: (lotId, sessionId, opts) => request(`/lots/${encodeURIComponent(lotId)}/sessions/${sessionId}/pay`, { method: 'POST', body: { method: 'cash' }, ...opts }),

  payments: (params, opts) => request(`/admin/payments${qs(params)}`, opts),

  reviews: (params, opts) => request(`/admin/reviews${qs(params)}`, opts),
  deleteReview: (id, reason, opts) => request(`/admin/reviews/${id}`, { method: 'DELETE', body: { reason: reason || undefined }, ...opts }),

  broadcast: (body, opts) => request('/admin/broadcast', { method: 'POST', body, ...opts }),
  broadcasts: (opts) => request('/admin/broadcasts', opts),

  audit: (params, opts) => request(`/admin/audit${qs(params)}`, opts),
};
