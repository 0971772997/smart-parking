import { request } from './client';

export const authApi = {
  login: (email, password, opts) => request('/auth/login', { method: 'POST', body: { email, password }, ...opts }),
  me: (opts) => request('/auth/me', opts),

  // OTP: purpose = 'login_phone' | 'find_id' (username + phone) | 'reset_password' (email)
  requestOtp: (body, opts) => request('/auth/otp', { method: 'POST', body, ...opts }),
  loginWithPhone: (otpId, code) => request('/auth/login/phone', { method: 'POST', body: { otpId, code } }),
  findId: (otpId, code) => request('/auth/find-id', { method: 'POST', body: { otpId, code } }),
  resetPassword: (otpId, code, newPassword, confirmPassword) =>
    request('/auth/reset-password', { method: 'POST', body: { otpId, code, newPassword, confirmPassword } }),
};
