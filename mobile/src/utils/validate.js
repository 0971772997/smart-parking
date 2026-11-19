// Kiem tra du lieu phia app (server van kiem tra lai)
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// 0901234567 / +84901234567 / 84 901 234 567 -> 0901234567 ; sai -> null
export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s.-]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (/^84\d{9}$/.test(p)) p = '0' + p.slice(2);
  return /^0\d{9}$/.test(p) ? p : null;
}

export const isUsername = (s) => /^[a-zA-Z0-9_.]{4,30}$/.test(s.trim());
