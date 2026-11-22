// THIET BI NHAN THONG BAO DAY + TUY CHON THONG BAO (gan tai /api)
//   POST   /push/tokens            dang ky / cap nhat token Expo cua thiet bi { token, platform?, deviceName? }
//   DELETE /push/tokens            go token khi dang xuat { token }
//   GET    /notifications/prefs    tuy chon nhan day theo nhom + so thiet bi da dang ky
//   PUT    /notifications/prefs    { reservation?, arrival?, reminder?, payment? } (true/false)
//   POST   /push/test              gui 1 thong bao thu toi moi thiet bi cua toi
const express = require('express');
const { wrap, badRequest } = require('../errors');
const v = require('../validate');
const { notify } = require('../sessions');
const { PREF_KEYS, prefsOf, TOKEN_RE } = require('../push');

module.exports = function pushRoutes({ db, auth, push }) {
  const r = express.Router();
  const user = auth.requireAuth;

  const devices = async (userId) => (await db.query(
    'SELECT platform, device_name, last_error, last_seen_at FROM push_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC', [userId]))
    .rows.map((d) => ({ platform: d.platform, deviceName: d.device_name, lastError: d.last_error, lastSeenAt: d.last_seen_at }));

  r.post('/push/tokens', user, wrap(async (req, res) => {
    const token = v.str(req.body, 'token', { max: 200 });
    if (!TOKEN_RE.test(token)) throw badRequest('invalid_push_token', 'Token thong bao khong hop le');
    const platform = v.str(req.body, 'platform', { max: 10, optional: true });
    const deviceName = v.str(req.body, 'deviceName', { max: 100, optional: true });
    // 1 thiet bi chi thuoc 1 tai khoan: dang nhap tai khoan khac tren cung may -> chuyen token sang tai khoan moi
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform, device_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
         device_name = EXCLUDED.device_name, last_error = NULL, last_seen_at = now()`,
      [req.user.id, token, platform || null, deviceName || null]);
    res.status(201).json({ ok: true, devices: await devices(req.user.id) });
  }));

  r.delete('/push/tokens', user, wrap(async (req, res) => {
    const token = v.str(req.body, 'token', { max: 200 });
    await db.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, req.user.id]);
    res.json({ ok: true });
  }));

  r.get('/notifications/prefs', user, wrap(async (req, res) => {
    const u = await db.one('SELECT notification_prefs FROM users WHERE id = $1', [req.user.id]);
    res.json({ prefs: prefsOf(u?.notification_prefs), devices: await devices(req.user.id) });
  }));

  r.put('/notifications/prefs', user, wrap(async (req, res) => {
    const patch = {};
    for (const k of PREF_KEYS) {
      if (req.body?.[k] === undefined) continue;
      if (typeof req.body[k] !== 'boolean') throw badRequest('validation_error', `'${k}' phai la true/false`);
      patch[k] = req.body[k];
    }
    const u = await db.one(
      `UPDATE users SET notification_prefs = notification_prefs || $2::jsonb WHERE id = $1 RETURNING notification_prefs`,
      [req.user.id, JSON.stringify(patch)]);
    res.json({ prefs: prefsOf(u.notification_prefs) });
  }));

  // Gui thu: tao 1 thong bao trong app + day ngay (bo qua tuy chon) -> app kiem tra ca 3 trang thai
  r.post('/push/test', user, wrap(async (req, res) => {
    const n = await notify(db, { userId: req.user.id, type: 'test', key: null,
      title: 'Thông báo thử từ SmartPark', body: 'Nếu bạn thấy thông báo này khi đã thoát app hoặc tắt màn hình, thông báo đẩy đã hoạt động.' });
    const result = push ? await push.sendNotification(n, { force: true }) : { sent: 0, failed: 0, skipped: 'disabled' };
    res.json({ ...result, devices: (await devices(req.user.id)).length });
  }));

  return r;
};
