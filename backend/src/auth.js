const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');

// db (tuy chon): moi request kiem tra tai khoan con ton tai / bi khoa / doi quyen chua (cache 30s)
// -> quan tri khoa tai khoan hay ha quyen admin co hieu luc ngay, khong doi token het han.
const CACHE_MS = 30 * 1000;

function createAuth({ jwtSecret, jwtExpiresIn }, { db } = {}) {
  const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
  const cache = new Map(); // userId -> { at, row }

  async function account(id) {
    const c = cache.get(id);
    if (c && Date.now() - c.at < CACHE_MS) return c.row;
    const row = await db.one('SELECT id, role, locked_at FROM users WHERE id = $1', [id]);
    cache.set(id, { at: Date.now(), row });
    if (cache.size > 5000) cache.clear();
    return row;
  }
  // Quan tri vua doi quyen / khoa -> bo cache cua tai khoan do
  const forget = (id) => cache.delete(Number(id));

  function verify(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'unauthorized', 'Thieu token');
    try {
      const p = jwt.verify(token, jwtSecret);
      return { id: p.sub, role: p.role };
    } catch {
      throw new HttpError(401, 'invalid_token', 'Token khong hop le hoac da het han');
    }
  }

  async function check(u) {
    if (!db) return u;
    const row = await account(u.id);
    if (!row) throw new HttpError(401, 'invalid_token', 'Tai khoan khong ton tai');
    if (row.locked_at) throw new HttpError(403, 'account_locked', 'Tai khoan da bi khoa');
    return { id: row.id, role: row.role };
  }

  function requireAuth(req, _res, next) {
    let u;
    try { u = verify(req); } catch (e) { return next(e); }
    check(u).then((x) => { req.user = x; next(); }, next);
    return undefined;
  }

  // Khong bat buoc dang nhap: co token hop le -> req.user, khong co / sai / bi khoa -> nhu khach
  function optionalAuth(req, _res, next) {
    let u = null;
    try { u = verify(req); } catch { /* khach */ }
    if (!u) return next();
    check(u).then((x) => { req.user = x; next(); }, () => next());
    return undefined;
  }

  function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'admin') return next(new HttpError(403, 'forbidden', 'Chi admin duoc phep'));
    next();
  }

  return { sign, requireAuth, optionalAuth, requireAdmin, forget };
}

module.exports = { createAuth };
