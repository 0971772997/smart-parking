const express = require('express');
const bcrypt = require('bcryptjs');
const { wrap, conflict, notFound, badRequest, HttpError } = require('../errors');
const v = require('../validate');
const map = require('../mappers');
const { createOtpService } = require('../otp');

const USERNAME_RE = /^[a-zA-Z0-9_.]{4,30}$/;

// Chuan hoa SDT Viet Nam: bo ky tu thua, +84/84 -> 0. Tra ve null neu sai dinh dang.
function normalizePhone(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let p = String(raw).replace(/[\s.-]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (/^84\d{9}$/.test(p)) p = '0' + p.slice(2);
  return /^0\d{9}$/.test(p) ? p : undefined;
}
function phone(body, key = 'phone', { optional = false } = {}) {
  const p = normalizePhone(body?.[key]);
  if (p === null && optional) return null;
  if (!p) throw badRequest('validation_error', 'So dien thoai khong hop le (vd: 0901234567)');
  return p;
}

const maskEmail = (e) => e.replace(/^(.{2})[^@]*(@.*)$/, (_, a, b) => `${a}***${b}`);
const maskPhone = (p) => (p ? p.slice(0, 3) + '****' + p.slice(-3) : null);

module.exports = function authRoutes({ db, auth, otpDevMode = true, social }) {
  const r = express.Router();
  const otp = createOtpService(db, { devMode: otpDevMode });

  r.post('/register', wrap(async (req, res) => {
    const username = v.str(req.body, 'username', { pattern: USERNAME_RE });
    const email = v.email(req.body);
    const password = v.str(req.body, 'password', { min: 6, max: 72 });
    if (req.body.confirmPassword !== undefined && req.body.confirmPassword !== req.body.password) {
      throw badRequest('password_mismatch', 'Mat khau xac nhan khong khop');
    }
    const fullName = v.str(req.body, 'fullName', { max: 100, optional: true });
    const ph = phone(req.body, 'phone', { optional: true });

    const hash = await bcrypt.hash(password, 10);
    try {
      const u = await db.one(
        `INSERT INTO users (username, email, password_hash, full_name, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [username, email, hash, fullName, ph]);
      res.status(201).json({ token: auth.sign(u), user: map.user(u) });
    } catch (e) {
      if (e.code === '23505' && /username/.test(e.constraint)) throw conflict('username_taken', 'Ten dang nhap da ton tai');
      if (e.code === '23505') throw conflict('email_taken', 'Email da duoc dang ky');
      throw e;
    }
  }));

  // Dang nhap bang Email HOAC So dien thoai HOAC Ten dang nhap + mat khau
  r.post('/login', wrap(async (req, res) => {
    const rawId = req.body?.identifier || req.body?.email || req.body?.phone;
    if (!rawId || typeof rawId !== 'string') {
      throw badRequest('validation_error', 'Vui long nhap email hoac so dien thoai');
    }
    const password = v.str(req.body, 'password', { max: 72 });
    const cleanId = rawId.trim().toLowerCase();
    const ph = normalizePhone(rawId);

    const u = await db.one(
      `SELECT * FROM users 
       WHERE lower(email) = $1 
          OR ($2::varchar IS NOT NULL AND phone = $2)
          OR lower(username) = $1`,
      [cleanId, ph || null]
    );
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      throw new HttpError(401, 'invalid_credentials', 'Email/SDT hoac mat khau khong dung');
    }
    res.json({ token: auth.sign(u), user: map.user(u) });
  }));

  // ---------- Dang nhap Google / Facebook ----------
  // body: { provider: 'google', token: <idToken> } | { provider: 'facebook', token: <accessToken> }
  r.post('/social', wrap(async (req, res) => {
    if (!social) throw new HttpError(503, 'social_not_configured', 'Dang nhap mang xa hoi chua duoc cau hinh');
    const provider = req.body?.provider;
    const profile = await social.verify(provider, req.body?.token);
    const col = provider === 'google' ? 'google_id' : 'facebook_id';

    // 1. Da tung dang nhap bang tai khoan nay
    let u = await db.one(`SELECT * FROM users WHERE ${col} = $1`, [profile.providerId]);
    let isNew = false;
    // 2. Trung email voi tai khoan da co -> lien ket
    if (!u && profile.email) {
      u = await db.one(
        `UPDATE users SET ${col} = $2, avatar_url = COALESCE(avatar_url, $3) WHERE email = $1 RETURNING *`,
        [profile.email.toLowerCase(), profile.providerId, profile.avatar || null]);
    }
    // 3. Tao tai khoan moi
    if (!u) {
      const email = (profile.email || `${provider}_${profile.providerId}@users.smartpark.local`).toLowerCase();
      const base = ((profile.email || '').split('@')[0] || (profile.name || provider))
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
        .toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20).padEnd(4, '0');
      const hash = await bcrypt.hash(require('crypto').randomBytes(24).toString('hex'), 10);
      for (let i = 0; i < 5 && !u; i++) {
        const username = i === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
        try {
          u = await db.one(
            `INSERT INTO users (username, email, password_hash, full_name, ${col}, avatar_url)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [username, email, hash, profile.name || null, profile.providerId, profile.avatar || null]);
          isNew = true;
        } catch (e) {
          if (!(e.code === '23505' && /username/.test(e.constraint))) throw e;
        }
      }
      if (!u) throw new HttpError(500, 'internal_error', 'Khong tao duoc ten dang nhap');
    }
    res.json({ token: auth.sign(u), user: map.user(u), isNew });
  }));

  // ---------- OTP ----------
  // B1: xin ma. purpose: login_phone | find_id (username + phone), reset_password (email)
  r.post('/otp', wrap(async (req, res) => {
    const purpose = req.body?.purpose;
    let u;
    if (purpose === 'login_phone' || purpose === 'find_id') {
      const username = v.str(req.body, 'username', { max: 30 });
      const ph = phone(req.body);
      u = await db.one('SELECT id, phone FROM users WHERE lower(username) = lower($1) AND phone = $2', [username, ph]);
      if (!u) throw notFound('account_not_found', 'Khong tim thay tai khoan voi ten dang nhap va so dien thoai nay');
    } else if (purpose === 'reset_password') {
      const email = v.email(req.body);
      u = await db.one('SELECT id, phone FROM users WHERE email = $1', [email]);
      if (!u) throw notFound('account_not_found', 'Email chua duoc dang ky');
    } else {
      throw badRequest('validation_error', "purpose phai la 'login_phone', 'find_id' hoac 'reset_password'");
    }
    const out = await otp.issue(u.id, purpose);
    res.status(201).json({ ...out, sentTo: maskPhone(u.phone) || 'email' });
  }));

  // B2a: dang nhap bang ten + SDT
  r.post('/login/phone', wrap(async (req, res) => {
    const userId = await otp.verify(req.body?.otpId, req.body?.code, 'login_phone');
    const u = await db.one('SELECT * FROM users WHERE id = $1', [userId]);
    res.json({ token: auth.sign(u), user: map.user(u) });
  }));

  // B2b: tim ID (email)
  r.post('/find-id', wrap(async (req, res) => {
    const userId = await otp.verify(req.body?.otpId, req.body?.code, 'find_id');
    const u = await db.one('SELECT email, username, created_at FROM users WHERE id = $1', [userId]);
    res.json({ email: u.email, maskedEmail: maskEmail(u.email), username: u.username, createdAt: u.created_at });
  }));

  // B2c: dat lai mat khau
  r.post('/reset-password', wrap(async (req, res) => {
    const newPassword = v.str(req.body, 'newPassword', { min: 6, max: 72 });
    if (req.body.confirmPassword !== undefined && req.body.confirmPassword !== newPassword) {
      throw badRequest('password_mismatch', 'Mat khau xac nhan khong khop');
    }
    const userId = await otp.verify(req.body?.otpId, req.body?.code, 'reset_password');
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await bcrypt.hash(newPassword, 10)]);
    res.json({ ok: true });
  }));

  // ---------- Tai khoan ----------
  r.get('/me', auth.requireAuth, wrap(async (req, res) => {
    const u = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!u) throw new HttpError(401, 'invalid_token', 'Tai khoan khong ton tai');
    res.json(map.user(u));
  }));

  r.patch('/me', auth.requireAuth, wrap(async (req, res) => {
    const fullName = v.str(req.body, 'fullName', { max: 100, optional: true });
    const ph = phone(req.body, 'phone', { optional: true });
    const u = await db.one(
      `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone) WHERE id = $1 RETURNING *`,
      [req.user.id, fullName, ph]);
    res.json(map.user(u));
  }));

  return r;
};

module.exports.normalizePhone = normalizePhone;
