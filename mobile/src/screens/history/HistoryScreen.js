// LICH SU DAT CHO & GUI XE: loc nhanh (hom nay / 7 ngay / 30 ngay / thang nay / thang truoc) hoac chon khoang ngay tren lich,
// loc theo loai (tat ca / phien gui xe / dat cho), tong hop chi phi + thoi gian gui, nhom theo ngay.
// Bam phien -> chi tiet phien (phi, bien nhan); bam dat cho -> chi tiet dat cho.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import DateRangeModal from '../../components/DateRangeModal';
import { historyApi } from '../../api/history';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { RESV_STATUS, FAIL_REASONS, formatClock } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { PHASE } from '../../utils/session';
import { PRESETS, dayHeading, formatSeconds, presetRange, toYmd, ymdLabel } from '../../utils/dates';

const KINDS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'sessions', label: 'Gửi xe' },
  { key: 'reservations', label: 'Đặt chỗ' },
];

export default function HistoryScreen({ navigation, route }) {
  const [preset, setPreset] = useState(route.params?.preset || '30d');
  const [range, setRange] = useState(() => presetRange(route.params?.preset || '30d'));
  const [kind, setKind] = useState(route.params?.kind || 'all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picker, setPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await historyApi.list({ ...range, kind }));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range, kind]);
  useEffect(() => {
    const t = setTimeout(() => { setLoading(true); load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load);

  const choosePreset = (key) => { setPreset(key); setRange(presetRange(key)); };

  const sections = useMemo(() => {
    const today = toYmd();
    const by = new Map();
    for (const it of data?.items || []) {
      const h = dayHeading(it.at, today);
      if (!by.has(h)) by.set(h, []);
      by.get(h).push(it);
    }
    return [...by.entries()].map(([title, items]) => ({ title, data: items }));
  }, [data]);

  const s = data?.summary;
  const rangeText = range.from === range.to ? ymdLabel(range.from) : `${ymdLabel(range.from)} – ${ymdLabel(range.to)}`;

  const header = (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} on={preset === p.key} onPress={() => choosePreset(p.key)} />
        ))}
        <Chip label={preset === 'custom' ? rangeText : 'Tuỳ chọn'} icon="calendar-outline" on={preset === 'custom'} onPress={() => setPicker(true)} />
      </ScrollView>
      <View style={styles.tabs}>
        {KINDS.map((k) => (
          <Pressable key={k.key} onPress={() => setKind(k.key)} style={[styles.tab, kind === k.key && styles.tabOn]} accessibilityRole="tab"
            accessibilityState={{ selected: kind === k.key }}>
            <Text style={[styles.tabText, kind === k.key && styles.tabTextOn]}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
      {s ? (
        <View style={styles.summary}>
          <Text style={styles.sumRange}>{rangeText}</Text>
          <View style={styles.sumRow}>
            <Stat value={formatVND(s.totalFee)} label="Tổng phí gửi xe" big />
          </View>
          <View style={styles.sumRow}>
            <Stat value={s.sessions} label="Lượt gửi xe" />
            <Stat value={formatSeconds(s.parkedSeconds)} label="Thời gian gửi" />
            <Stat value={s.reservations} label="Lượt đặt chỗ" />
          </View>
          {s.unpaid > 0 || s.cancelled || s.noShows ? (
            <View style={styles.sumTags}>
              {s.unpaid > 0 ? <Tag icon="alert-circle" text={`Chưa thanh toán ${formatVND(s.unpaid)}`} color="#FCA5A5" /> : null}
              {s.cancelled ? <Tag icon="close-circle" text={`${s.cancelled} lượt huỷ`} /> : null}
              {s.noShows ? <Tag icon="time" text={`${s.noShows} lượt không đến`} color="#FDE68A" /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <ScreenShell navigation={navigation} title="Lịch sử gửi xe & đặt chỗ" subtitle={rangeText}>
      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(it) => `${it.kind}-${it.kind === 'session' ? it.session.id : it.reservation.id}`}
          contentContainerStyle={styles.content}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={header}
          renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
          ListEmptyComponent={!error ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-clear-outline" size={42} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>Không có hoạt động trong khoảng này</Text>
              <Text style={styles.emptySub}>Thử chọn khoảng ngày khác.</Text>
            </View>
          ) : null}
          renderItem={({ item }) => (item.kind === 'session'
            ? <SessionRow s={item.session} onPress={() => navigation.navigate('SessionDetail', { id: item.session.id })} />
            : <ReservationRow r={item.reservation} onPress={() => navigation.navigate('ReservationDetail', { id: item.reservation.id, initial: item.reservation })} />)}
        />
      )}
      <DateRangeModal visible={picker} from={range.from} to={range.to} onClose={() => setPicker(false)}
        onApply={(r) => { setPicker(false); setPreset('custom'); setRange(r); }} />
    </ScreenShell>
  );
}

function SessionRow({ s, onPress }) {
  const p = PHASE[s.phase] || PHASE.parked;
  const pay = s.paid ? { text: 'Đã thanh toán', color: colors.success } : s.cost.final
    ? (s.cost.total > 0 ? { text: 'Chưa thanh toán', color: colors.danger } : { text: 'Miễn phí', color: colors.textMuted })
    : { text: 'Đang tính phí', color: '#2563EB' };
  const end = s.exitedAt || s.endedAt;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={[styles.icon, { backgroundColor: p.bg }]}><Ionicons name="car-sport" size={18} color={p.color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{s.lotName} • Ô #{s.slotNumber}</Text>
        <Text style={styles.sub}>
          {formatClock(s.startedAt)}{end ? ` – ${formatClock(end)}` : ''} • {formatSeconds(s.durationSeconds ?? s.elapsedSeconds)}
          {s.vehiclePlate ? ` • ${s.vehiclePlate}` : ''}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.badge, { color: p.color, backgroundColor: p.bg }]}>{p.short}</Text>
          {s.reservationCode ? <Text style={styles.code}>{s.reservationCode}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{formatVND(s.cost.total)}</Text>
        <Text style={[styles.payState, { color: pay.color }]}>{pay.text}</Text>
      </View>
    </Pressable>
  );
}

function ReservationRow({ r, onPress }) {
  const cfg = RESV_STATUS[r.status] || RESV_STATUS.pending;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={[styles.icon, { backgroundColor: cfg.bg }]}><Ionicons name="ticket" size={18} color={cfg.color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{r.lotName} • Ô #{r.slotNumber}</Text>
        <Text style={styles.sub}>Đặt lúc {formatClock(r.createdAt)} • giữ {r.holdMinutes} phút{r.vehiclePlate ? ` • ${r.vehiclePlate}` : ''}</Text>
        <View style={styles.metaRow}>
          <Text style={[styles.badge, { color: cfg.color, backgroundColor: cfg.bg }]}>{cfg.short || cfg.label}</Text>
          {r.code ? <Text style={styles.code}>{r.code}</Text> : null}
        </View>
        {r.error && FAIL_REASONS[r.error] ? <Text style={styles.reason}>{FAIL_REASONS[r.error]}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
    </Pressable>
  );
}

function Chip({ label, on, onPress, icon }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {icon ? <Ionicons name={icon} size={13} color={on ? colors.primary : colors.textMuted} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ value, label, big }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={big ? styles.statBig : styles.stat} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Tag({ icon, text, color = 'rgba(255,255,255,0.85)' }) {
  return (
    <View style={styles.tag}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.tagText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  chips: { gap: 8, paddingBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.primary },
  tabs: { flexDirection: 'row', backgroundColor: '#EEF2F7', borderRadius: radius.md, padding: 3, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabOn: { backgroundColor: '#fff', shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  tabTextOn: { color: colors.text },
  summary: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16, marginBottom: 6, gap: 10 },
  sumRange: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  sumRow: { flexDirection: 'row', gap: 10 },
  statBig: { color: '#fff', fontSize: 26, fontWeight: '900' },
  stat: { color: '#fff', fontSize: 16, fontWeight: '900' },
  statLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11.5, marginTop: 1 },
  sumTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)' },
  tagText: { fontSize: 11.5, fontWeight: '700' },
  day: { fontSize: 12.5, fontWeight: '800', color: colors.textMuted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  badge: { fontSize: 10.5, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  code: { fontSize: 11, color: '#94A3B8', fontWeight: '700' },
  reason: { fontSize: 11.5, color: colors.danger, marginTop: 3 },
  amount: { fontSize: 14.5, fontWeight: '900', color: colors.text },
  payState: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 50, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.textMuted },
  emptySub: { fontSize: 12.5, color: '#94A3B8' },
});
