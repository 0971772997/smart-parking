// Gioi han so lan thu trong 1 khoang thoi gian (bo nho trong tien trinh - du cho 1 may chu Render)
// Dung cho dang nhap: chi dem lan SAI, dang nhap dung -> xoa dem.
function createLimiter({ windowMs = 15 * 60 * 1000, max = 10, now = () => Date.now() } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  function get(key) {
    const h = hits.get(key);
    if (h && h.resetAt <= now()) { hits.delete(key); return null; }
    return h || null;
  }

  return {
    // Con duoc thu khong? -> { allowed, retryAfter (giay) }
    check(key) {
      const h = get(key);
      if (!h || h.count < max) return { allowed: true, retryAfter: 0 };
      return { allowed: false, retryAfter: Math.ceil((h.resetAt - now()) / 1000) };
    },
    fail(key) {
      const h = get(key) || { count: 0, resetAt: now() + windowMs };
      h.count += 1;
      hits.set(key, h);
      if (hits.size > 10000) { // chong day bo nho
        for (const [k, v] of hits) if (v.resetAt <= now()) hits.delete(k);
      }
      return h.count;
    },
    reset(key) { hits.delete(key); },
    size: () => hits.size,
  };
}

module.exports = { createLimiter };
