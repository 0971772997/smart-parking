// Goi API backend (Render). Loi tu server duoc doi thanh thong bao tieng Viet theo ma loi.
import { Platform } from 'react-native';

const PROD_API_URL = 'https://smart-parking-api-2ro3.onrender.com/api';
// Chi khi phat trien tren web: localStorage.sp_api_url = 'http://localhost:3100/api' -> test voi API chay tren may
// (khong anh huong app tren dien thoai / ban build)
const DEV_API_URL = __DEV__ && Platform.OS === 'web' ? globalThis.localStorage?.getItem('sp_api_url') : null;
export const API_URL = DEV_API_URL || PROD_API_URL;

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
  plate_taken: 'Biển số này đã được đăng ký.',
  schedule_not_found: 'Không tìm thấy lịch gửi xe (có thể đã bị xoá).',
  schedule_limit: 'Bạn đã đạt tối đa 20 lịch gửi xe. Hãy xoá bớt lịch cũ.',
  lot_not_found: 'Không tìm thấy bãi đỗ.',
  vehicle_not_found: 'Xe không thuộc tài khoản của bạn.',
  already_has_reservation: 'Bạn đang có 1 đặt chỗ chưa dùng.',
  slot_not_free: 'Ô đỗ vừa có người đặt. Vui lòng thử lại.',
  slot_not_found: 'Không tìm thấy ô đỗ.',
  slot_zone_mismatch: 'Ô đã chọn không thuộc khu vực này.',
  zone_not_found: 'Không tìm thấy khu vực đỗ.',
  zone_full: 'Khu vực này đã hết ô trống. Hãy chọn khu khác.',
  lot_full: 'Bãi đỗ đã hết ô trống.',
  booking_suspended: 'Tài khoản tạm bị khoá đặt chỗ do không đến nhiều lần.',
  reservation_not_found: 'Không tìm thấy lượt đặt chỗ.',
  reservation_not_active: 'Lượt đặt chỗ này không còn hiệu lực.',
  reservation_expired: 'Lượt đặt chỗ đã hết giờ giữ chỗ.',
  extend_limit: 'Bạn đã gia hạn tối đa số lần cho phép.',
  not_reserved: 'Thiết bị không còn giữ ô này.',
  device_offline: 'Thiết bị bãi đỗ đang mất kết nối.',
  device_timeout: 'Thiết bị bãi đỗ không phản hồi. Vui lòng thử lại.',
  // Ma QR qua cong
  qr_invalid: 'Mã QR không hợp lệ (không phải mã của SmartPark hoặc đã bị chỉnh sửa).',
  qr_expired: 'Mã QR đã hết hạn. Tài xế cần mở lại mã mới trên app.',
  wrong_lot: 'Mã QR thuộc bãi đỗ khác.',
  wrong_gate: 'Mã QR không đúng cổng (mã vào dùng ở cổng vào, mã ra dùng ở cổng ra).',
  already_entered: 'Xe đã qua cổng vào bằng lượt đặt chỗ này.',
  already_exited: 'Xe đã ra bãi bằng lượt đặt chỗ này.',
  not_entered: 'Xe chưa qua cổng vào.',
  pass_expired: 'Mã ra bãi đã quá thời hạn sử dụng.',
  still_parked: 'Xe vẫn đang ở trong ô đỗ (cảm biến chưa ghi nhận xe rời ô).',
  payment_required: 'Chưa thanh toán phí gửi xe.',
  scan_in_progress: 'Mã này đang được xử lý ở một lần quét khác.',
  session_not_found: 'Không tìm thấy lượt đỗ.',
  session_ended: 'Phiên gửi xe đã kết thúc.',
  session_not_extendable: 'Phiên gửi xe này không gia hạn được.',
  extend_too_long: 'Tổng thời gian gửi xe tối đa 24 giờ.',
  session_not_ended: 'Xe chưa rời bãi, chưa thanh toán được.',
  already_paid: 'Lượt đỗ này đã được thanh toán.',
  no_payment_needed: 'Lượt gửi xe này được miễn phí, không cần thanh toán.',
  amount_too_small: 'Số tiền quá nhỏ để thanh toán qua cổng.',
  gateway_error: 'Cổng thanh toán từ chối tạo giao dịch. Vui lòng thử lại hoặc chọn phương thức khác.',
  gateway_unavailable: 'Không kết nối được cổng thanh toán MoMo. Vui lòng thử lại sau.',
  use_gateway: 'Vui lòng thanh toán qua cổng thanh toán.',
  order_not_found: 'Không tìm thấy đơn thanh toán.',
  payment_not_found: 'Không tìm thấy giao dịch.',
  receipt_not_found: 'Không tìm thấy biên nhận.',
  invalid_gate: 'Cổng không hợp lệ.',
  forbidden: 'Chỉ nhân viên / quản trị viên được dùng chức năng này.',
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
