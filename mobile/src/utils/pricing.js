// Dieu chinh gia (trang quan tri): doi lua chon tren man hinh -> yeu cau API + xem truoc gia moi ngay tren may
// (cung cong thuc voi backend/src/pricing.js; may chu van la noi quyet dinh cuoi cung)
export const ROUND_TO = 1000;
export const MAX_PRICE = 10000000;
export const QUICK = { percent: [5, 10, 20, 50], amount: [1000, 2000, 5000, 10000] };

const clamp = (n) => Math.min(MAX_PRICE, Math.max(0, n));
export const roundPrice = (n) => clamp(Math.round(n / ROUND_TO) * ROUND_TO);

/**
 * direction: 'up' | 'down' | 'set'; unit: 'percent' | 'amount'; amount: chuoi so nguoi dung nhap
 * -> { mode, value } | { error } | null (chua nhap)
 */
export function buildAdjustment({ direction, unit, amount }) {
  const raw = String(amount ?? '').replace(/\D/g, '');
  if (!raw) return null;
  const n = Number(raw);
  if (direction === 'set') {
    if (n > MAX_PRICE) return { error: 'Giá tối đa 10.000.000đ/giờ.' };
    return { mode: 'set', value: n };
  }
  if (n === 0) return { error: 'Mức thay đổi phải lớn hơn 0.' };
  const sign = direction === 'down' ? -1 : 1;
  if (unit === 'percent') {
    if (direction === 'down' && n > 90) return { error: 'Giảm tối đa 90%.' };
    if (n > 500) return { error: 'Tăng tối đa 500%.' };
    return { mode: 'percent', value: sign * n };
  }
  if (n > MAX_PRICE) return { error: 'Số tiền quá lớn.' };
  return { mode: 'amount', value: sign * n };
}

export function adjustPrice(oldPrice, { mode, value }) {
  if (mode === 'percent') return roundPrice(oldPrice * (1 + value / 100));
  if (mode === 'amount') return roundPrice(oldPrice + value);
  return roundPrice(value);
}

/** Mo ta ngan: "Tăng 10%", "Giảm 2.000đ", "Đặt 15.000đ" */
export function describeAdjustment({ mode, value }) {
  const vnd = (n) => `${Math.abs(n).toLocaleString('vi-VN')}đ`;
  if (mode === 'set') return `Đặt giá ${vnd(value)}/giờ`;
  const verb = value > 0 ? 'Tăng' : 'Giảm';
  return mode === 'percent' ? `${verb} ${Math.abs(value)}%` : `${verb} ${vnd(value)}/giờ`;
}

/** Xem truoc: lots [{ id, name, pricePerHour }] -> chi nhung bai doi gia */
export function previewChanges(lots, adj) {
  if (!adj || adj.error) return [];
  return lots
    .map((l) => ({ lotId: l.id, name: l.name, oldPrice: l.pricePerHour, newPrice: adjustPrice(l.pricePerHour, adj) }))
    .filter((c) => c.newPrice !== c.oldPrice)
    .map((c) => ({ ...c, diff: c.newPrice - c.oldPrice }));
}
