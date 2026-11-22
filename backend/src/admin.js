// Tien ich cho trang quan tri: ghi nhat ky thao tac
async function audit(q, req, action, targetType = null, targetId = null, detail = {}) {
  await q.query(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [req.user?.id || null, action, targetType, targetId == null ? null : String(targetId), detail]);
}

const ACTION_LABEL = {
  'user.update': 'Cập nhật tài khoản', 'user.lock': 'Khoá tài khoản', 'user.unlock': 'Mở khoá tài khoản',
  'user.role': 'Đổi quyền tài khoản', 'user.reset_noshow': 'Gỡ khoá đặt chỗ (không đến)',
  'lot.create': 'Thêm bãi đỗ', 'lot.update': 'Sửa bãi đỗ', 'lot.delete': 'Xoá bãi đỗ', 'lot.price': 'Điều chỉnh giá', 'lot.gate': 'Điều khiển barie',
  'reservation.cancel': 'Huỷ đặt chỗ', 'session.close': 'Kết thúc phiên gửi xe', 'session.collect': 'Thu tiền tại cổng',
  'review.delete': 'Gỡ đánh giá', 'review.reply': 'Phản hồi đánh giá', 'broadcast': 'Gửi thông báo chung',
  'ticket.status': 'Đổi trạng thái yêu cầu hỗ trợ',
};

module.exports = { audit, ACTION_LABEL };
