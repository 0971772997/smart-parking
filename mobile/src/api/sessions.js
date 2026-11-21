import { request } from './client';

export const sessionsApi = {
  /** Phien gui xe dang hoat dong (xe con trong bai) -> { session | null, unread, rules } */
  active: (opts) => request('/sessions/active', opts),

  /** Lich su phien gui xe cua toi */
  mine: (opts) => request('/sessions/mine', opts),

  /** Chi tiet phien + dong thoi gian (timeline) */
  detail: (id, opts) => request(`/sessions/${id}`, opts),

  /** Gia han thoi gian gui du kien */
  extend: (id, minutes, opts) => request(`/sessions/${id}/extend`, { method: 'POST', body: { minutes }, ...opts }),

  /** Cap nhat phien (doi xe) */
  update: (id, body, opts) => request(`/sessions/${id}`, { method: 'PATCH', body, ...opts }),
};

export const notificationsApi = {
  /** Thong bao cua toi (moi nhat truoc). after: chi lay thong bao co id > after */
  list: ({ after = 0, limit = 30 } = {}, opts) => request(`/notifications?after=${after}&limit=${limit}`, opts),

  /** Danh dau da doc: ids = [..] hoac all = true */
  read: ({ ids, all } = {}, opts) => request('/notifications/read', { method: 'POST', body: all ? { all: true } : { ids }, ...opts }),
};

export const liveApi = {
  /** Long-poll: server giu request den khi co thay doi (hoac het `wait` giay) */
  all: (version = '', wait = 25, opts) =>
    request(`/live?v=${encodeURIComponent(version)}&wait=${wait}`, { timeoutMs: (wait + 12) * 1000, ...opts }),
  lot: (lotId, version = '', wait = 25, opts) =>
    request(`/lots/${lotId}/live?v=${encodeURIComponent(version)}&wait=${wait}`, { timeoutMs: (wait + 12) * 1000, ...opts }),
};
