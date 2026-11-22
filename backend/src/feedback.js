// DANH GIA BAI DO + HO TRO / BAO CAO SU CO: danh muc dung chung cho route va app (GET /api/support/info)
const crypto = require('crypto');

// The (tag) nhanh khi danh gia: tich cuc / can cai thien
const REVIEW_TAGS = {
  clean: 'Sạch sẽ', safe: 'An ninh tốt', easy_find: 'Dễ tìm chỗ', staff: 'Nhân viên thân thiện',
  price: 'Giá hợp lý', gate_fast: 'Qua cổng nhanh', accurate: 'Cảm biến chính xác',
  dirty: 'Chưa sạch sẽ', narrow: 'Lối đi chật', hard_find: 'Khó tìm ô', slow_gate: 'Barie chậm',
  wrong_status: 'Trạng thái ô sai', expensive: 'Giá cao', dark: 'Thiếu ánh sáng',
};

// Danh muc yeu cau ho tro / su co. high = uu tien cao tu dong
const SUPPORT_CATEGORIES = {
  support: {
    account: 'Tài khoản & đăng nhập', booking: 'Đặt chỗ', payment: 'Thanh toán & hoàn tiền',
    receipt: 'Biên nhận / hoá đơn', app: 'Lỗi ứng dụng', other: 'Khác',
  },
  incident: {
    gate: 'Barie / cổng không mở', sensor: 'Cảm biến báo sai', slot_taken: 'Ô đã đặt bị chiếm',
    fee: 'Tính phí sai', damage: 'Xe bị va quẹt / hư hỏng', safety: 'An ninh / mất cắp', facility: 'Cơ sở vật chất hư hỏng',
    other: 'Sự cố khác',
  },
};
const HIGH_PRIORITY = new Set(['damage', 'safety', 'gate']);
const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const CONTACT = {
  hotline: '1900 6868', hotlineHours: '24/7', email: 'hotro@smartpark.vn', zalo: '0901234567',
  officeHours: '07:00 – 22:00 hằng ngày', responseTime: 'Phản hồi yêu cầu trong vòng 2 giờ (sự cố khẩn cấp: gọi hotline).',
};

const FAQ = [
  { q: 'Barie không mở khi quét mã QR?', a: 'Mã QR chỉ có hiệu lực 2 phút – hãy mở lại mã mới trên app. Nếu vẫn không được, gọi hotline hoặc gửi báo cáo sự cố "Barie / cổng không mở" để nhân viên mở cổng.' },
  { q: 'Ô đã đặt bị xe khác chiếm?', a: 'Đỗ tạm vào ô trống gần nhất – hệ thống tự ghi nhận "đỗ khác ô". Gửi báo cáo "Ô đã đặt bị chiếm" kèm số ô để chúng tôi xử lý.' },
  { q: 'Phí được tính thế nào?', a: 'Phí tính từ lúc xe qua cổng vào, làm tròn lên theo giờ (tối thiểu 1 giờ). Quá giờ dự kiến hơn 5 phút: phụ phí 50% giá/giờ cho mỗi giờ quá hạn.' },
  { q: 'Thanh toán MoMo bị trừ tiền nhưng app báo chưa thanh toán?', a: 'Kéo để tải lại màn thanh toán – app tự tra cứu kết quả từ MoMo. Sau 15 phút vẫn chưa cập nhật, gửi yêu cầu "Thanh toán & hoàn tiền" kèm mã đơn.' },
  { q: 'Huỷ đặt chỗ có mất phí không?', a: 'Huỷ trước khi hết giờ giữ chỗ là miễn phí. Không đến quá 3 lần trong 7 ngày sẽ bị tạm khoá đặt chỗ 24 giờ.' },
  { q: 'Lấy lại biên nhận ở đâu?', a: 'Vào Hồ sơ → Lịch sử giao dịch, chọn giao dịch để xem, chia sẻ hoặc in biên nhận điện tử.' },
];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ticketCode = (kind) => `${kind === 'incident' ? 'SC' : 'HT'}-`
  + Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

// Ten hien thi khi danh gia: "Nguyễn V." / "demo_u***" (khong lo email)
function displayName(u) {
  const full = (u.full_name || '').trim();
  if (full) {
    const parts = full.split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  }
  const base = u.username || (u.email || '').split('@')[0] || 'Tài xế';
  return base.length > 4 ? `${base.slice(0, 4)}***` : base;
}

module.exports = { REVIEW_TAGS, SUPPORT_CATEGORIES, HIGH_PRIORITY, TICKET_STATUSES, CONTACT, FAQ, ticketCode, displayName };
