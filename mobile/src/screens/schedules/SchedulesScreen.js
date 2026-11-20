// LICH GUI XE: thoi quen gui xe cua tai xe (vd: Di lam - Bai Hai Chau luc 07:30, T2-T6)
// - Danh sach lich da dang ky, mo rong / thu gon de xem chi tiet
// - Them / Sua (ScheduleForm, UI-005) / Xoa (hop thoai xac nhan) / Bat-tat nhanh
// - Loc: tim kiem, trang thai (Hom nay / Dang bat / Tam tat), theo bai do; sap xep
// - Tinh trang o trong truc tiep cua bai + Dat cho nhanh theo lich (giu cho dung xe, dung so phut)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import ConfirmDialog from '../../components/ConfirmDialog';
import Notice from '../../components/Notice';
import { schedulesApi } from '../../api/schedules';
import { lotsApi } from '../../api/lots';
import { reservationsApi } from '../../api/reservations';
import { colors, radius, shadow } from '../../theme';
import { daysLabel, formatDuration, formatVND, isoDay, nextArrival, WEEKDAYS } from '../../utils/schedules';

const STATUS_FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'today', label: 'Hôm nay' },
  { key: 'active', label: 'Đang bật' },
  { key: 'paused', label: 'Tạm tắt' },
];

