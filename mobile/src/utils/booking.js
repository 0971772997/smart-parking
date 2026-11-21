// Tien ich cho dat cho: trang thai, quy tac mac dinh (khi chua tai duoc tu may chu), dinh dang thoi gian
import { colors } from '../theme';

// Giong backend/src/booking.js - chi dung khi GET /reservations/rules loi
export const DEFAULT_RULES = {
  maxActivePerUser: 1,
  hold: { min: 5, max: 120, default: 15, options: [15, 30, 45, 60] },
  duration: { min: 30, max: 1440, default: 120, options: [60, 120, 180, 240, 480] },
  extend: { maxTimes: 2, min: 5, max: 30, options: [10, 15, 30] },
  graceSeconds: 60,
  noShow: { limit: 3, windowDays: 7, suspendHours: 24 },
  me: { noShows: 0, suspendedUntil: null },
};

export const RESV_STATUS = {
  pending: { label: 'Chờ xác nhận', color: '#D97706', bg: '#FFFBEB', icon: 'hourglass-outline' },
  active: { label: 'Đã xác nhận • Đang giữ chỗ', short: 'Đang giữ chỗ', color: '#2563EB', bg: '#EFF6FF', icon: 'shield-checkmark-outline' },
  fulfilled: { label: 'Xe đã vào ô', short: 'Hoàn tất', color: colors.success, bg: colors.successSoft, icon: 'checkmark-circle-outline' },
  cancelled: { label: 'Đã hủy', color: '#64748B', bg: '#F1F5F9', icon: 'close-circle-outline' },
  expired: { label: 'Hết hạn (không đến)', short: 'Hết hạn', color: colors.danger, bg: colors.dangerSoft, icon: 'alert-circle-outline' },
  failed: { label: 'Thất bại', color: colors.danger, bg: colors.dangerSoft, icon: 'warning-outline' },
};

export const isOpen = (r) => r && (r.status === 'active' || r.status === 'pending');

/** Giay con lai den expiresAt (>= 0) */
export const secondsLeft = (iso, now = Date.now()) =>
  iso ? Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000)) : 0;

/** 125 -> "02:05"; 3725 -> "1:02:05" */
export function formatCountdown(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Date | iso -> "07:45" */
export const formatClock = (d) => {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

/** iso -> "07:45 21/11" */
export const formatDateTime = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${formatClock(x)} ${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
};

/** Phi du kien = so gio (lam tron len, toi thieu 1) x gia/gio - giong may chu */
export const estimateFee = (pricePerHour, minutes) =>
  pricePerHour == null ? null : Math.max(1, Math.ceil(minutes / 60)) * pricePerHour;

/** Ly do that bai -> tieng Viet */
export const FAIL_REASONS = {
  device_timeout: 'Thiết bị bãi đỗ không phản hồi',
  slot_not_free: 'Ô đã có xe hoặc đã được giữ',
  pending_timeout: 'Không nhận được xác nhận từ thiết bị',
  no_show: 'Quá giờ giữ chỗ nhưng xe chưa đến',
  left_without_parking: 'Xe đã ra bãi trước khi đỗ vào ô',
};
