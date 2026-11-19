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

  function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'admin') return next(new HttpError(403, 'forbidden', 'Chi admin duoc phep'));
    next();
  }

  return { sign, requireAuth, requireAdmin };
}

module.exports = { createAuth };
