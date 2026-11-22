import { request } from './client';

export const historyApi = {
  /**
   * Lich su dat cho & gui xe trong khoang ngay (YYYY-MM-DD, gio Viet Nam).
   * kind: 'all' | 'sessions' | 'reservations' -> { from, to, items: [{ kind, at, session | reservation }], summary }
   */
  list: ({ from, to, kind = 'all', lotId } = {}, opts) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (kind && kind !== 'all') q.set('kind', kind);
    if (lotId) q.set('lotId', lotId);
    return request(`/history?${q.toString()}`, opts);
  },
};
