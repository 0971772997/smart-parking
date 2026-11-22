import { request } from './client';

export const favoritesApi = {
  /** Bai do yeu thich cua toi (kem cho trong, diem danh gia) */
  list: (opts) => request('/favorites', opts),
  add: (lotId, opts) => request(`/favorites/${encodeURIComponent(lotId)}`, { method: 'PUT', ...opts }),
  remove: (lotId, opts) => request(`/favorites/${encodeURIComponent(lotId)}`, { method: 'DELETE', ...opts }),
};

export const reviewsApi = {
  /** Danh gia cong khai cua bai + tong hop (diem trung binh, phan bo sao, the noi bat) */
  list: (lotId, { limit = 20, offset = 0, rating } = {}, opts) =>
    request(`/lots/${encodeURIComponent(lotId)}/reviews?limit=${limit}&offset=${offset}${rating ? `&rating=${rating}` : ''}`, opts),
  /** Danh gia cua toi + co duoc danh gia khong (da gui xe o bai) */
  mine: (lotId, opts) => request(`/lots/${encodeURIComponent(lotId)}/reviews/mine`, opts),
  /** Gui / sua danh gia: { rating 1-5, tags: [], comment } */
  save: (lotId, body, opts) => request(`/lots/${encodeURIComponent(lotId)}/reviews/mine`, { method: 'PUT', body, ...opts }),
  remove: (lotId, opts) => request(`/lots/${encodeURIComponent(lotId)}/reviews/mine`, { method: 'DELETE', ...opts }),
  /** (Quan tri) phan hoi danh gia */
  reply: (reviewId, reply, opts) => request(`/reviews/${reviewId}/reply`, { method: 'POST', body: { reply }, ...opts }),
};

export const supportApi = {
  /** Lien he, danh muc yeu cau / su co, cau hoi thuong gap */
  info: (opts) => request('/support/info', opts),
  /** Yeu cau cua toi (admin: all = true -> tat ca) */
  list: ({ all = false, status, kind } = {}, opts) => {
    const q = new URLSearchParams();
    if (all) q.set('scope', 'all');
    if (status) q.set('status', status);
    if (kind) q.set('kind', kind);
    return request(`/support/tickets?${q.toString()}`, opts);
  },
  detail: (id, opts) => request(`/support/tickets/${id}`, opts),
  /** { kind: support|incident, category, subject, description, lotId?, slotNumber?, sessionId?, reservationId? } */
  create: (body, opts) => request('/support/tickets', { method: 'POST', body, ...opts }),
  reply: (id, body, opts) => request(`/support/tickets/${id}/messages`, { method: 'POST', body: { body }, ...opts }),
  setStatus: (id, status, opts) => request(`/support/tickets/${id}`, { method: 'PATCH', body: { status }, ...opts }),
};
