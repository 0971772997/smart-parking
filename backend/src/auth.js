const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');

function createAuth({ jwtSecret, jwtExpiresIn }) {
  const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });

  function requireAuth(req, _res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return next(new HttpError(401, 'unauthorized', 'Thieu token'));
    try {
      const p = jwt.verify(token, jwtSecret);
      req.user = { id: p.sub, role: p.role };
      next();
    } catch {
      next(new HttpError(401, 'invalid_token', 'Token khong hop le hoac da het han'));
    }
  }

  // Khong bat buoc dang nhap: co token hop le -> req.user, khong co / sai -> bo qua (route cong khai)
  function optionalAuth(req, _res, next) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) {
      try {
        const p = jwt.verify(h.slice(7), jwtSecret);
        req.user = { id: p.sub, role: p.role };
      } catch { /* token sai -> nhu khach */ }
    }
    next();
  }

  function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'admin') return next(new HttpError(403, 'forbidden', 'Chi admin duoc phep'));
    next();
  }

  return { sign, requireAuth, optionalAuth, requireAdmin };
}

module.exports = { createAuth };
