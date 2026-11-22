// Ngay 'YYYY-MM-DD' theo gio Viet Nam (bo loc lich su / bao cao)
const { badRequest } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'Asia/Ho_Chi_Minh';
const vnToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function parseDate(q, key, def) {
  const raw = q[key];
  if (raw === undefined || raw === '') return def;
  const s = String(raw);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw badRequest('invalid_date', `'${key}' phai co dang YYYY-MM-DD`);
  }
  return s;
}

// { from, to } tu query (mac dinh `days` ngay gan nhat), kiem tra thu tu + do dai
function parseRange(q, { days = 30, maxDays = 366 } = {}) {
  const to = parseDate(q, 'to', vnToday());
  const from = parseDate(q, 'from', addDays(to, -(days - 1)));
  if (from > to) throw badRequest('invalid_range', "'from' phai truoc hoac bang 'to'");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= maxDays) throw badRequest('range_too_long', `Toi da ${maxDays} ngay`);
  return { from, to };
}

// Dieu kien SQL: cot thoi gian nam trong [from 00:00, to+1 00:00) gio VN; pFrom/pTo = vi tri tham so
const inRange = (col, pFrom, pTo) =>
  `${col} >= ($${pFrom}::date)::timestamp AT TIME ZONE '${TZ}' AND ${col} < ($${pTo}::date + 1)::timestamp AT TIME ZONE '${TZ}'`;

module.exports = { TZ, vnToday, addDays, parseDate, parseRange, inRange };
