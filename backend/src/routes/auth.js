const express = require('express');
const bcrypt = require('bcryptjs');
const { wrap, conflict, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');

module.exports = function authRoutes({ db, auth }) {
  const r = express.Router();

  r.post('/register', wrap(async (req, res) => {
    const email = v.email(req.body);
    const password = v.str(req.body, 'password', { min: 6, max: 72 });
    const fullName = v.str(req.body, 'fullName', { max: 100 });
    const phone = v.str(req.body, 'phone', { max: 20, optional: true, pattern: /^[0-9+ ]+$/ });

    const hash = await bcrypt.hash(password, 10);
    let u;
    try {
      u = await db.one(
        `INSERT INTO users (email, password_hash, full_name, phone) VALUES ($1, $2, $3, $4) RETURNING *`,
        [email, hash, fullName, phone],
      );
    } catch (e) {
      if (e.code === '23505') throw conflict('email_taken', 'Email da duoc dang ky');
      throw e;
    }
    res.status(201).json({ token: auth.sign(u), user: map.user(u) });
  }));

  r.post('/login', wrap(async (req, res) => {
    const email = v.email(req.body);
    const password = v.str(req.body, 'password', { max: 72 });
    const u = await db.one('SELECT * FROM users WHERE email = $1', [email]);
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'Sai email hoac mat khau');
    }
    res.json({ token: auth.sign(u), user: map.user(u) });
  }));

  r.get('/me', auth.requireAuth, wrap(async (req, res) => {
    const u = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!u) throw new HttpError(401, 'invalid_token', 'Tai khoan khong ton tai');
    res.json(map.user(u));
  }));

  return r;
};
