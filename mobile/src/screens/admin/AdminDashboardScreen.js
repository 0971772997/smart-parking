// TRANG QUAN TRI - TONG QUAN: so lieu hom nay, doanh thu theo ngay (bieu do cot), viec can xu ly,
// tinh trang tung bai do, loi vao moi muc quan ly. Tu cap nhat khi he thong thay doi (LiveContext).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { Chips, Pill } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatVND } from '../../utils/schedules';
import { ymdLabel } from '../../utils/dates';
import { timeAgo } from '../../utils/session';

const SECTIONS = [
  { screen: 'AdminUsers', icon: 'people', label: 'Người dùng', color: '#2563EB' },
  { screen: 'AdminLots', icon: 'business', label: 'Bãi đỗ & thiết bị', color: '#0E7490' },
  { screen: 'AdminPricing', icon: 'pricetags', label: 'Điều chỉnh giá', color: '#059669' },
  { screen: 'AdminReservations', icon: 'ticket', label: 'Đặt chỗ', color: '#7C3AED' },
  { screen: 'AdminSessions', icon: 'car-sport', label: 'Phiên gửi xe', color: '#16A34A' },
  { screen: 'AdminPayments', icon: 'cash', label: 'Doanh thu & giao dịch', color: '#B45309' },
  { screen: 'AdminReviews', icon: 'star', label: 'Đánh giá', color: '#D97706' },
  { screen: 'Support', icon: 'help-buoy', label: 'Hỗ trợ & sự cố', color: '#DC2626' },
  { screen: 'AdminBroadcast', icon: 'megaphone', label: 'Thông báo chung', color: '#DB2777' },
  { screen: 'GateScanner', icon: 'qr-code', label: 'Quét mã tại cổng', color: '#0F172A' },
  { screen: 'AdminAudit', icon: 'document-text', label: 'Nhật ký quản trị', color: '#475569' },
];
const RANGES = [{ key: 7, label: '7 ngày' }, { key: 30, label: '30 ngày' }];

