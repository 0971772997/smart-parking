// DIEU CHINH GIA GUI XE (admin)
//   - Tang / giam theo % hoac theo so tien, hoac dat gia moi cho 1 / nhieu / tat ca bai
//   - Gia lam tron toi 1.000d, nam trong [0, MAX_PRICE]
//   - Moi lan doi gia ghi vao price_changes (lich su) - ca khi sua gia qua PUT /lots/:id
//   - Gia da CHOT cho dat cho / phien dang gui (cot hourly_rate) -> khong bi doi theo
const { badRequest } = require('./errors');

const MAX_PRICE = 10000000;
const ROUND_TO = 1000;
const MODES = ['percent', 'amount', 'set'];
const LIMITS = { percent: [-90, 500], amount: [-MAX_PRICE, MAX_PRICE], set: [0, MAX_PRICE] };

const clamp = (n) => Math.min(MAX_PRICE, Math.max(0, n));
const roundPrice = (n) => clamp(Math.round(n / ROUND_TO) * ROUND_TO);

// Gia moi tu gia cu. percent: +10 = tang 10%, -20 = giam 20%; amount: +2000 / -1000; set: gia moi
function adjustPrice(oldPrice, mode, value) {
  if (mode === 'percent') return roundPrice(oldPrice * (1 + value / 100));
  if (mode === 'amount') return roundPrice(oldPrice + value);
  return roundPrice(value);
}

function parseAdjustment(body) {
  const mode = body?.mode;
  if (!MODES.includes(mode)) throw badRequest('validation_error', "'mode' phai la percent | amount | set");
  const value = body?.value;
  const [min, max] = LIMITS[mode];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw Object.assign(badRequest('validation_error', `'value' phai la so nguyen tu ${min} den ${max}`), { details: { min, max } });
  }
  if (mode !== 'set' && value === 0) throw badRequest('validation_error', "'value' phai khac 0");
  return { mode, value };
}

// Doi gia 1 bai trong transaction q (khoa dong bai) -> { lotId, name, oldPrice, newPrice } | null neu khong doi
async function setLotPrice(q, lotId, newPriceOf, { by = null, reason = null } = {}) {
  const lot = (await q.query('SELECT id, name, price_per_hour FROM parking_lots WHERE id = $1 FOR UPDATE', [lotId])).rows[0];
  if (!lot) return null;
  const oldPrice = lot.price_per_hour;
  const newPrice = typeof newPriceOf === 'function' ? newPriceOf(oldPrice) : newPriceOf;
  if (newPrice === oldPrice) return null;
  await q.query('UPDATE parking_lots SET price_per_hour = $2 WHERE id = $1', [lotId, newPrice]);
  const id = (await q.query(
    'INSERT INTO price_changes (lot_id, old_price, new_price, reason, changed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [lotId, oldPrice, newPrice, reason, by])).rows[0].id;
  return { id: Number(id), lotId, name: lot.name, oldPrice, newPrice };
}

const changeView = (c) => ({
  id: Number(c.id), lotId: c.lot_id, lotName: c.lot_name ?? null, oldPrice: c.old_price, newPrice: c.new_price,
  diff: c.new_price - c.old_price,
  percent: c.old_price > 0 ? Math.round(((c.new_price - c.old_price) / c.old_price) * 1000) / 10 : null,
  reason: c.reason, changedBy: c.by_name || c.by_email || null, createdAt: c.created_at,
});

module.exports = { MAX_PRICE, ROUND_TO, MODES, LIMITS, adjustPrice, roundPrice, parseAdjustment, setLotPrice, changeView };
