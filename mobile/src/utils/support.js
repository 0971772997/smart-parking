// Hien thi yeu cau ho tro / bao cao su co
import { colors } from '../theme';

export const TICKET_STATUS = {
  open: { label: 'Đã tiếp nhận', color: '#2563EB', bg: '#EFF6FF' },
  in_progress: { label: 'Đang xử lý', color: '#D97706', bg: '#FFFBEB' },
  resolved: { label: 'Đã giải quyết', color: colors.success, bg: colors.successSoft },
  closed: { label: 'Đã đóng', color: '#64748B', bg: '#F1F5F9' },
};

// Giong backend/src/feedback.js - dung khi chua tai duoc /support/info
export const DEFAULT_CATEGORIES = {
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

export const CATEGORY_ICON = {
  account: 'person-circle-outline', booking: 'ticket-outline', payment: 'wallet-outline', receipt: 'receipt-outline',
  app: 'phone-portrait-outline', other: 'ellipsis-horizontal-circle-outline',
  gate: 'git-commit-outline', sensor: 'radio-outline', slot_taken: 'car-outline', fee: 'calculator-outline',
  damage: 'construct-outline', safety: 'shield-outline', facility: 'business-outline',
};