const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}tr` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export default function AdminDashboardScreen({ navigation }) {
  const [days, setDays] = useState(7);
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await adminApi.overview(days));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [days]);
  useFocusEffect(useCallback(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]));
  useOnLiveChange(load);

  const go = (screen, params) => navigation.navigate(screen, params);

  return (
    <ScreenShell navigation={navigation} title="Trang quản trị" subtitle={d ? `Hôm nay ${ymdLabel(d.today)}` : 'SmartPark Admin'}>
      {!d && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
          {d ? (
            <>
              {/* SO LIEU HOM NAY */}
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>Doanh thu hôm nay</Text>
                <Text style={styles.heroValue}>{formatVND(d.todayStats.revenue)}</Text>
                <Text style={styles.heroSub}>{d.todayStats.payments} giao dịch • {d.todayStats.sessions} lượt gửi xe • {d.todayStats.reservations} đặt chỗ</Text>
                <View style={styles.kpis}>
                  <Kpi value={`${d.slots.occupied}/${d.slots.total}`} label="Ô có xe" />
                  <Kpi value={d.slots.carsInLots} label="Xe trong bãi" />
                  <Kpi value={`${d.lots.online}/${d.lots.total}`} label="Bãi online" warn={d.lots.online < d.lots.total} />
                  <Kpi value={d.users.total} label={`Người dùng${d.users.newToday ? ` (+${d.users.newToday})` : ''}`} />
                </View>
              </View>

              {/* VIEC CAN XU LY */}
              <Text style={styles.section}>Cần xử lý</Text>
              <View style={styles.todoGrid}>
                <Todo icon="warning" color={colors.danger} value={d.pending.openTickets} label="Yêu cầu / sự cố mở"
                  extra={d.pending.urgentTickets ? `${d.pending.urgentTickets} khẩn` : null} onPress={() => go('Support')} />
                <Todo icon="alert-circle" color="#B45309" value={d.pending.unpaidSessions} label="Phiên chưa thanh toán"
                  extra={d.pending.unpaidAmount ? formatVND(d.pending.unpaidAmount) : null} onPress={() => go('AdminSessions', { state: 'unpaid' })} />
                <Todo icon="chatbubble-ellipses" color="#D97706" value={d.pending.unrepliedReviews} label="Đánh giá chưa phản hồi"
                  onPress={() => go('AdminReviews', { unreplied: true })} />
                <Todo icon="ticket" color="#7C3AED" value={d.pending.activeReservations} label="Đặt chỗ đang giữ"
                  extra={d.todayStats.noShows ? `${d.todayStats.noShows} không đến hôm nay` : null} onPress={() => go('AdminReservations', { status: 'active,pending' })} />
              </View>

              {/* DOANH THU THEO NGAY */}
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle}>Doanh thu theo ngày</Text>
                  <Chips options={RANGES} value={days} onChange={setDays} style={{ paddingBottom: 0 }} />
                </View>
                <RevenueChart series={d.series} />
              </View>

              {/* TINH TRANG BAI */}
              <View style={styles.sectionRow}>
                <Text style={styles.section}>Bãi đỗ</Text>
                <Pressable onPress={() => go('AdminLots')} hitSlop={8}><Text style={styles.link}>Quản lý</Text></Pressable>
              </View>
              {d.lotStatus.map((l) => {
                const used = l.totalSlots ? (l.occupied + l.reserved) / l.totalSlots : 0;
                return (
                  <Pressable key={l.id} onPress={() => go('AdminLots', { focus: l.id })} style={styles.lot} accessibilityRole="button">
                    <View style={{ flex: 1 }}>
                      <View style={styles.row}>
                        <Text style={styles.lotName} numberOfLines={1}>{l.name}</Text>
                        <Pill text={l.online ? 'Online' : 'Offline'} color={l.online ? colors.success : colors.danger}
                          bg={l.online ? colors.successSoft : colors.dangerSoft} icon={l.online ? 'wifi' : 'cloud-offline'} />
                        {!l.bookingEnabled ? <Pill text="Ngưng đặt chỗ" color="#B45309" bg="#FEF3C7" /> : null}
                      </View>
                      <View style={styles.bar}>
                        <View style={[styles.barFill, { width: `${Math.round(used * 100)}%`, backgroundColor: used > 0.85 ? colors.danger : colors.primary }]} />
                      </View>
                      <Text style={styles.lotSub}>
                        {l.free} trống • {l.occupied} có xe • {l.reserved} giữ chỗ
                        {l.rating ? ` • ★ ${l.rating}` : ''}{!l.online && l.lastSeenAt ? ` • mất kết nối ${timeAgo(l.lastSeenAt)}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.lotRev}>{formatVND(l.revenueToday)}</Text>
                      <Text style={styles.lotSub}>hôm nay</Text>
                    </View>
                  </Pressable>
                );
              })}

              {/* MUC QUAN LY */}
              <Text style={styles.section}>Quản lý</Text>
              <View style={styles.grid}>
                {SECTIONS.map((s) => (
                  <Pressable key={s.screen} onPress={() => go(s.screen)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                    <View style={[styles.tileIcon, { backgroundColor: `${s.color}14` }]}><Ionicons name={s.icon} size={20} color={s.color} /></View>
                    <Text style={styles.tileText} numberOfLines={2}>{s.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.foot}>
                {d.users.admins} quản trị viên • {d.users.locked} tài khoản bị khoá • {d.lots.paused} bãi ngưng đặt chỗ
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}
    </ScreenShell>
  );
}

// Bieu do cot 1 chuoi (doanh thu/ngay): 1 mau, cot bo goc tren 4px tu duong day, khe 2px;
// cham vao cot -> hien so lieu ngay do (thay tooltip tren dien thoai). Nhan chi o cot cao nhat + cot dang chon.
function RevenueChart({ series }) {
  const [sel, setSel] = useState(null);
  const max = Math.max(1, ...series.map((p) => p.revenue));
  const peak = series.reduce((a, p, i) => (p.revenue > (series[a]?.revenue ?? -1) ? i : a), 0);
  const total = series.reduce((a, p) => a + p.revenue, 0);
  const shown = sel ?? null;
  const many = series.length > 10;
  const H = 140;
  return (
    <View>
      <View style={styles.chartHead}>
        {shown != null ? (
          <Text style={styles.chartInfo}>
            {ymdLabel(series[shown].date)}: <Text style={styles.chartStrong}>{formatVND(series[shown].revenue)}</Text> • {series[shown].sessions} lượt gửi
          </Text>
        ) : (
          <Text style={styles.chartInfo}>Tổng {series.length} ngày: <Text style={styles.chartStrong}>{formatVND(total)}</Text> • chạm vào cột để xem</Text>
        )}
      </View>
      <View style={[styles.plot, { height: H }]} accessibilityLabel={`Doanh thu ${series.length} ngày, tổng ${formatVND(total)}`}>
        {[0.5, 1].map((g) => <View key={g} style={[styles.grid1, { bottom: H * g }]} />)}
        {series.map((p, i) => {
          const h = p.revenue ? Math.max(3, (p.revenue / max) * (H - 18)) : 0;
          const on = sel === i;
          return (
            <Pressable key={p.date} onPress={() => setSel(on ? null : i)} style={styles.col} hitSlop={2}
              accessibilityRole="button" accessibilityLabel={`${ymdLabel(p.date)}: ${formatVND(p.revenue)}`}>
              {(i === peak && p.revenue > 0 && sel == null) || on ? <Text style={styles.colLabel}>{short(p.revenue)}</Text> : null}
              <View style={[styles.colBar, { height: h, backgroundColor: sel == null || on ? colors.primary : '#BFCDF5' }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axis} />
      <View style={styles.xLabels}>
        {series.map((p, i) => (
          <Text key={p.date} style={styles.xLabel} numberOfLines={1}>
            {!many || i % 5 === 0 || i === series.length - 1 ? ymdLabel(p.date, true) : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Kpi({ value, label, warn }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, warn && { color: '#FCA5A5' }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Todo({ icon, color, value, label, extra, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.todo, value > 0 && { borderColor: `${color}55` }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={styles.row}>
        <Ionicons name={icon} size={16} color={value > 0 ? color : '#CBD5E1'} />
        <Text style={[styles.todoValue, { color: value > 0 ? colors.text : '#94A3B8' }]}>{value}</Text>
      </View>
      <Text style={styles.todoLabel}>{label}</Text>
      {extra ? <Text style={[styles.todoExtra, { color }]}>{extra}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16 },
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '700' },
  heroValue: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 2 },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  kpis: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  kpi: { flex: 1 },
  kpiValue: { color: '#fff', fontSize: 16, fontWeight: '900' },
  kpiLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, marginTop: 1 },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  link: { fontSize: 13, fontWeight: '800', color: colors.primary },
  todoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  todo: { width: '48.8%', padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  todoValue: { fontSize: 20, fontWeight: '900' },
  todoLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  todoExtra: { fontSize: 11.5, fontWeight: '800', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  chartHead: { marginTop: 8, marginBottom: 6, minHeight: 18 },
  chartInfo: { fontSize: 12.5, color: colors.textMuted },
  chartStrong: { color: colors.text, fontWeight: '900' },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  grid1: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#F1F5F9' },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  colBar: { width: '100%', maxWidth: 30, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  colLabel: { fontSize: 10.5, fontWeight: '800', color: colors.text, marginBottom: 3 },
  axis: { height: 1, backgroundColor: '#CBD5E1' },
  xLabels: { flexDirection: 'row', gap: 2, marginTop: 4 },
  xLabel: { flex: 1, fontSize: 9.5, color: '#94A3B8', textAlign: 'center', overflow: 'visible' },
  lot: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7', marginBottom: 8 },
  lotName: { fontSize: 14, fontWeight: '800', color: colors.text, flexShrink: 1 },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#EEF2F7', marginTop: 8, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  lotSub: { fontSize: 11.5, color: colors.textMuted, marginTop: 4 },
  lotRev: { fontSize: 14, fontWeight: '900', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.8%', padding: 10, minHeight: 86, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 11.5, fontWeight: '800', color: colors.text, textAlign: 'center' },
  foot: { fontSize: 11.5, color: '#94A3B8', textAlign: 'center', marginTop: 14 },
});
