// THE PHIEN GUI XE DANG HOAT DONG (Home): vi tri do, gio bat dau, dong ho chay, phi hien tai, canh bao qua gio
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatClock } from '../utils/booking';
import { formatVND } from '../utils/schedules';
import { PHASE, formatElapsed, secondsSince } from '../utils/session';
import { radius } from '../theme';

export default function ActiveSessionCard({ session: s, onPress }) {
  const [now, setNow] = useState(() => Date.now());
  const open = !s.cost?.final;
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const cfg = PHASE[s.phase] || PHASE.parked;
  const elapsed = open ? secondsSince(s.startedAt, now) : s.durationSeconds ?? s.elapsedSeconds;
  const toEnd = s.plannedEndAt ? Math.round((new Date(s.plannedEndAt).getTime() - now) / 1000) : null;
  const overtime = open && toEnd !== null && toEnd < 0;
  const nearEnd = open && toEnd !== null && toEnd >= 0 && toEnd <= 15 * 60;
  const due = s.phase === 'left' && s.amountDue > 0;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Xem phiên gửi xe đang hoạt động"
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.92 }]}>
      <LinearGradient colors={overtime ? ['#7F1D1D', '#450A0A'] : ['#0F3D2E', '#052E1F']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.top}>
          <View style={styles.badge}>
            <View style={styles.dot} />
            <Text style={styles.badgeText}>PHIÊN GỬI XE • {cfg.short.toUpperCase()}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#A7F3D0" />
        </View>

        <View style={styles.main}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lot} numberOfLines={1}>{s.lotName}</Text>
            <Text style={styles.pos}>Khu {s.zone || '—'} • Ô #{s.slotNumber}{s.vehiclePlate ? ` • ${s.vehiclePlate}` : ''}</Text>
            <Text style={styles.since}>Bắt đầu {formatClock(s.startedAt)}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>
            <Text style={styles.fee}>{formatVND(s.cost?.total)}</Text>
            <Text style={styles.feeLabel}>{open ? 'phí hiện tại' : s.paid ? 'đã thanh toán' : 'cần thanh toán'}</Text>
          </View>
        </View>

        {overtime || nearEnd || due || s.phase === 'entered' ? (
          <View style={[styles.alert, overtime && styles.alertDanger]}>
            <Ionicons name={overtime ? 'warning' : due ? 'wallet' : nearEnd ? 'alarm' : 'navigate'} size={14} color="#fff" />
            <Text style={styles.alertText}>
              {overtime ? `Quá giờ ${formatElapsed(-toEnd)} – phụ phí đang được tính. Gia hạn ngay.`
                : due ? `Xe đã rời ô. Thanh toán ${formatVND(s.amountDue)} để ra cổng.`
                  : nearEnd ? `Còn ${Math.ceil(toEnd / 60)} phút đến giờ dự kiến (${formatClock(s.plannedEndAt)}).`
                    : `Mời đến khu ${s.zone || '—'}, ô #${s.slotNumber}.`}
            </Text>
          </View>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  card: { borderRadius: radius.lg, padding: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  badgeText: { fontSize: 10.5, fontWeight: '900', color: '#D1FAE5', letterSpacing: 0.8 },
  main: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 12, gap: 10 },
  lot: { fontSize: 16, fontWeight: '800', color: '#fff' },
  pos: { fontSize: 13, color: '#A7F3D0', marginTop: 3, fontWeight: '700' },
  since: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 3 },
  right: { alignItems: 'flex-end' },
  timer: { fontSize: 26, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'] },
  fee: { fontSize: 15, fontWeight: '900', color: '#FDE68A', marginTop: 2 },
  feeLabel: { fontSize: 10.5, color: 'rgba(255,255,255,0.65)' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, padding: 9, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.14)' },
  alertDanger: { backgroundColor: 'rgba(239,68,68,0.35)' },
  alertText: { flex: 1, fontSize: 12.5, color: '#fff', fontWeight: '600' },
});
