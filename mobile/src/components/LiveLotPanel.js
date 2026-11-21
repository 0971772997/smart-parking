// HOAT DONG BAI DO THOI GIAN THUC: so xe trong bai, o trong / co xe / giu cho, barie, luot vao/ra hom nay
// va su kien gan nhat tu cam bien + barie (ESP32). Tu cap nhat khi may chu bao co thay doi (LiveContext).
// props: { lotId, onData?(snapshot) } - onData: man cha cap nhat so do o theo du lieu moi
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { liveApi } from '../api/sessions';
import { useLive, useOnLiveChange } from '../context/LiveContext';
import { colors, radius } from '../theme';
import { timeAgo } from '../utils/session';

const STATE_VI = { free: 'trống', occupied: 'có xe', reserved: 'đang giữ' };
const BY_VI = { app: 'quét mã QR', button: 'nút bấm', auto: 'tự động', serial: 'bảng điều khiển' };

function describe(e) {
  const p = e.payload || {};
  switch (e.type) {
    case 'gate':
      return { icon: p.state === 'open' ? 'git-pull-request' : 'remove', color: p.gate === 'exit' ? '#7C3AED' : colors.primary,
        text: `Barie cổng ${p.gate === 'exit' ? 'ra' : 'vào'} ${p.state === 'open' ? 'mở' : 'đóng'}${p.by ? ` (${BY_VI[p.by] || p.by})` : ''}` };
    case 'slot_changed':
      return { icon: p.state === 'occupied' ? 'car' : 'car-outline', color: p.state === 'occupied' ? colors.danger : colors.success,
        text: `Cảm biến: ô #${p.slot} ${STATE_VI[p.state] || p.state}` };
    case 'entry_rejected':
      return { icon: 'hand-left', color: colors.danger, text: 'Từ chối xe vào: bãi đã hết chỗ' };
    case 'reservation_expired':
      return { icon: 'time', color: '#D97706', text: `Ô #${p.slot}: hết giờ giữ chỗ` };
    default:
      return { icon: 'ellipse', color: colors.textMuted, text: e.type };
  }
}

export default function LiveLotPanel({ lotId, onData }) {
  const { online } = useLive();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const cb = useRef(onData);
  useEffect(() => { cb.current = onData; }, [onData]);

  const load = useCallback(async () => {
    if (!lotId) return;
    try {
      const r = await liveApi.lot(lotId, '', 0);
      setD(r);
      setError(null);
      cb.current?.(r);
    } catch (e) {
      setError(e.message);
    }
  }, [lotId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load);

  if (!d) {
    return (
      <View style={styles.card}>
        {error ? <Text style={styles.err}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Hoạt động thời gian thực</Text>
        <View style={styles.pill}>
          <View style={[styles.dot, { backgroundColor: !online ? '#F59E0B' : d.online ? colors.success : '#94A3B8' }]} />
          <Text style={styles.pillText}>{!online ? 'Mất kết nối' : d.online ? 'Thiết bị online' : 'Thiết bị offline'}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat value={d.carsInLot} label="Xe trong bãi" color={colors.navy} />
        <Stat value={d.freeSlots} label="Ô trống" color={colors.success} />
        <Stat value={d.occupiedSlots} label="Có xe" color={colors.danger} />
        <Stat value={d.reservedSlots} label="Đang giữ" color="#D97706" />
      </View>

      <View style={styles.gates}>
        <Gate label="Cổng vào" state={d.gates?.entry} count={d.today?.entries} unit="lượt vào" />
        <Gate label="Cổng ra" state={d.gates?.exit} count={d.today?.exits} unit="lượt ra" />
      </View>
      {d.today?.rejected ? <Text style={styles.rejected}>Hôm nay từ chối {d.today.rejected} xe do hết chỗ.</Text> : null}

      <Text style={styles.sub}>Sự kiện gần đây (cảm biến & barie)</Text>
      {d.events.length === 0 ? <Text style={styles.muted}>Chưa có sự kiện.</Text> : null}
      {d.events.slice(0, 6).map((e) => {
        const x = describe(e);
        return (
          <View key={e.id} style={styles.ev}>
            <Ionicons name={x.icon} size={14} color={x.color} />
            <Text style={styles.evText} numberOfLines={1}>{x.text}</Text>
            <Text style={styles.evTime}>{timeAgo(e.createdAt)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Stat({ value, label, color }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statNum, { color }]}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Gate({ label, state, count, unit }) {
  const open = state === 'open';
  return (
    <View style={styles.gate}>
      <Ionicons name={open ? 'lock-open' : 'lock-closed'} size={15} color={open ? colors.success : colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.gateLabel}>{label}: {open ? 'đang mở' : 'đóng'}</Text>
        <Text style={styles.gateSub}>{count ?? 0} {unit} hôm nay</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  stats: { flexDirection: 'row', gap: 6 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  statNum: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 10.5, color: colors.textMuted, fontWeight: '700', marginTop: 1 },
  gates: { flexDirection: 'row', gap: 8, marginTop: 10 },
  gate: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#EEF2F7' },
  gateLabel: { fontSize: 12.5, fontWeight: '800', color: colors.text },
  gateSub: { fontSize: 11.5, color: colors.textMuted },
  rejected: { fontSize: 12, color: colors.danger, marginTop: 8, fontWeight: '600' },
  sub: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginTop: 12, marginBottom: 4, letterSpacing: 0.3 },
  muted: { fontSize: 12.5, color: colors.textMuted },
  ev: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  evText: { flex: 1, fontSize: 12.5, color: colors.text },
  evTime: { fontSize: 11, color: '#94A3B8' },
  err: { fontSize: 12.5, color: colors.danger },
});
