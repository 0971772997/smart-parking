// Tien ich cho lo trinh: nhan ngay trong tuan, chuyen di tiep theo
// Quy uoc ngay: 1 = Thu 2 ... 7 = Chu nhat (giong server)
export const WEEKDAYS = [
  { day: 1, short: 'T2' },
  { day: 2, short: 'T3' },
  { day: 3, short: 'T4' },
  { day: 4, short: 'T5' },
  { day: 5, short: 'T6' },
  { day: 6, short: 'T7' },
  { day: 7, short: 'CN' },
];

export const DAY_PRESETS = [
  { key: 'weekday', label: 'Ngày thường', days: [1, 2, 3, 4, 5] },
  { key: 'weekend', label: 'Cuối tuần', days: [6, 7] },
  { key: 'all', label: 'Hằng ngày', days: [1, 2, 3, 4, 5, 6, 7] },
];

export const isoDay = (date = new Date()) => (date.getDay() === 0 ? 7 : date.getDay());

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function daysLabel(days = []) {
  const sorted = [...days].sort((a, b) => a - b);
  const preset = DAY_PRESETS.find((p) => same(p.days, sorted));
  if (preset) return preset.label;
  return sorted.map((d) => WEEKDAYS[d - 1]?.short).join(', ');
}

/** Lan khoi hanh tiep theo (trong 7 ngay toi) -> { date, label, inMinutes } hoac null */
export function nextDeparture(route, now = new Date()) {
  if (!route?.days?.length || !route.departTime) return null;
  const [h, m] = route.departTime.split(':').map(Number);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d <= now || !route.days.includes(isoDay(d))) continue;
    const inMinutes = Math.round((d - now) / 60000);
    const dayText = i === 0 ? 'Hôm nay' : i === 1 ? 'Ngày mai' : WEEKDAYS[isoDay(d) - 1].short;
    return { date: d, inMinutes, label: `${dayText} ${route.departTime}` };
  }
  return null;
}

export function formatDuration(mins) {
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} giờ ${mins % 60 ? `${mins % 60} phút` : ''}`.trim();
  return `${Math.floor(h / 24)} ngày`;
}

/** "730" / "0730" / "7:30" -> "07:30"; khong hop le -> null */
export function normalizeTime(raw) {
  const s = String(raw || '').trim();
  let h, m;
  const colon = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) [, h, m] = colon;
  else if (/^\d{3,4}$/.test(s)) { h = s.slice(0, -2); m = s.slice(-2); }
  else return null;
  if (+h > 23 || +m > 59) return null;
  return `${String(+h).padStart(2, '0')}:${m}`;
}

export const formatVND = (n) => (n === undefined || n === null ? '—' : `${Number(n).toLocaleString('vi-VN')}đ`);
