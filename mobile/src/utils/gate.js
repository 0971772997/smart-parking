// Ma QR cua CONG (admin hien tai cong, tai xe quet): nhan dien nhanh tren app truoc khi gui may chu
//   SPG1.<id bai base64url>.<E|X>.<het han>.<nonce>.<chu ky>  (may chu moi la noi xac thuc chu ky)

// -> { kind: 'gate', gate: 'entry'|'exit' } | { kind: 'reservation' } | { kind: 'other' }
export function classifyQr(raw) {
  const parts = String(raw || '').trim().split('.');
  if (parts.length === 6 && parts[0] === 'SPG1' && (parts[2] === 'E' || parts[2] === 'X')) {
    return { kind: 'gate', gate: parts[2] === 'E' ? 'entry' : 'exit' };
  }
  if (parts.length === 6 && parts[0] === 'SP1') return { kind: 'reservation' };
  return { kind: 'other' };
}

export const gateLabel = (g) => (g === 'exit' ? 'cổng RA' : 'cổng VÀO');

// Loi quet ma -> { title, help } hien cho TAI XE (tieng Viet, kem cach xu ly)
const DRIVER_ERRORS = {
  qr_invalid: ['Mã QR không hợp lệ', 'Hãy quét đúng mã QR SmartPark hiển thị trên màn hình tại cổng.'],
  qr_expired: ['Mã QR đã đổi', 'Mã ở cổng tự đổi mỗi phút. Hãy quét lại mã đang hiển thị.'],
  lot_not_found: ['Bãi đỗ không tồn tại', 'Mã này thuộc bãi đỗ đã ngừng hoạt động.'],
  no_reservation: ['Bạn chưa đặt chỗ ở bãi này', 'Đặt chỗ ngay trên app rồi quét lại mã tại cổng.'],
  already_entered: ['Xe đã vào bãi', 'Lượt đặt chỗ này đã qua cổng vào. Khi ra hãy quét mã ở cổng RA.'],
  already_exited: ['Xe đã ra bãi', 'Lượt gửi xe đã kết thúc.'],
  not_entered: ['Xe chưa vào bãi', 'Bạn đang quét mã cổng RA. Hãy quét mã ở cổng VÀO trước.'],
  pass_expired: ['Quá hạn ra bãi', 'Liên hệ nhân viên tại cổng để được hỗ trợ.'],
  reservation_expired: ['Đặt chỗ đã hết giờ giữ', 'Hãy đặt chỗ mới rồi quét lại.'],
  reservation_not_active: ['Đặt chỗ không còn hiệu lực', 'Đặt chỗ đã huỷ hoặc hết hạn. Hãy đặt chỗ mới.'],
  still_parked: ['Xe vẫn đang trong ô', 'Hãy lái xe ra khỏi ô đỗ, chờ vài giây rồi quét lại.'],
  payment_required: ['Chưa thanh toán phí', 'Thanh toán trên app để barie tự mở, hoặc trả tiền mặt cho nhân viên.'],
  device_offline: ['Barie đang mất kết nối', 'Liên hệ nhân viên tại cổng để mở barie thủ công.'],
  device_timeout: ['Barie chưa phản hồi', 'Bấm "Thử lại". Nếu vẫn lỗi hãy liên hệ nhân viên.'],
  scan_in_progress: ['Đang xử lý', 'Một lần quét khác đang được xử lý, chờ vài giây.'],
  vehicle_not_found: ['Xe không hợp lệ', 'Chọn lại xe của bạn rồi quét lại.'],
  network_error: ['Mất kết nối mạng', 'Kiểm tra mạng của điện thoại rồi thử lại.'],
  timeout: ['Máy chủ phản hồi chậm', 'Bấm "Thử lại".'],
};

export function driverError(code, fallback) {
  const [title, help] = DRIVER_ERRORS[code] || ['Không mở được barie', fallback || 'Vui lòng thử lại.'];
  return { title, help };
}

export const RETRYABLE = ['device_timeout', 'device_offline', 'network_error', 'timeout', 'scan_in_progress',
  'still_parked', 'qr_expired', 'internal_error'];