const SORTS = [
  { key: 'time', label: 'Giờ gửi xe' },
  { key: 'next', label: 'Sắp đến giờ' },
  { key: 'name', label: 'Tên A–Z' },
];

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export default function SchedulesScreen({ navigation, route }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [lotFilter, setLotFilter] = useState(null);
  const [sort, setSort] = useState('time');
  const [toast, setToast] = useState(null); // { type, text }
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [reservingId, setReservingId] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((type, text) => {
    clearTimeout(toastTimer.current);
    setToast({ type, text });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    try {
      const data = await schedulesApi.list();
      setSchedules(data || []);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Tai lai moi khi quay ve man hinh (sau khi them / sua) + tu dong bo 10s (so o trong cua bai)
  useFocusEffect(useCallback(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]));

  // Nhan thong bao tu man hinh form
  const savedMsg = route.params?.saved;
  useEffect(() => {
    if (!savedMsg) return;
    showToast('success', savedMsg.text);
    if (savedMsg.id) setExpanded((s) => new Set(s).add(savedMsg.id));
    navigation.setParams({ saved: undefined });
  }, [savedMsg, navigation, showToast]);

  const toggleExpand = (id) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const allExpanded = schedules.length > 0 && schedules.every((r) => expanded.has(r.id));
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(schedules.map((r) => r.id)));

  // Bai do co trong cac lo trinh -> chip loc
  const lotOptions = useMemo(() => {
    const m = new Map();
    schedules.forEach((r) => { if (!m.has(r.lotId)) m.set(r.lotId, r.lot?.name || r.lotId); });
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [schedules]);

  const visible = useMemo(() => {
    const today = isoDay();
    const q = normalize(query.trim());
    const list = schedules.filter((r) => {
      if (status === 'active' && !r.active) return false;
      if (status === 'paused' && r.active) return false;
      if (status === 'today' && !(r.active && r.days.includes(today))) return false;
      if (lotFilter && r.lotId !== lotFilter) return false;
      if (q && ![r.name, r.lot?.name, r.lot?.address, r.vehiclePlate, r.note].some((f) => normalize(f).includes(q))) return false;
      return true;
    });
    const next = (r) => (r.active ? nextArrival(r)?.date?.getTime() ?? Infinity : Infinity);
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    else if (sort === 'next') list.sort((a, b) => next(a) - next(b));
    else list.sort((a, b) => a.arriveTime.localeCompare(b.arriveTime));
    return list;
  }, [schedules, status, lotFilter, query, sort]);

  const counts = useMemo(() => {
    const today = isoDay();
    return {
      all: schedules.length,
      active: schedules.filter((r) => r.active).length,
      paused: schedules.filter((r) => !r.active).length,
      today: schedules.filter((r) => r.active && r.days.includes(today)).length,
    };
  }, [schedules]);

  const filtered = status !== 'all' || !!lotFilter || !!query.trim();
  const clearFilters = () => { setStatus('all'); setLotFilter(null); setQuery(''); };

  async function toggleActive(item) {
    const value = !item.active;
    setSchedules((rs) => rs.map((r) => (r.id === item.id ? { ...r, active: value } : r)));
    try {
      const upd = await schedulesApi.update(item.id, { active: value });
      setSchedules((rs) => rs.map((r) => (r.id === item.id ? upd : r)));
    } catch (e) {
      setSchedules((rs) => rs.map((r) => (r.id === item.id ? { ...r, active: !value } : r)));
      showToast('error', e.message);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await schedulesApi.remove(toDelete.id);
      setSchedules((rs) => rs.filter((r) => r.id !== toDelete.id));
      showToast('success', `Đã xoá lịch "${toDelete.name}".`);
      setToDelete(null);
    } catch (e) {
      if (e.code === 'schedule_not_found') setSchedules((rs) => rs.filter((r) => r.id !== toDelete.id));
      showToast('error', e.message);
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  // Dat cho nhanh: chon o trong dau tien cua bai dich, dung xe + thoi gian giu cho cua lo trinh
  async function quickReserve(item) {
    setReservingId(item.id);
    try {
      const lot = await lotsApi.detail(item.lotId);
      if (!lot.online) throw new Error('Bãi đỗ đang offline, chưa đặt chỗ được.');
      const free = (lot.slots || []).find((s) => s.state === 'free');
      if (!free) throw new Error('Bãi đỗ đã hết ô trống.');
      const resv = await reservationsApi.create(item.lotId, {
        slotNumber: free.slotNumber,
        minutes: item.minutes,
        ...(item.vehicleId && { vehicleId: item.vehicleId }),
      });
      showToast('success', `Đã giữ ô #${resv.slotNumber} tại ${lot.name} trong ${resv.minutes} phút.`);
      load();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setReservingId(null);
    }
  }

  const renderItem = ({ item }) => (
    <ScheduleCard
      item={item}
      open={expanded.has(item.id)}
      reserving={reservingId === item.id}
      onToggle={() => toggleExpand(item.id)}
      onToggleActive={() => toggleActive(item)}
      onEdit={() => navigation.navigate('ScheduleForm', { editing: item })}
      onDelete={() => setToDelete(item)}
      onReserve={() => quickReserve(item)}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      {/* HEADER */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerTitle}>Lịch gửi xe</Text>
          <Text style={styles.headerSub}>
            {counts.all} lịch • {counts.today} lịch hôm nay
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('ScheduleForm')}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
          accessibilityLabel="Thêm lịch gửi xe"
        >
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addBtnText}>Thêm</Text>
        </Pressable>
      </View>

      {/* BO LOC */}
      <View style={styles.filters}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.placeholder} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Tìm theo tên, bãi đỗ, biển số, ghi chú..."
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Xoá tìm kiếm">
              <Ionicons name="close-circle" size={18} color={colors.placeholder} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.key} label={`${f.label} ${counts[f.key]}`} on={status === f.key} onPress={() => setStatus(f.key)} />
          ))}
        </ScrollView>

        {lotOptions.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip icon="business-outline" label="Mọi bãi" on={!lotFilter} onPress={() => setLotFilter(null)} small />
            {lotOptions.map((l) => (
              <Chip key={l.id} label={l.name} on={lotFilter === l.id} onPress={() => setLotFilter(lotFilter === l.id ? null : l.id)} small />
            ))}
          </ScrollView>
        )}

        <View style={styles.toolRow}>
          <Pressable
            onPress={() => setSort(SORTS[(SORTS.findIndex((s) => s.key === sort) + 1) % SORTS.length].key)}
            style={styles.toolBtn}
            accessibilityLabel="Đổi cách sắp xếp"
          >
            <Ionicons name="swap-vertical" size={14} color={colors.textMuted} />
            <Text style={styles.toolText}>Sắp xếp: <Text style={styles.toolStrong}>{SORTS.find((s) => s.key === sort).label}</Text></Text>
          </Pressable>
          {schedules.length > 0 && (
            <Pressable onPress={toggleAll} style={styles.toolBtn}>
              <Ionicons name={allExpanded ? 'contract-outline' : 'expand-outline'} size={14} color={colors.textMuted} />
              <Text style={styles.toolText}>{allExpanded ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}</Text>
            </Pressable>
          )}
        </View>

        {toast ? <Notice type={toast.type}>{toast.text}</Notice> : null}
      </View>

      {/* DANH SACH */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Đang tải lịch gửi xe...</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            loadError ? (
              <EmptyState icon="cloud-offline-outline" title="Không tải được lịch gửi xe" sub={loadError}
                action="Thử lại" onAction={() => { setLoading(true); load(); }} />
            ) : filtered ? (
              <EmptyState icon="filter-outline" title="Không có lịch phù hợp" sub="Thử đổi từ khoá hoặc bộ lọc."
                action="Xoá bộ lọc" onAction={clearFilters} />
            ) : (
              <EmptyState icon="calendar-outline" title="Chưa có lịch gửi xe nào"
                sub="Lưu thói quen gửi xe (vd: Đi làm – gửi ở bãi quen lúc 07:30, T2–T6) để xem nhanh ô trống và đặt chỗ chỉ với 1 chạm."
                action="Thêm lịch đầu tiên" onAction={() => navigation.navigate('ScheduleForm')} />
            )
          }
        />
      )}

      <ConfirmDialog
        visible={!!toDelete}
        danger
        title="Xoá lịch gửi xe?"
        message={toDelete ? `Lịch "${toDelete.name}" sẽ bị xoá vĩnh viễn.` : ''}
        confirmLabel="Xoá"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </SafeAreaView>
  );
}

