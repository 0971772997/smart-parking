import { request } from './client';

export const authApi = {
  login: (identifier, password, opts) =>
    request('/auth/login', { method: 'POST', body: { identifier, password }, ...opts }),
  me: (opts) => request('/auth/me', opts),
  updateProfile: (body, opts) => request('/auth/me', { method: 'PATCH', body, ...opts }),
  register: (body, opts) => request('/auth/register', { method: 'POST', body, ...opts }),
  social: (provider, token) => request('/auth/social', { method: 'POST', body: { provider, token } }),

  // OTP: purpose = 'reset_password' (email)
  requestOtp: (body, opts) => request('/auth/otp', { method: 'POST', body, ...opts }),
  resetPassword: (otpId, code, newPassword, confirmPassword) =>
    request('/auth/reset-password', { method: 'POST', body: { otpId, code, newPassword, confirmPassword } }),
};
