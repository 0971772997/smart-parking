const { badRequest } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(body, key, { min = 1, max = 255, optional = false, pattern } = {}) {
  const v = body?.[key];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest('validation_error', `Thieu truong '${key}'`);
  }
  if (typeof v !== 'string') throw badRequest('validation_error', `'${key}' phai la chuoi`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw badRequest('validation_error', `'${key}' dai ${min}-${max} ky tu`);
  if (pattern && !pattern.test(t)) throw badRequest('validation_error', `'${key}' khong hop le`);
  return t;
}

function int(body, key, { min, max, optional = false, def } = {}) {
  const v = body?.[key];
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    if (optional) return null;
    throw badRequest('validation_error', `Thieu truong '${key}'`);
  }
  // Chi nhan so hoac chuoi chu so (chan mang [1], true, '1e3', so vuot gioi han an toan)
  const okType = typeof v === 'number' || (typeof v === 'string' && /^-?\d{1,16}$/.test(v.trim()));
  const n = okType ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw badRequest('validation_error', `'${key}' phai la so nguyen trong khoang ${min}..${max}`);
  }
  return n;
}

const email = (body) => str(body, 'email', { max: 255, pattern: EMAIL_RE }).toLowerCase();

module.exports = { str, int, email };
