// HOME SCREEN - Giao dien Hien dai, Tinh gon & Toan dien (Modern & Clean Dashboard)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Logo from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import { lotsApi } from '../../api/lots';
import { reservationsApi } from '../../api/reservations';
import { vehiclesApi } from '../../api/vehicles';
import { routesApi } from '../../api/routes';
import { colors, radius, shadow } from '../../theme';
import { formatDuration, nextDeparture } from '../../utils/routes';
import { useFocusEffect } from '@react-navigation/native';

const { width: SCREEN_W } = Dimensions.get('window');

// =====================================================================
//  HELPERS & CONSTANTS
// =====================================================================
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buổi sáng tốt lành';
  if (h < 18) return 'Buổi chiều năng động';
  return 'Buổi tối an lành';
}

function formatVND(n) {
  if (n === undefined || n === null) return '—';
  return Number(n).toLocaleString('vi-VN') + 'đ';
}

function formatTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins}m trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h trước`;
  return `${Math.floor(hrs / 24)}d trước`;
}

const TABS = [
  { key: 'lots', label: 'Bãi đỗ', icon: 'business-outline', iconActive: 'business' },
  { key: 'reservations', label: 'Đặt chỗ', icon: 'ticket-outline', iconActive: 'ticket' },
  { key: 'vehicles', label: 'Xe của tôi', icon: 'car-sport-outline', iconActive: 'car-sport' },
  { key: 'account', label: 'Hồ sơ', icon: 'person-outline', iconActive: 'person' },
];

const RESV_CONFIG = {
  active: { label: 'Đang giữ chỗ', color: '#2563EB', bg: '#EFF6FF', icon: 'time-outline' },
  pending: { label: 'Chờ nhận xe', color: '#D97706', bg: '#FFFBEB', icon: 'hourglass-outline' },
  fulfilled: { label: 'Đã hoàn tất', color: '#16A34A', bg: '#F0FDF4', icon: 'checkmark-circle-outline' },
  cancelled: { label: 'Đã hủy', color: '#64748B', bg: '#F8FAFC', icon: 'close-circle-outline' },
  expired: { label: 'Hết hạn', color: '#DC2626', bg: '#FEF2F2', icon: 'alert-circle-outline' },
  failed: { label: 'Thất bại', color: '#DC2626', bg: '#FEF2F2', icon: 'warning-outline' },
};

// =====================================================================
//  MAIN COMPONENT
// =====================================================================
export default function HomeScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('lots');
  const [lots, setLots] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedLotId, setExpandedLotId] = useState(null); // bai dang mo so do o
  const [selectedLotDetail, setSelectedLotDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const expandedRef = useRef(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Tải dữ liệu toàn diện (kèm sơ đồ ô của bãi đang mở, để màu ô luôn khớp thiết bị)
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    const lotId = expandedRef.current;
    try {
      const [lotsRes, resvRes, vehRes, routesRes, detailRes] = await Promise.allSettled([
        lotsApi.list(),
        reservationsApi.list(),
        vehiclesApi.list(),
        routesApi.list(),
        lotId ? lotsApi.detail(lotId) : Promise.resolve(null),
      ]);
      if (lotsRes.status === 'fulfilled') setLots(lotsRes.value || []);
      if (resvRes.status === 'fulfilled') setReservations(resvRes.value || []);
      if (vehRes.status === 'fulfilled') setVehicles(vehRes.value || []);
      if (routesRes.status === 'fulfilled') setRoutes(routesRes.value || []);
      // Bỏ qua kết quả nếu người dùng đã đóng / đổi bãi trong lúc đang tải
      if (lotId && detailRes.status === 'fulfilled' && expandedRef.current === lotId) setSelectedLotDetail(detailRes.value);
    } catch {
      // bỏ qua lỗi im lặng nếu có
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [loadData, fadeAnim]);

  // Tự đồng bộ mỗi 10s, chỉ khi màn hình đang hiển thị (sang màn khác thì dừng);
  // quay lại từ màn Lộ trình (có thể vừa đặt chỗ / sửa) -> làm mới ngay
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) firstFocus.current = false;
    else loadData(true);
    const interval = setInterval(() => loadData(true), 10000);
    return () => clearInterval(interval);
  }, [loadData]));

  // Mở / đóng sơ đồ ô của một bãi
  const viewLotDetail = async (lotId) => {
    if (expandedRef.current === lotId) {
      expandedRef.current = null;
      setExpandedLotId(null);
      setSelectedLotDetail(null);
      return;
    }
    expandedRef.current = lotId;
    setExpandedLotId(lotId);
    setSelectedLotDetail(null);
    setLoadingDetail(true);
    try {
      const data = await lotsApi.detail(lotId);
      if (expandedRef.current === lotId) setSelectedLotDetail(data);
    } catch {
      // giữ trống, lần đồng bộ sau sẽ thử lại
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  // Tính toán tóm tắt
  const activeReservation = useMemo(() => {
    return reservations.find((r) => r.status === 'active' || r.status === 'pending');
  }, [reservations]);

  const summary = useMemo(() => {
    const totalFree = lots.reduce((acc, l) => acc + (l.freeSlots || 0), 0);
    const totalCap = lots.reduce((acc, l) => acc + (l.totalSlots || 0), 0);
    const onlineCount = lots.filter((l) => l.online).length;
    return { totalFree, totalCap, onlineCount };
  }, [lots]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />

      {/* TOP COMPACT HEADER */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Logo size={38} />
          <View style={styles.headerTitleWrap}>
            <Text style={styles.greetingText}>{getGreeting()}</Text>
            <Text style={styles.userNameText} numberOfLines={1}>
              {user?.fullName || user?.username || user?.email?.split('@')[0]}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.statusPill}>
            <View style={[styles.statusDot, summary.onlineCount > 0 ? styles.dotGreen : styles.dotGray]} />
            <Text style={styles.statusPillText}>
              {summary.onlineCount > 0 ? `${summary.onlineCount} trạm online` : 'Offline'}
            </Text>
          </View>

          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
            accessibilityLabel="Đăng xuất"
            hitSlop={8}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData(true);
            }}
            tintColor={colors.primary}
          />
        }
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* HERO ACTIVE RESERVATION HOẶC QUICK SUMMARY */}
          {activeReservation ? (
            <ActiveTicketCard resv={activeReservation} lots={lots} />
          ) : (
            <CompactSummaryCard summary={summary} vehiclesCount={vehicles.length} />
          )}

          {/* LOI TAT: LO TRINH CUA TOI */}
          <RoutesShortcut routes={routes} onPress={() => navigation.navigate('Routes')} />

          {/* CLEAN NAVIGATION TABS */}
          <View style={styles.tabContainer}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={[styles.tabButton, isActive && styles.tabButtonActive]}
                >
                  <Ionicons
                    name={isActive ? tab.iconActive : tab.icon}
                    size={17}
                    color={isActive ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                    {tab.label}
                  </Text>
                  {tab.key === 'reservations' && activeReservation && (
                    <View style={styles.tabBadge} />
                  )}
                  {tab.key === 'vehicles' && vehicles.length > 0 && (
                    <Text style={[styles.tabMiniCount, isActive && { color: colors.primary }]}>
                      {vehicles.length}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* TAB CONTENTS */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.loadingText}>Đồng bộ dữ liệu thời gian thực...</Text>
            </View>
          ) : (
            <>
              {activeTab === 'lots' && (
                <LotsTabSection
                  lots={lots}
                  expandedLotId={expandedLotId}
                  selectedDetail={selectedLotDetail}
                  loadingDetail={loadingDetail}
                  onToggleDetail={viewLotDetail}
                />
              )}

              {activeTab === 'reservations' && (
                <ReservationsTabSection reservations={reservations} lots={lots} />
              )}

              {activeTab === 'vehicles' && <VehiclesTabSection vehicles={vehicles} />}

              {activeTab === 'account' && (
                <AccountTabSection user={user} onLogout={handleLogout} />
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// =====================================================================
//  SUB-SECTIONS & CARDS
// =====================================================================

/** Card tóm tắt nhanh khi không có vé giữ chỗ */
function CompactSummaryCard({ summary, vehiclesCount }) {
  const percentAvailable = summary.totalCap
    ? Math.round((summary.totalFree / summary.totalCap) * 100)
    : 0;

  return (
    <LinearGradient colors={['#1E293B', '#0F172A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
      <View style={styles.heroHeader}>
        <View style={styles.heroBadge}>
          <Ionicons name="sparkles" size={13} color="#38BDF8" />
          <Text style={styles.heroBadgeText}>Hệ thống thông minh</Text>
        </View>
        <Text style={styles.heroSubText}>Cập nhật trực tiếp qua MQTT</Text>
      </View>

      <View style={styles.heroStatsRow}>
        <View style={styles.heroStatItem}>
          <Text style={styles.heroStatNum}>{summary.totalFree}</Text>
          <Text style={styles.heroStatLabel}>Ô trống hiện tại</Text>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStatItem}>
          <Text style={[styles.heroStatNum, { color: '#38BDF8' }]}>{percentAvailable}%</Text>
          <Text style={styles.heroStatLabel}>Tỷ lệ sẵn sàng</Text>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStatItem}>
          <Text style={[styles.heroStatNum, { color: '#A78BFA' }]}>{vehiclesCount}</Text>
          <Text style={styles.heroStatLabel}>Xe đã lưu</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

/** Lối tắt tới màn Lộ trình: hiện chuyến sắp tới gần nhất */
function RoutesShortcut({ routes, onPress }) {
  const upcoming = useMemo(() => {
    let best = null;
    routes.forEach((r) => {
      if (!r.active) return;
      const n = nextDeparture(r);
      if (n && (!best || n.date < best.next.date)) best = { route: r, next: n };
    });
    return best;
  }, [routes]);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.routeShortcut, pressed && styles.btnPressed]}
      accessibilityRole="button" accessibilityLabel="Mở lộ trình của tôi">
      <View style={styles.routeShortcutIcon}>
        <Ionicons name="git-branch-outline" size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.routeShortcutTitle}>
          Lộ trình của tôi{routes.length ? ` (${routes.length})` : ''}
        </Text>
        <Text style={styles.routeShortcutSub} numberOfLines={1}>
          {upcoming
            ? `${upcoming.route.name} • ${upcoming.next.inMinutes <= 180 ? `sau ${formatDuration(upcoming.next.inMinutes)}` : upcoming.next.label}`
            : routes.length ? 'Không có chuyến nào sắp tới' : 'Lưu chuyến đi quen thuộc để đặt chỗ nhanh'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/** Card vé giữ chỗ đang hoạt động (Live Ticket) */
function ActiveTicketCard({ resv, lots }) {
  const lot = lots.find((l) => l.id === resv.lotId);
  const cfg = RESV_CONFIG[resv.status] || RESV_CONFIG.active;
  const minsLeft = resv.expiresAt
    ? Math.max(0, Math.round((new Date(resv.expiresAt) - Date.now()) / 60000))
    : null;

  return (
    <View style={styles.ticketCard}>
      <View style={styles.ticketTopBar}>
        <View style={[styles.ticketBadge, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={13} color={cfg.color} />
          <Text style={[styles.ticketBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {minsLeft !== null && (
          <View style={styles.ticketTimer}>
            <Ionicons name="hourglass-outline" size={13} color="#EA580C" />
            <Text style={styles.ticketTimerText}>Còn {minsLeft} phút</Text>
          </View>
        )}
      </View>

      <View style={styles.ticketMain}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ticketLotName}>{lot?.name || resv.lotId}</Text>
          <Text style={styles.ticketAddress} numberOfLines={1}>
            {lot?.address || 'Điểm đỗ kết nối IoT'}
          </Text>
        </View>
        <View style={styles.slotPill}>
          <Text style={styles.slotPillLabel}>Ô ĐỖ</Text>
          <Text style={styles.slotPillNum}>#{resv.slotNumber}</Text>
        </View>
      </View>

      <View style={styles.ticketFooter}>
        <View style={styles.ticketMeta}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.ticketMetaText}>Thời hạn: {resv.minutes} phút</Text>
        </View>
        <View style={styles.ticketMeta}>
          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
          <Text style={styles.ticketMetaText}>{formatTimeAgo(resv.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
}

/** Tab 1: Danh sách bãi đỗ & Sơ đồ ô */
function LotsTabSection({ lots, expandedLotId, selectedDetail, loadingDetail, onToggleDetail }) {
  if (lots.length === 0) {
    return <EmptyNotice icon="business-outline" title="Chưa có bãi đỗ nào" subtitle="Hệ thống đang được cập nhật thêm trạm mới." />;
  }

  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Bãi đỗ xe trực tuyến</Text>
        <Text style={styles.sectionSubTitle}>{lots.length} trạm hỗ trợ</Text>
      </View>

      {lots.map((lot) => {
        const isExpanded = expandedLotId === lot.id;
        const freeCount = lot.freeSlots ?? 0;
        const total = lot.totalSlots || 0;
        const freeRatio = total ? Math.min(100, Math.round((freeCount / total) * 100)) : 0;

        return (
          <View key={lot.id} style={styles.lotCard}>
            <View style={styles.lotCardHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.lotNameRow}>
                  <Text style={styles.lotNameText}>{lot.name}</Text>
                  <View style={[styles.iotBadge, lot.online ? styles.iotOnline : styles.iotOffline]}>
                    <Text style={[styles.iotText, lot.online ? styles.iotTextOnline : styles.iotTextOffline]}>
                      {lot.online ? 'Online' : 'Offline'}
                    </Text>
                  </View>
                </View>
                {lot.address ? <Text style={styles.lotAddressText}>{lot.address}</Text> : null}
              </View>

              <View style={styles.lotPriceTag}>
                <Text style={styles.lotPriceText}>{formatVND(lot.pricePerHour)}</Text>
                <Text style={styles.lotPriceUnit}>/giờ</Text>
              </View>
            </View>

            {/* Thanh tiến độ ô trống */}
            <View style={styles.meterContainer}>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${freeRatio}%`,
                      backgroundColor: freeRatio > 40 ? '#10B981' : freeRatio > 15 ? '#F59E0B' : '#EF4444',
                    },
                  ]}
                />
              </View>
              <View style={styles.meterLabels}>
                <Text style={styles.meterValueText}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>{freeCount}</Text>/{total} ô còn trống
                </Text>
                <Text style={styles.meterPercentText}>{freeRatio}% khả dụng</Text>
              </View>
            </View>

            {/* Trạng thái cổng vào/ra */}
            <View style={styles.gateStatusBar}>
              <View style={styles.gateItem}>
                <Ionicons
                  name={lot.gates?.entry === 'open' ? 'lock-open' : 'lock-closed'}
                  size={13}
                  color={lot.gates?.entry === 'open' ? '#10B981' : colors.textMuted}
                />
                <Text style={styles.gateLabel}>
                  Cổng vào: <Text style={styles.gateState}>{lot.gates?.entry === 'open' ? 'Mở' : 'Đóng'}</Text>
                </Text>
              </View>

              <View style={styles.gateItem}>
                <Ionicons
                  name={lot.gates?.exit === 'open' ? 'lock-open' : 'lock-closed'}
                  size={13}
                  color={lot.gates?.exit === 'open' ? '#10B981' : colors.textMuted}
                />
                <Text style={styles.gateLabel}>
                  Cổng ra: <Text style={styles.gateState}>{lot.gates?.exit === 'open' ? 'Mở' : 'Đóng'}</Text>
                </Text>
              </View>

              <Pressable
                onPress={() => onToggleDetail(lot.id)}
                style={({ pressed }) => [styles.viewDetailBtn, pressed && styles.btnPressed]}
              >
                <Text style={styles.viewDetailBtnText}>
                  {isExpanded ? 'Ẩn sơ đồ' : 'Sơ đồ ô'}
                </Text>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.primary}
                />
              </Pressable>
            </View>

            {/* SƠ ĐỒ Ô ĐỖ THỜI GIAN THỰC (Mở rộng) */}
            {isExpanded && (
              <View style={styles.slotGridWrap}>
                <View style={styles.slotGridHeader}>
                  <Text style={styles.slotGridTitle}>Sơ đồ vị trí các ô đỗ</Text>
                  <View style={styles.slotLegends}>
                    <LegendItem color="#10B981" label="Trống" />
                    <LegendItem color="#EF4444" label="Có xe" />
                    <LegendItem color="#F59E0B" label="Đã đặt" />
                  </View>
                </View>

                {!lot.online && (
                  <Text style={styles.slotOfflineNote}>
                    Bãi đang offline – đây là trạng thái lần cuối thiết bị gửi về.
                  </Text>
                )}
                {loadingDetail && !selectedDetail ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 14 }} />
                ) : (
                  <View style={styles.slotsRow}>
                    {(selectedDetail?.slots || []).map((s) => {
                      const isFree = s.state === 'free';
                      const isOccupied = s.state === 'occupied';
                      const color = isFree ? '#10B981' : isOccupied ? '#EF4444' : '#F59E0B';
                      const bg = isFree ? '#ECFDF5' : isOccupied ? '#FEF2F2' : '#FFFBEB';

                      return (
                        <View key={s.id} style={[styles.slotItem, { borderColor: color, backgroundColor: bg }]}>
                          <Ionicons
                            name={isFree ? 'radio-button-off' : 'car'}
                            size={18}
                            color={color}
                          />
                          <Text style={[styles.slotItemNum, { color }]}>Ô #{s.slotNumber}</Text>
                          {/* Chỉ hiện khoảng cách khi có xe (≥ 400 cm = cảm biến không thấy vật) */}
                          {isOccupied && s.distanceCm && s.distanceCm < 400 ? (
                            <Text style={styles.slotItemDist}>{s.distanceCm} cm</Text>
                          ) : !isFree && !isOccupied ? (
                            <Text style={styles.slotItemDist}>Đã đặt trước</Text>
                          ) : (
                            <Text style={styles.slotItemDist}>{isFree ? 'Sẵn sàng' : 'Đang đỗ'}</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function LegendItem({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

/** Tab 2: Lịch sử & Danh sách đặt chỗ */
function ReservationsTabSection({ reservations, lots }) {
  if (reservations.length === 0) {
    return <EmptyNotice icon="ticket-outline" title="Chưa có đặt chỗ" subtitle="Khi bạn đặt chỗ trước, thông tin vé sẽ xuất hiện tại đây." />;
  }

  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Lịch sử đặt chỗ</Text>
        <Text style={styles.sectionSubTitle}>{reservations.length} lượt ghi nhận</Text>
      </View>

      {reservations.map((item) => {
        const lot = lots.find((l) => l.id === item.lotId);
        const cfg = RESV_CONFIG[item.status] || RESV_CONFIG.pending;

        return (
          <View key={item.id} style={styles.historyCard}>
            <View style={styles.historyLeft}>
              <View style={[styles.historyIconCircle, { backgroundColor: cfg.bg }]}>
                <Ionicons name={cfg.icon} size={18} color={cfg.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyLotName}>{lot?.name || item.lotId}</Text>
                <Text style={styles.historyMeta}>
                  Ô số #{item.slotNumber} • {item.minutes} phút
                </Text>
              </View>
            </View>

            <View style={styles.historyRight}>
              <View style={[styles.historyStatusBadge, { backgroundColor: cfg.bg }]}>
                <Text style={[styles.historyStatusText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              <Text style={styles.historyTimeAgo}>{formatTimeAgo(item.createdAt)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Tab 3: Xe cá nhân */
function VehiclesTabSection({ vehicles }) {
  if (vehicles.length === 0) {
    return <EmptyNotice icon="car-sport-outline" title="Chưa có xe nào được lưu" subtitle="Đăng ký biển số xe giúp hệ thống nhận diện tự động khi tới bãi." />;
  }

  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Phương tiện đã đăng ký</Text>
        <Text style={styles.sectionSubTitle}>{vehicles.length} xe cá nhân</Text>
      </View>

      {vehicles.map((v) => (
        <View key={v.id} style={styles.vehicleCard}>
          <View style={styles.vehiclePlateBox}>
            <Text style={styles.vehiclePlatePrefix}>VN</Text>
            <Text style={styles.vehiclePlateNum}>{v.plateNumber}</Text>
          </View>

          <View style={styles.vehicleDetails}>
            <Text style={styles.vehicleBrandText}>{v.brand || 'Xe ô tô'}</Text>
            <View style={styles.vehicleColorRow}>
              <Ionicons name="color-palette-outline" size={13} color={colors.textMuted} />
              <Text style={styles.vehicleColorText}>{v.color || 'Màu tiêu chuẩn'}</Text>
            </View>
          </View>

          <View style={styles.vehicleActiveTag}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={styles.vehicleActiveText}>Khả dụng</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Tab 4: Hồ sơ & Cài đặt */
function AccountTabSection({ user, onLogout }) {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.profileBox}>
        <View style={styles.avatarWrap}>
          <Ionicons name="person" size={30} color="#1D4ED8" />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.profileFullName}>
            {user?.fullName || user?.username || 'Chưa cập nhật tên'}
          </Text>
          <Text style={styles.profileRoleBadge}>
            {user?.role === 'admin' ? '🛡️ Quản trị viên hệ thống' : '👤 Khách hàng tiêu chuẩn'}
          </Text>
        </View>
      </View>

      <View style={styles.detailsCard}>
        <ProfileField icon="mail-outline" label="Địa chỉ Email" value={user?.email} />
        <ProfileField icon="at-outline" label="Tên đăng nhập" value={user?.username} />
        <ProfileField icon="call-outline" label="Số điện thoại" value={user?.phone} />
        <ProfileField icon="shield-checkmark-outline" label="Quyền tài khoản" value={user?.role === 'admin' ? 'Quản trị (Admin)' : 'Người dùng'} />
        {user?.linked?.google && (
          <ProfileField icon="logo-google" label="Google" value="Đã liên kết" valueColor="#10B981" />
        )}
        {user?.linked?.facebook && (
          <ProfileField icon="logo-facebook" label="Facebook" value="Đã liên kết" valueColor="#10B981" />
        )}
      </View>

      <Pressable
        onPress={onLogout}
        style={({ pressed }) => [styles.logoutCardBtn, pressed && styles.btnPressed]}
      >
        <Ionicons name="log-out-outline" size={18} color="#DC2626" />
        <Text style={styles.logoutCardBtnText}>Đăng xuất khỏi thiết bị</Text>
      </Pressable>

      <View style={styles.appFooterInfo}>
        <Text style={styles.appFooterText}>SmartPark Client v1.0.0 • Nền tảng IoT Bãi đỗ xe</Text>
      </View>
    </View>
  );
}

function ProfileField({ icon, label, value, valueColor }) {
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldLabelWrap}>
        <Ionicons name={icon} size={15} color={colors.textMuted} />
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      <Text style={[styles.fieldValue, valueColor && { color: valueColor }]} numberOfLines={1}>
        {value || '—'}
      </Text>
    </View>
  );
}

function EmptyNotice({ icon, title, subtitle }) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={icon} size={28} color={colors.placeholder} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

// =====================================================================
//  STYLES - CLEAN, MODERN, COMPACT
// =====================================================================
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 36 },

  // Header gọn gàng
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitleWrap: { marginLeft: 10 },
  greetingText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  userNameText: { fontSize: 15, fontWeight: '700', color: colors.text, maxWidth: 170 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
    gap: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  dotGreen: { backgroundColor: '#10B981' },
  dotGray: { backgroundColor: '#94A3B8' },
  statusPillText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },

  // Hero Card (Tổng quan)
  heroCard: {
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 16,
    ...shadow.card,
  },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(56,189,248,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  heroBadgeText: { fontSize: 11, color: '#38BDF8', fontWeight: '700' },
  heroSubText: { fontSize: 11, color: '#94A3B8' },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroStatItem: { flex: 1, alignItems: 'center' },
  heroStatNum: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  heroStatLabel: { fontSize: 11, color: '#94A3B8', marginTop: 3 },
  heroDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.1)' },

  // Vé đặt chỗ nổi bật (Live Ticket)
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    ...shadow.card,
  },
  ticketTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  ticketBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  ticketBadgeText: { fontSize: 11.5, fontWeight: '700' },
  ticketTimer: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF7ED', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  ticketTimerText: { fontSize: 11.5, color: '#EA580C', fontWeight: '700' },
  ticketMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  ticketLotName: { fontSize: 17, fontWeight: '800', color: colors.text },
  ticketAddress: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  slotPill: { backgroundColor: '#EFF6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  slotPillLabel: { fontSize: 10, fontWeight: '700', color: colors.primary },
  slotPillNum: { fontSize: 17, fontWeight: '900', color: colors.primary },
  ticketFooter: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  ticketMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ticketMetaText: { fontSize: 12, color: colors.textMuted },

  // Lối tắt Lộ trình
  routeShortcut: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: radius.md,
    padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0',
  },
  routeShortcutIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  routeShortcutTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  routeShortcutSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Tabs điều hướng tinh tế
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  tabButtonActive: {
    backgroundColor: '#EFF6FF',
  },
  tabLabel: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
  tabBadge: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EA580C', position: 'absolute', top: 6, right: 6 },
  tabMiniCount: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginLeft: -2 },

  // Loading
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { fontSize: 12, color: colors.textMuted, marginTop: 10 },

  // Section
  sectionWrap: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  sectionSubTitle: { fontSize: 12, color: colors.textMuted },

  // Lot Card
  lotCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow.card,
  },
  lotCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  lotNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lotNameText: { fontSize: 15, fontWeight: '700', color: colors.text },
  iotBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  iotOnline: { backgroundColor: '#ECFDF5' },
  iotOffline: { backgroundColor: '#F1F5F9' },
  iotText: { fontSize: 10, fontWeight: '700' },
  iotTextOnline: { color: '#10B981' },
  iotTextOffline: { color: '#64748B' },
  lotAddressText: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  lotPriceTag: { alignItems: 'flex-end', backgroundColor: '#F8FAFC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  lotPriceText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  lotPriceUnit: { fontSize: 10, color: colors.textMuted },

  // Meter (Thanh đo)
  meterContainer: { marginTop: 14 },
  meterTrack: { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3 },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  meterValueText: { fontSize: 12, color: colors.textMuted },
  meterPercentText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },

  // Gate & Actions
  gateStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  gateItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gateLabel: { fontSize: 11.5, color: colors.textMuted },
  gateState: { fontWeight: '600', color: colors.text },
  viewDetailBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  viewDetailBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  // Slot Grid trực quan
  slotGridWrap: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  slotGridHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  slotGridTitle: { fontSize: 12, fontWeight: '700', color: colors.text },
  slotLegends: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLabel: { fontSize: 10, color: colors.textMuted },
  slotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotItem: {
    width: (SCREEN_W - 36 - 32 - 16) / 3, // 3 cột cân đối
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    gap: 3,
  },
  slotItemNum: { fontSize: 12, fontWeight: '800' },
  slotItemDist: { fontSize: 10, color: colors.textMuted },
  slotOfflineNote: { fontSize: 11, color: '#B45309', backgroundColor: '#FFFBEB', padding: 8, borderRadius: 6, marginBottom: 10 },

  // History Card
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  historyLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  historyIconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  historyLotName: { fontSize: 14, fontWeight: '700', color: colors.text },
  historyMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  historyRight: { alignItems: 'flex-end', gap: 4 },
  historyStatusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  historyStatusText: { fontSize: 11, fontWeight: '700' },
  historyTimeAgo: { fontSize: 10, color: colors.textMuted },

  // Vehicle Card
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  vehiclePlateBox: {
    backgroundColor: '#0F172A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 84,
  },
  vehiclePlatePrefix: { fontSize: 9, color: '#94A3B8', fontWeight: '800' },
  vehiclePlateNum: { fontSize: 14, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  vehicleDetails: { flex: 1 },
  vehicleBrandText: { fontSize: 14, fontWeight: '700', color: colors.text },
  vehicleColorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  vehicleColorText: { fontSize: 12, color: colors.textMuted },
  vehicleActiveTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  vehicleActiveText: { fontSize: 11, fontWeight: '700', color: '#10B981' },

  // Profile Card
  profileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileFullName: { fontSize: 16, fontWeight: '800', color: colors.text },
  profileRoleBadge: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  fieldLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldLabel: { fontSize: 13, color: colors.textMuted },
  fieldValue: { fontSize: 13, fontWeight: '600', color: colors.text, maxWidth: 180 },
  logoutCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutCardBtnText: { fontSize: 13.5, fontWeight: '700', color: '#DC2626' },
  appFooterInfo: { alignItems: 'center', marginTop: 10 },
  appFooterText: { fontSize: 11, color: colors.placeholder },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 36, gap: 6 },
  emptyIconCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: 'center', maxWidth: 260 },
});
