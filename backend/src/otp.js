// OTP gia lap SMS: sinh ma 6 so, het han 5 phut, toi da 5 lan nhap sai, 60s moi gui lai.
// OTP_DEV_MODE (mac dinh bat) -> tra ma ve trong response de demo, vi chua co dich vu SMS.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { HttpError, badRequest } = require('./errors');

const TTL_SEC = 5 * 60;
const RESEND_SEC = 60;
const MAX_ATTEMPTS = 5;

function createOtpService(db, { devMode = true } = {}) {
  async function issue(userId, purpose) {
    const last = await db.one(
      `SELECT EXTRACT(EPOCH FROM now() - created_at)::int AS age FROM otp_codes
       WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`, [userId, purpose]);
    if (last && last.age < RESEND_SEC) {
      throw Object.assign(new HttpError(429, 'otp_too_soon', `Vui long doi ${RESEND_SEC - last.age} giay de gui lai ma`),
        { details: { retryAfter: RESEND_SEC - last.age } });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const row = await db.one(
      `INSERT INTO otp_codes (user_id, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING id`,
      [userId, purpose, await bcrypt.hash(code, 6), TTL_SEC]);
    if (!devMode) console.log(`[OTP] (gui SMS that o day) user=${userId} purpose=${purpose}`);
    return { otpId: row.id, expiresIn: TTL_SEC, resendAfter: RESEND_SEC, ...(devMode && { devCode: code }) };
  }

  // Kiem tra ma; dung -> danh dau da dung va tra ve user_id
  async function verify(otpId, code, purpose) {
    if (typeof otpId !== 'string' || !/^[0-9a-f-]{36}$/i.test(otpId)) throw badRequest('validation_error', "Thieu 'otpId'");
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw badRequest('validation_error', 'Ma OTP gom 6 chu so');
    const otp = await db.one('SELECT * FROM otp_codes WHERE id = $1 AND purpose = $2', [otpId, purpose]);
    if (!otp || otp.used_at) throw badRequest('otp_invalid', 'Ma OTP khong hop le, vui long gui lai ma');
    if (new Date(otp.expires_at) < new Date()) throw badRequest('otp_expired', 'Ma OTP da het han, vui long gui lai ma');
    if (otp.attempts >= MAX_ATTEMPTS) throw badRequest('otp_locked', 'Nhap sai qua nhieu lan, vui long gui lai ma');
    if (!(await bcrypt.compare(code, otp.code_hash))) {
      await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      const left = MAX_ATTEMPTS - otp.attempts - 1;
      throw Object.assign(badRequest('otp_wrong', `Ma OTP khong dung (con ${left} lan thu)`), { details: { attemptsLeft: left } });
    }
    const used = await db.one('UPDATE otp_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING user_id', [otp.id]);
    if (!used) throw badRequest('otp_invalid', 'Ma OTP da duoc su dung');
    return used.user_id;
  }

  return { issue, verify };
}

module.exports = { createOtpService };