// =====================================================================
function ScheduleCard({ item, open, reserving, onToggle, onToggleActive, onEdit, onDelete, onReserve }) {
  const lot = item.lot || {};
  const next = item.active ? nextArrival(item) : null;
  const today = isoDay();
  const estFee = lot.pricePerHour != null ? Math.ceil((lot.pricePerHour * item.minutes) / 60 / 1000) * 1000 : null;
  const canReserve = item.active && lot.online && lot.freeSlots > 0;

  return (
    <View style={[styles.card, !item.active && styles.cardPaused]}>
      <Pressable onPress={onToggle} style={styles.cardHead} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${item.name}, ${open ? 'thu gọn' : 'xem chi tiết'}`}>
        <View style={[styles.timeBox, !item.active && styles.timeBoxPaused]}>
          <Text style={[styles.timeText, !item.active && { color: colors.textMuted }]}>{item.arriveTime}</Text>
          <Text style={styles.timeDays} numberOfLines={1}>{daysLabel(item.days)}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          <View style={styles.pathRow}>
            <Ionicons name="location-outline" size={12} color={colors.textMuted} />
            <Text style={[styles.pathText, styles.pathLot]} numberOfLines={1}>{lot.name || item.lotId}</Text>
            {item.vehiclePlate ? <Text style={styles.pathText} numberOfLines={1}>• {item.vehiclePlate}</Text> : null}
          </View>
          <View style={styles.badgeRow}>
            {item.active ? (
              next ? (
                <Badge icon="navigate-outline" color={colors.primary} bg={colors.primarySoft}
                  text={next.inMinutes <= 180 ? `Gửi xe sau ${formatDuration(next.inMinutes)}` : next.label} />
              ) : null
            ) : (
              <Badge icon="pause-circle-outline" color={colors.textMuted} bg="#F1F5F9" text="Tạm tắt" />
            )}
            <Badge
              icon={lot.online ? 'radio-outline' : 'cloud-offline-outline'}
              color={!lot.online ? colors.textMuted : lot.freeSlots > 0 ? colors.success : colors.danger}
              bg={!lot.online ? '#F1F5F9' : lot.freeSlots > 0 ? colors.successSoft : colors.dangerSoft}
              text={lot.online ? `${lot.freeSlots}/${lot.totalSlots} ô trống` : 'Bãi offline'}
            />
          </View>
        </View>

        <View style={styles.cardRight}>
          <Switch
            value={item.active}
            onValueChange={onToggleActive}
            trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
            thumbColor={item.active ? colors.primary : '#F8FAFC'}
            accessibilityLabel={item.active ? 'Tắt lịch' : 'Bật lịch'}
          />
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </View>
      </Pressable>

      {open && (
        <View style={styles.detail}>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => {
              const on = item.days.includes(w.day);
              return (
                <View key={w.day} style={[styles.weekDot, on && styles.weekDotOn, w.day === today && styles.weekDotToday]}>
                  <Text style={[styles.weekText, on && styles.weekTextOn]}>{w.short}</Text>
                </View>
              );
            })}
          </View>

          <DetailRow icon="business-outline" label="Bãi đỗ" value={[lot.name, lot.address].filter(Boolean).join(' • ')} />
          <DetailRow icon="car-sport-outline" label="Xe" value={item.vehiclePlate || 'Chưa chọn xe'} />
          <DetailRow icon="time-outline" label="Giữ chỗ" value={`${item.minutes} phút`} />
          <DetailRow icon="cash-outline" label="Giá bãi"
            value={lot.pricePerHour != null ? `${formatVND(lot.pricePerHour)}/giờ • ước tính ${formatVND(estFee)}` : '—'} />
          {next ? <DetailRow icon="calendar-outline" label="Lần tới" value={next.label} /> : null}
          {item.note ? <DetailRow icon="document-text-outline" label="Ghi chú" value={item.note} /> : null}

          <View style={styles.actions}>
            <Pressable
              onPress={canReserve && !reserving ? onReserve : undefined}
              style={({ pressed }) => [styles.reserveBtn, (!canReserve || reserving) && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canReserve, busy: reserving }}
            >
              {reserving ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="flash" size={16} color="#fff" />}
              <Text style={styles.reserveText}>Đặt chỗ ngay</Text>
            </Pressable>
            <Pressable onPress={onEdit} style={({ pressed }) => [styles.actBtn, pressed && styles.pressed]} accessibilityLabel="Sửa lịch gửi xe">
              <Ionicons name="create-outline" size={18} color={colors.primary} />
              <Text style={styles.actText}>Sửa</Text>
            </Pressable>
            <Pressable onPress={onDelete} style={({ pressed }) => [styles.actBtn, styles.actDanger, pressed && styles.pressed]} accessibilityLabel="Xoá lịch gửi xe">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
          {!canReserve ? (
            <Text style={styles.hint}>
              {!item.active ? 'Bật lịch để đặt chỗ nhanh.' : !lot.online ? 'Bãi đỗ đang offline.' : 'Bãi đỗ đã hết ô trống.'}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Chip({ label, on, onPress, icon, small }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, small && styles.chipSmall, on && styles.chipOn]}
      accessibilityRole="button" accessibilityState={{ selected: on }}>
      {icon ? <Ionicons name={icon} size={13} color={on ? '#fff' : colors.textMuted} /> : null}
      <Text style={[styles.chipText, small && { fontSize: 12 }, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Badge({ icon, text, color, bg }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={15} color={colors.textMuted} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

function EmptyState({ icon, title, sub, action, onAction }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={28} color={colors.placeholder} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
      {action ? (
        <Pressable onPress={onAction} style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}>
          <Text style={styles.emptyBtnText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: 12, height: 36, borderRadius: radius.pill },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  filters: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: '#F1F5F9' },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, height: '100%', outlineStyle: 'none' },
  chipRow: { gap: 8, paddingTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  chipSmall: { height: 28, paddingHorizontal: 10 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted, maxWidth: 180 },
  chipTextOn: { color: '#fff' },
  toolRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  toolText: { fontSize: 12, color: colors.textMuted },
  toolStrong: { fontWeight: '700', color: colors.text },

  listContent: { padding: 16, paddingBottom: 40, gap: 12, flexGrow: 1, backgroundColor: '#F8FAFC' },

  card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', ...shadow.card },
  cardPaused: { backgroundColor: '#FBFCFE' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  timeBox: { width: 66, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center' },
  timeBoxPaused: { backgroundColor: '#F1F5F9' },
  timeText: { fontSize: 17, fontWeight: '900', color: colors.primary, letterSpacing: -0.3 },
  timeDays: { fontSize: 9.5, fontWeight: '600', color: colors.textMuted, marginTop: 2, paddingHorizontal: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  pathText: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },
  pathLot: { fontWeight: '600', color: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  badgeText: { fontSize: 10.5, fontWeight: '700' },
  cardRight: { alignItems: 'center', gap: 6 },

  detail: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 8 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  weekDot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9', borderWidth: 1.5, borderColor: 'transparent' },
  weekDotOn: { backgroundColor: colors.primary },
  weekDotToday: { borderColor: colors.warning },
  weekText: { fontSize: 11, fontWeight: '700', color: colors.placeholder },
  weekTextOn: { color: '#fff' },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailLabel: { width: 72, fontSize: 13, color: colors.textMuted },
  detailValue: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  reserveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: radius.md, backgroundColor: colors.success },
  reserveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 42, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary },
  actText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  actDanger: { borderColor: '#FECACA', backgroundColor: colors.dangerSoft },
  hint: { fontSize: 11.5, color: colors.textMuted },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16, gap: 6 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  emptySub: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  emptyBtn: { marginTop: 10, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
