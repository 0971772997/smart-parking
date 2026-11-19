// Goi API backend (Render). Loi tu server duoc doi thanh thong bao tieng Viet theo ma loi.
export const API_URL = 'https://smart-parking-api-2ro3.onrender.com/api';

const MESSAGES = {
  network_error: 'Không kết nối được máy chủ. Kiểm tra Internet và thử lại.',
  timeout: 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.',
  validation_error: 'Thông tin chưa hợp lệ.',
  invalid_credentials: 'Email hoặc mật khẩu không đúng.',
  invalid_token: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  unauthorized: 'Vui lòng đăng nhập.',
  account_not_found: 'Không tìm thấy tài khoản phù hợp.',
  otp_too_soon: 'Bạn vừa yêu cầu mã. Vui lòng đợi rồi gửi lại.',
  otp_wrong: 'Mã OTP không đúng.',
  otp_expired: 'Mã OTP đã hết hạn. Vui lòng gửi lại mã.',
  otp_invalid: 'Mã OTP không hợp lệ. Vui lòng gửi lại mã.',
  otp_locked: 'Nhập sai quá nhiều lần. Vui lòng gửi lại mã.',
  password_mismatch: 'Mật khẩu xác nhận không khớp.',
  email_taken: 'Email đã được đăng ký.',
  username_taken: 'Tên đăng nhập đã tồn tại.',
  social_not_configured: 'Đăng nhập mạng xã hội chưa được cấu hình trên máy chủ.',
  social_token_invalid: 'Không xác minh được tài khoản mạng xã hội. Vui lòng thử lại.',
  internal_error: 'Máy chủ gặp sự cố. Vui lòng thử lại sau.',
};

export class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let authToken = null;
export const setAuthToken = (t) => { authToken = t; };

// onSlow: goi khi request > 4s (Render free dang "thuc day")
export async function request(path, { method = 'GET', body, timeoutMs = 70000, onSlow } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const slowTimer = onSlow ? setTimeout(onSlow, 4000) : null;
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const code = e.name === 'AbortError' ? 'timeout' : 'network_error';
    throw new ApiError(code, MESSAGES[code], 0);
  } finally {
    clearTimeout(timer);
    if (slowTimer) clearTimeout(slowTimer);
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* body khong phai JSON */ }
  if (!res.ok) {
    const code = data?.error || 'internal_error';
    let msg = MESSAGES[code] || data?.message || MESSAGES.internal_error;
    if (code === 'otp_wrong' && data?.details?.attemptsLeft !== undefined) {
      msg = `Mã OTP không đúng (còn ${data.details.attemptsLeft} lần thử).`;
    }
    if (code === 'otp_too_soon' && data?.details?.retryAfter) {
      msg = `Vui lòng đợi ${data.details.retryAfter} giây để gửi lại mã.`;
    }
    throw new ApiError(code, msg, res.status, data?.details);
  }
  return data;
}
