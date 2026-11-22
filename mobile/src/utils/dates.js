// Ngay dang 'YYYY-MM-DD' (theo gio may) cho bo loc lich su
const pad = (n) => String(n).padStart(2, '0');

/** Date -> '2026-11-22' (gio dia phuong) */
export const toYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** '2026-11-22' -> Date 00:00 gio dia phuong */
export const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return toYmd(d); };
/** '2026-11-22' -> '22/11/2026' (short: '22/11') */
export const ymdLabel = (s, short = false) => { const [y, m, d] = s.split('-'); return short ? `${d}/${m}` : `${d}/${m}/${y}`; };

const WEEKDAY = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
/** Tieu de nhom theo ngay: Hom nay / Hom qua / Thu 5, 20/11/2026 */
export function dayHeading(iso, today = toYmd()) {
  const s = toYmd(new Date(iso));
  if (s === today) return 'Hôm nay';
  if (s === addDays(today, -1)) return 'Hôm qua';
  return `${WEEKDAY[fromYmd(s).getDay()]}, ${ymdLabel(s)}`;
}

/** Khoang ngay nhanh */
export function presetRange(key, today = toYmd()) {
  const d = fromYmd(today);
  switch (key) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'month': return { from: toYmd(new Date(d.getFullYear(), d.getMonth(), 1)), to: today };
    case 'lastMonth': return {
      from: toYmd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: toYmd(new Date(d.getFullYear(), d.getMonth(), 0)),
    };
    default: return null;
  }
}

export const PRESETS = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'lastMonth', label: 'Tháng trước' },
];

/** 5400 giay -> '1 giờ 30 phút' */
export function formatSeconds(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} giờ ${m % 60} phút` : `${h} giờ`;
}
