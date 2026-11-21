// Tien ich hien thi phien gui xe + thong bao
import { colors } from '../theme';

// Trang thai phien (phase tu may chu)
export const PHASE = {
  entered: { label: 'Đã vào bãi • Đang tìm ô', short: 'Đã vào bãi', color: '#2563EB', bg: '#EFF6FF', icon: 'enter-outline' },
  parked: { label: 'Đang gửi xe', short: 'Đang gửi', color: colors.success, bg: colors.successSoft, icon: 'car-sport-outline' },
  left: { label: 'Đã rời ô • Chờ ra cổng', short: 'Chờ ra cổng', color: '#7C3AED', bg: '#F3E8FF', icon: 'exit-outline' },
  completed: { label: 'Đã kết thúc', short: 'Kết thúc', color: '#64748B', bg: '#F1F5F9', icon: 'flag-outline' },
};

// Bieu tuong + mau cho tung loai thong bao
export const NOTE_TYPE = {
  session_started: { icon: 'enter', color: '#2563EB' },
  parked: { icon: 'car-sport', color: colors.success },
  wrong_slot: { icon: 'swap-horizontal', color: '#D97706' },
  slot_changed: { icon: 'swap-horizontal', color: '#D97706' },
  not_parked: { icon: 'help-circle', color: '#D97706' },
  near_end: { icon: 'alarm', color: '#D97706' },
  overtime: { icon: 'warning', color: colors.danger },
  fee_changed: { icon: 'trending-up', color: '#D97706' },
  extended: { icon: 'add-circle', color: colors.primary },
  left_slot: { icon: 'receipt', color: '#7C3AED' },
  paid: { icon: 'checkmark-circle', color: colors.success },
  payment_failed: { icon: 'close-circle', color: colors.danger },
  exited: { icon: 'flag', color: '#64748B' },
  reservation_expired: { icon: 'time', color: colors.danger },
};

export const FLAG_LABEL = {
  wrong_slot: 'Đỗ khác ô đã đặt',
  sensor_gap: 'Cảm biến từng mất tín hiệu',
};

/** 3725 -> "1:02:05"; 125 -> "02:05" */
export function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Giay da troi qua tu iso (theo dong ho may) */
export const secondsSince = (iso, now = Date.now()) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 1000) : 0);

/** "vừa xong" / "5 phút trước" / "2 giờ trước" / "21/11" */
export function timeAgo(iso, now = Date.now()) {
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
