// HOME SCREEN - Giao dien Hien dai, Tinh gon & Toan dien (Modern & Clean Dashboard)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { schedulesApi } from '../../api/schedules';
import { authApi } from '../../api/auth';
import { colors, radius, shadow } from '../../theme';
import { formatDuration, nextArrival } from '../../utils/schedules';
import { useFocusEffect } from '@react-navigation/native';

const { width: SCREEN_W } = Dimensions.get('window');

// Toạ độ mặc định (Trung tâm Đà Nẵng) làm chuẩn
const DEFAULT_USER_COORDS = { lat: 16.0544, lng: 108.2022, name: 'Hải Châu, Đà Nẵng' };

// Toạ độ thực tế của các bãi đỗ để tính khoảng cách
const LOT_COORDS = {
  'sp-demo-01': { lat: 16.0601, lng: 108.2155 },
  'default': { lat: 16.0580, lng: 108.2100 },
};

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

// Tính khoảng cách Haversine (km)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // bán kính Trái Đất (km)
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
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
  const { user, signOut, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState('lots');
  const [lots, setLots] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedLotId, setExpandedLotId] = useState(null);
  const [selectedLotDetail, setSelectedLotDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const expandedRef = useRef(null);

  // Vị trí người dùng (GPS)
  const [userLocation, setUserLocation] = useState(DEFAULT_USER_COORDS);
  const [locating, setLocating] = useState(false);

  // Tìm kiếm, Lọc & Sắp xếp bãi đỗ
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('distance'); // 'distance' | 'price' | 'slots'
  const [filterFeature, setFilterFeature] = useState('all'); // 'all' | 'free' | 'ev' | 'roof'

  // Modal: Thêm xe mới
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ plateNumber: '', brand: '', color: '' });
  const [savingVehicle, setSavingVehicle] = useState(false);

  // Modal: Cập nhật hồ sơ
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Tải dữ liệu toàn diện
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    const lotId = expandedRef.current;
    try {
      const [lotsRes, resvRes, vehRes, schedRes, detailRes] = await Promise.allSettled([
        lotsApi.list(),
        reservationsApi.list(),
        vehiclesApi.list(),
        schedulesApi.list(),
        lotId ? lotsApi.detail(lotId) : Promise.resolve(null),
      ]);
      if (lotsRes.status === 'fulfilled') setLots(lotsRes.value || []);
      if (resvRes.status === 'fulfilled') setReservations(resvRes.value || []);
      if (vehRes.status === 'fulfilled') setVehicles(vehRes.value || []);
      if (schedRes.status === 'fulfilled') setSchedules(schedRes.value || []);
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

  useFocusEffect(useCallback(() => {
    loadData(true);
    const interval = setInterval(() => loadData(true), 12000);
    return () => clearInterval(interval);
  }, [loadData]));

  // Lấy vị trí GPS hiện tại của người dùng
  const handleGetLocation = () => {
    setLocating(true);
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            name: 'Vị trí GPS hiện tại',
          });
          setLocating(false);
          Alert.alert('Định vị thành công', 'Đã cập nhật vị trí hiện tại của bạn.');
        },
        () => {
          setLocating(false);
          Alert.alert('Định vị', 'Đang sử dụng vị trí trung tâm: Hải Châu, Đà Nẵng.');
        },
        { timeout: 8000 }
      );
    } else {
      setTimeout(() => {
        setLocating(false);
        Alert.alert('Định vị', 'Đang sử dụng vị trí trung tâm: Hải Châu, Đà Nẵng.');
      }, 500);
    }
  };

  // Mở / đóng sơ đồ ô
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
      // giữ trống
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  // Mở Google Maps chỉ đường
  const handleOpenDirections = (lot) => {
    const query = encodeURIComponent(lot.address ? `${lot.name}, ${lot.address}` : lot.name);
    const url = Platform.select({
      ios: `maps://app?daddr=${query}`,
      android: `google.navigation:q=${query}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${query}`,
    });
    Linking.openURL(url).catch(() => {
      Alert.alert('Chỉ đường', `Địa chỉ bãi đỗ: ${lot.address || lot.name}`);
    });
  };

  // Thêm xe mới
  const handleAddVehicle = async () => {
    if (!vehicleForm.plateNumber.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập biển số xe.');
      return;
    }
    setSavingVehicle(true);
    try {
      await vehiclesApi.create({
        plateNumber: vehicleForm.plateNumber.trim().toUpperCase(),
        brand: vehicleForm.brand.trim() || undefined,
        color: vehicleForm.color.trim() || undefined,
      });
      Alert.alert('Thành công', 'Đã thêm phương tiện mới.');
      setShowAddVehicleModal(false);
      setVehicleForm({ plateNumber: '', brand: '', color: '' });
      loadData(true);
    } catch (e) {
      Alert.alert('Lỗi', e.message || 'Không thể thêm xe.');
    } finally {
      setSavingVehicle(false);
    }
  };

  // Xóa xe
  const handleDeleteVehicle = (vehicle) => {
    Alert.alert('Xóa phương tiện', `Bạn có chắc muốn xóa xe biển số ${vehicle.plateNumber}?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa ngay',
        style: 'destructive',
        onPress: async () => {
          try {
            await vehiclesApi.remove(vehicle.id);
            Alert.alert('Thành công', 'Đã xóa phương tiện.');
            loadData(true);
          } catch (e) {
            Alert.alert('Lỗi', e.message || 'Không thể xóa xe.');
          }
        },
      },
    ]);
  };

  // Cập nhật hồ sơ
  const handleUpdateProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await authApi.updateProfile({
        fullName: profileForm.fullName.trim() || undefined,
        phone: profileForm.phone.trim() || undefined,
      });
      updateUser(res);
      Alert.alert('Thành công', 'Hồ sơ người dùng đã được cập nhật.');
      setShowEditProfileModal(false);
    } catch (e) {
      Alert.alert('Lỗi', e.message || 'Không thể cập nhật hồ sơ.');
    } finally {
      setSavingProfile(false);
    }
  };

  // Tính khoảng cách & bổ sung thông tin tiện ích cho từng bãi đỗ
  const enhancedLots = useMemo(() => {
    return lots.map((l) => {
      const coords = LOT_COORDS[l.id] || LOT_COORDS['default'];
      const dist = calculateDistanceKm(userLocation.lat, userLocation.lng, coords.lat, coords.lng);
      return {
        ...l,
        distanceKm: dist,
        hours: '24/7 (Cả tuần)',
        features: ['Mái che', 'Sạc điện EV', 'Camera an ninh', 'Barie tự động'],
        isFull: (l.freeSlots || 0) === 0,
        isMaintenance: !l.online,
      };
    });
  }, [lots, userLocation]);

  // Lọc và Sắp xếp danh sách bãi đỗ
  const processedLots = useMemo(() => {
    let result = enhancedLots;

    // Tìm kiếm
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (l) => l.name.toLowerCase().includes(q) || (l.address && l.address.toLowerCase().includes(q))
      );
    }

    // Lọc tiện ích
    if (filterFeature === 'free') {
      result = result.filter((l) => (l.freeSlots || 0) > 0);
    } else if (filterFeature === 'ev') {
      result = result.filter((l) => l.features.includes('Sạc điện EV'));
    } else if (filterFeature === 'roof') {
      result = result.filter((l) => l.features.includes('Mái che'));
    }

    // Sắp xếp
    if (sortBy === 'distance') {
      result.sort((a, b) => a.distanceKm - b.distanceKm);
    } else if (sortBy === 'price') {
      result.sort((a, b) => (a.pricePerHour || 0) - (b.pricePerHour || 0));
    } else if (sortBy === 'slots') {
      result.sort((a, b) => (b.freeSlots || 0) - (a.freeSlots || 0));
    }

    return result;
  }, [enhancedLots, searchQuery, filterFeature, sortBy]);

  // Vé đang hiệu lực
  const activeReservation = useMemo(() => {
    return reservations.find((r) => r.status === 'active' || r.status === 'pending');
  }, [reservations]);

  // Tóm tắt
  const summary = useMemo(() => {
    const totalFree = lots.reduce((acc, l) => acc + (l.freeSlots || 0), 0);
    const totalCap = lots.reduce((acc, l) => acc + (l.totalSlots || 0), 0);
    const totalOccupied = Math.max(0, totalCap - totalFree);
    const onlineCount = lots.filter((l) => l.online).length;
    return { totalFree, totalCap, totalOccupied, onlineCount };
  }, [lots]);

  // Bãi đỗ đề xuất tốt nhất (gần nhất & còn chỗ)
  const recommendedLot = useMemo(() => {
    const available = enhancedLots.filter((l) => l.online && (l.freeSlots || 0) > 0);
    if (available.length > 0) {
      return available.sort((a, b) => a.distanceKm - b.distanceKm)[0];
    }
    return enhancedLots[0];
  }, [enhancedLots]);

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
          {/* THANH THAO TÁC NHANH (QUICK ACTIONS) */}
          <View style={styles.quickActionsBar}>
            <Pressable
              onPress={() => {
                setActiveTab('lots');
                setSortBy('distance');
              }}
              style={styles.quickActionItem}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="locate" size={18} color="#2563EB" />
              </View>
              <Text style={styles.quickActionLabel}>Bãi gần nhất</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowAddVehicleModal(true)}
              style={styles.quickActionItem}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="car-sport" size={18} color="#10B981" />
              </View>
              <Text style={styles.quickActionLabel}>Đăng ký xe</Text>
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate('SetupParkingLot')}
              style={styles.quickActionItem}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: '#FFFBEB' }]}>
                <Ionicons name="map" size={18} color="#D97706" />
              </View>
              <Text style={styles.quickActionLabel}>Sơ đồ ô đỗ</Text>
            </Pressable>

            <Pressable
              onPress={() =>
                activeReservation
                  ? navigation.navigate('ReservationDetail', { id: activeReservation.id, initial: activeReservation })
                  : navigation.navigate('Booking')
              }
              style={styles.quickActionItem}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: '#F3E8FF' }]}>
                <Ionicons name="ticket" size={18} color="#9333EA" />
              </View>
              <Text style={styles.quickActionLabel}>{activeReservation ? 'Vé của tôi' : 'Đặt chỗ'}</Text>
            </Pressable>
          </View>

          {/* THANH XIN QUYỀN VỊ TRÍ & ĐỊNH VỊ HIỆN TẠI */}
          <View style={styles.locationBar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Ionicons name="location-sharp" size={16} color="#2563EB" />
              <Text style={styles.locationText} numberOfLines={1}>
                {userLocation.name}
              </Text>
            </View>
            <Pressable onPress={handleGetLocation} disabled={locating} style={styles.locationBtn} hitSlop={6}>
              {locating ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <>
                  <Ionicons name="navigate-circle" size={15} color="#2563EB" />
                  <Text style={styles.locationBtnText}>Làm mới GPS</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* HERO ACTIVE RESERVATION HOẶC BÃI ĐỖ ĐƯỢC ĐỀ XUẤT */}
          {activeReservation ? (
            <ActiveTicketCard
              resv={activeReservation}
              lots={lots}
              onPress={() => navigation.navigate('ReservationDetail', { id: activeReservation.id, initial: activeReservation })}
            />
          ) : (
            <CompactSummaryCard
              summary={summary}
              recommendedLot={recommendedLot}
              onNavigateMap={() => navigation.navigate('SetupParkingLot')}
            />
          )}

          {/* LỐI TẮT BẢN ĐỒ & THIẾT LẬP (UI-007) */}
          <Pressable
            onPress={() => navigation.navigate('SetupParkingLot')}
            style={({ pressed }) => [styles.routeShortcut, { marginBottom: 12 }, pressed && styles.btnPressed]}
            accessibilityRole="button"
          >
            <View style={[styles.routeShortcutIcon, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="map-outline" size={20} color="#2563EB" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.routeShortcutTitle}>Bản đồ Sơ đồ Ô đỗ Chân thực</Text>
                <View style={{ backgroundColor: '#DBEAFE', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                  <Text style={{ fontSize: 9.5, color: '#1D4ED8', fontWeight: '800' }}>UI-007</Text>
                </View>
              </View>
              <Text style={styles.routeShortcutSub} numberOfLines={1}>
                Xem vị trí từng ô vuông bãi đỗ • Làn xe • Cổng vào ra trực tiếp
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          {/* TABS ĐIỀU HƯỚNG */}
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
                  {tab.key === 'reservations' && activeReservation && <View style={styles.tabBadge} />}
                  {tab.key === 'vehicles' && vehicles.length > 0 && (
                    <Text style={[styles.tabMiniCount, isActive && { color: colors.primary }]}>
                      {vehicles.length}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* NỘI DUNG TỪNG TAB */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.loadingText}>Đồng bộ dữ liệu thời gian thực...</Text>
            </View>
          ) : (
            <>
              {activeTab === 'lots' && (
                <LotsTabSection
                  lots={processedLots}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  filterFeature={filterFeature}
                  setFilterFeature={setFilterFeature}
                  expandedLotId={expandedLotId}
                  selectedDetail={selectedLotDetail}
                  loadingDetail={loadingDetail}
                  onToggleDetail={viewLotDetail}
                  onDirections={handleOpenDirections}
                  onBook={(lotId, slotNumber) => navigation.navigate('Booking', { lotId, slotNumber })}
                />
              )}

              {activeTab === 'reservations' && (
                <ReservationsTabSection
                  reservations={reservations}
                  lots={lots}
                  onOpen={(r) => navigation.navigate('ReservationDetail', { id: r.id, initial: r })}
                  onNew={() => navigation.navigate('Booking')}
                />
              )}

              {activeTab === 'vehicles' && (
                <VehiclesTabSection
                  vehicles={vehicles}
                  onOpenAdd={() => setShowAddVehicleModal(true)}
                  onDelete={handleDeleteVehicle}
                />
              )}

              {activeTab === 'account' && (
                <AccountTabSection
                  user={user}
                  onOpenEdit={() => {
                    setProfileForm({ fullName: user?.fullName || '', phone: user?.phone || '' });
                    setShowEditProfileModal(true);
                  }}
                  onLogout={handleLogout}
                />
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>

      {/* MODAL: ĐĂNG KÝ XE MỚI */}
      <Modal visible={showAddVehicleModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="car-sport" size={20} color={colors.primary} />
                <Text style={styles.dialogTitle}>Đăng ký Phương tiện</Text>
              </View>
              <Pressable onPress={() => setShowAddVehicleModal(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Biển số xe *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Ví dụ: 43A-123.45"
                value={vehicleForm.plateNumber}
                onChangeText={(t) => setVehicleForm((f) => ({ ...f, plateNumber: t }))}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Hãng xe / Dòng xe</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Ví dụ: VinFast VF8, Toyota Cross"
                value={vehicleForm.brand}
                onChangeText={(t) => setVehicleForm((f) => ({ ...f, brand: t }))}
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Màu sắc</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Ví dụ: Trắng ngọc trai, Đen"
                value={vehicleForm.color}
                onChangeText={(t) => setVehicleForm((f) => ({ ...f, color: t }))}
              />
            </View>

            <View style={styles.dialogActions}>
              <Pressable onPress={() => setShowAddVehicleModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Hủy bỏ</Text>
              </Pressable>
              <Pressable onPress={handleAddVehicle} disabled={savingVehicle} style={styles.saveBtn}>
                {savingVehicle ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Lưu phương tiện</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: CẬP NHẬT HỒ SƠ NGƯỜI DÙNG */}
      <Modal visible={showEditProfileModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="person-circle" size={20} color={colors.primary} />
                <Text style={styles.dialogTitle}>Cập nhật Hồ sơ Cá nhân</Text>
              </View>
              <Pressable onPress={() => setShowEditProfileModal(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Họ và tên</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Nhập họ và tên đầy đủ"
                value={profileForm.fullName}
                onChangeText={(t) => setProfileForm((f) => ({ ...f, fullName: t }))}
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.formLabel}>Số điện thoại liên hệ</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Ví dụ: 0901234567"
                keyboardType="phone-pad"
                value={profileForm.phone}
                onChangeText={(t) => setProfileForm((f) => ({ ...f, phone: t }))}
              />
            </View>

            <View style={styles.dialogActions}>
              <Pressable onPress={() => setShowEditProfileModal(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Hủy bỏ</Text>
              </Pressable>
              <Pressable onPress={handleUpdateProfile} disabled={savingProfile} style={styles.saveBtn}>
                {savingProfile ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Lưu cập nhật</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =====================================================================
//  SUB-SECTIONS & CARDS
// =====================================================================

function CompactSummaryCard({ summary, recommendedLot, onNavigateMap }) {
  const percentAvailable = summary.totalCap
    ? Math.round((summary.totalFree / summary.totalCap) * 100)
    : 0;

  return (
    <LinearGradient colors={['#1E293B', '#0F172A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
      <View style={styles.heroHeader}>
        <View style={styles.heroBadge}>
          <Ionicons name="sparkles" size={13} color="#38BDF8" />
          <Text style={styles.heroBadgeText}>Bãi đỗ thông minh IoT</Text>
        </View>
        <Text style={styles.heroSubText}>Đồng bộ tức thời 24/7</Text>
      </View>

      <View style={styles.heroStatsRow}>
        <View style={styles.heroStatItem}>
          <Text style={styles.heroStatNum}>{summary.totalFree}</Text>
          <Text style={styles.heroStatLabel}>Ô trống sẵn sàng</Text>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStatItem}>
          <Text style={[styles.heroStatNum, { color: '#EF4444' }]}>{summary.totalOccupied}</Text>
          <Text style={styles.heroStatLabel}>Chỗ đang có xe</Text>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStatItem}>
          <Text style={[styles.heroStatNum, { color: '#38BDF8' }]}>{percentAvailable}%</Text>
          <Text style={styles.heroStatLabel}>Tỷ lệ trống</Text>
        </View>
      </View>

      {/* GỢI Ý BÃI ĐỖ GẦN NHẤT */}
      {recommendedLot && (
        <Pressable onPress={onNavigateMap} style={styles.recommendedPill}>
          <Ionicons name="navigate-circle" size={16} color="#38BDF8" />
          <Text style={styles.recommendedPillText} numberOfLines={1}>
            Gợi ý gần nhất: <Text style={{ fontWeight: '800', color: '#FFFFFF' }}>{recommendedLot.name}</Text> • Cách bạn {recommendedLot.distanceKm} km ({recommendedLot.freeSlots} ô trống)
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
        </Pressable>
      )}
    </LinearGradient>
  );
}

function ActiveTicketCard({ resv, lots, onPress }) {
  const lot = lots.find((l) => l.id === resv.lotId);
  const cfg = RESV_CONFIG[resv.status] || RESV_CONFIG.active;
  const minsLeft = resv.expiresAt
    ? Math.max(0, Math.round((new Date(resv.expiresAt) - Date.now()) / 60000))
    : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ticketCard, pressed && styles.btnPressed]}
      accessibilityRole="button"
      accessibilityLabel="Xem chi tiết đặt chỗ"
    >
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
          <Text style={styles.slotPillLabel}>{resv.zone ? `KHU ${resv.zone}` : 'Ô ĐỖ'}</Text>
          <Text style={styles.slotPillNum}>#{resv.slotNumber}</Text>
        </View>
      </View>

      <View style={styles.ticketFooter}>
        <View style={styles.ticketMeta}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.ticketMetaText}>Giữ chỗ: {resv.minutes} phút</Text>
        </View>
        <View style={styles.ticketMeta}>
          <Ionicons name="qr-code-outline" size={14} color={colors.textMuted} />
          <Text style={styles.ticketMetaText}>{resv.code || formatTimeAgo(resv.createdAt)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

/** Tab 1: Danh sách bãi đỗ với bộ lọc, tìm kiếm, sắp xếp & tiện ích */
function LotsTabSection({
  lots,
  searchQuery,
  setSearchQuery,
  sortBy,
  setSortBy,
  filterFeature,
  setFilterFeature,
  expandedLotId,
  selectedDetail,
  loadingDetail,
  onToggleDetail,
  onDirections,
  onBook,
}) {
  return (
    <View style={styles.sectionWrap}>
      {/* THANH TÌM KIẾM BÃI ĐỖ */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={17} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Tìm bãi đỗ xe theo tên, đường, khu vực..."
          placeholderTextColor={colors.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery ? (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* BỘ LỌC VÀ SẮP XẾP NHANH */}
      <View style={styles.filterChipRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Pressable
            onPress={() => setSortBy('distance')}
            style={[styles.filterChip, sortBy === 'distance' && styles.filterChipActive]}
          >
            <Ionicons name="navigate" size={12} color={sortBy === 'distance' ? '#2563EB' : colors.textMuted} />
            <Text style={[styles.filterChipText, sortBy === 'distance' && styles.filterChipTextActive]}>
              Gần nhất
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSortBy('price')}
            style={[styles.filterChip, sortBy === 'price' && styles.filterChipActive]}
          >
            <Ionicons name="pricetag" size={12} color={sortBy === 'price' ? '#2563EB' : colors.textMuted} />
            <Text style={[styles.filterChipText, sortBy === 'price' && styles.filterChipTextActive]}>
              Giá rẻ nhất
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setFilterFeature(filterFeature === 'free' ? 'all' : 'free')}
            style={[styles.filterChip, filterFeature === 'free' && styles.filterChipActive]}
          >
            <Ionicons name="checkmark-circle" size={12} color={filterFeature === 'free' ? '#2563EB' : colors.textMuted} />
            <Text style={[styles.filterChipText, filterFeature === 'free' && styles.filterChipTextActive]}>
              Còn chỗ trống
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setFilterFeature(filterFeature === 'ev' ? 'all' : 'ev')}
            style={[styles.filterChip, filterFeature === 'ev' && styles.filterChipActive]}
          >
            <Ionicons name="flash" size={12} color={filterFeature === 'ev' ? '#2563EB' : colors.textMuted} />
            <Text style={[styles.filterChipText, filterFeature === 'ev' && styles.filterChipTextActive]}>
              Sạc EV
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setFilterFeature(filterFeature === 'roof' ? 'all' : 'roof')}
            style={[styles.filterChip, filterFeature === 'roof' && styles.filterChipActive]}
          >
            <Ionicons name="umbrella" size={12} color={filterFeature === 'roof' ? '#2563EB' : colors.textMuted} />
            <Text style={[styles.filterChipText, filterFeature === 'roof' && styles.filterChipTextActive]}>
              Có mái che
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Bãi đỗ xe trực tuyến</Text>
        <Text style={styles.sectionSubTitle}>{lots.length} kết quả phù hợp</Text>
      </View>

      {lots.length === 0 ? (
        <EmptyNotice
          icon="business-outline"
          title="Không tìm thấy bãi đỗ phù hợp"
          subtitle="Hãy thử thay đổi từ khóa tìm kiếm hoặc bỏ bớt bộ lọc."
        />
      ) : (
        lots.map((lot) => {
          const isExpanded = expandedLotId === lot.id;
          const freeCount = lot.freeSlots ?? 0;
          const total = lot.totalSlots || 0;
          const occupiedCount = Math.max(0, total - freeCount);
          const freeRatio = total ? Math.min(100, Math.round((freeCount / total) * 100)) : 0;

          return (
            <View
              key={lot.id}
              style={[
                styles.lotCard,
                lot.isFull && styles.lotCardFull,
                lot.isMaintenance && styles.lotCardMaintenance,
              ]}
            >
              {/* CẢNH BÁO NẾU BÃI HẾT CHỖ HOẶC TẠM NGỪNG */}
              {lot.isFull && (
                <View style={styles.alertFullBar}>
                  <Ionicons name="alert-circle" size={14} color="#DC2626" />
                  <Text style={styles.alertFullText}>
                    BÃI ĐÃ HẾT CHỖ – Vui lòng chọn bãi đỗ lân cận còn trống
                  </Text>
                </View>
              )}
              {lot.isMaintenance && (
                <View style={styles.alertMaintenanceBar}>
                  <Ionicons name="construct" size={14} color="#D97706" />
                  <Text style={styles.alertMaintenanceText}>
                    TẠM NGỪNG HOẠT ĐỘNG – Trạm đang bảo trì tín hiệu
                  </Text>
                </View>
              )}

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

                  {/* KHOẢNG CÁCH & GIỜ HOẠT ĐỘNG */}
                  <View style={styles.metaRow}>
                    <View style={styles.metaBadge}>
                      <Ionicons name="navigate" size={11} color="#2563EB" />
                      <Text style={styles.metaBadgeText}>Cách {lot.distanceKm} km</Text>
                    </View>
                    <View style={styles.metaBadge}>
                      <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                      <Text style={styles.metaBadgeText}>{lot.hours}</Text>
                    </View>
                  </View>
                </View>

                {/* BẢNG GIÁ */}
                <View style={styles.lotPriceTag}>
                  <Text style={styles.lotPriceText}>{formatVND(lot.pricePerHour)}</Text>
                  <Text style={styles.lotPriceUnit}>/giờ</Text>
                </View>
              </View>

              {/* TIỆN ÍCH CỦA BÃI XE */}
              <View style={styles.featureTagsRow}>
                {lot.features.map((feat, idx) => (
                  <View key={idx} style={styles.featureTag}>
                    <Text style={styles.featureTagText}>{feat}</Text>
                  </View>
                ))}
              </View>

              {/* THỐNG KÊ SỨC CHỨA KHU VỰC: TỔNG SỐ CHỖ, CHỖ TRỐNG, ĐANG CÓ XE */}
              <View style={styles.capacityStatsBar}>
                <View style={styles.capacityItem}>
                  <Text style={styles.capacityNum}>{total}</Text>
                  <Text style={styles.capacityLabel}>Tổng số chỗ</Text>
                </View>
                <View style={styles.capacityDivider} />
                <View style={styles.capacityItem}>
                  <Text style={[styles.capacityNum, { color: '#10B981' }]}>{freeCount}</Text>
                  <Text style={styles.capacityLabel}>Chỗ trống</Text>
                </View>
                <View style={styles.capacityDivider} />
                <View style={styles.capacityItem}>
                  <Text style={[styles.capacityNum, { color: '#EF4444' }]}>{occupiedCount}</Text>
                  <Text style={styles.capacityLabel}>Đang có xe</Text>
                </View>
              </View>

              {/* THANH ĐO TIẾN ĐỘ SỨC CHỨA */}
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
                    Tình trạng: <Text style={{ fontWeight: '700', color: colors.text }}>{freeCount}</Text>/{total} ô trống
                  </Text>
                  <Text style={styles.meterPercentText}>{freeRatio}% khả dụng</Text>
                </View>
              </View>

              {/* NÚT THAO TÁC: CHỈ ĐƯỜNG & SƠ ĐỒ Ô */}
              <View style={styles.lotActionFooter}>
                <Pressable
                  onPress={() => onDirections(lot)}
                  style={styles.directionsBtn}
                  hitSlop={6}
                >
                  <Ionicons name="navigate-outline" size={14} color="#2563EB" />
                  <Text style={styles.directionsBtnText}>Chỉ đường</Text>
                </Pressable>

                <Pressable
                  onPress={() => onBook(lot.id)}
                  style={({ pressed }) => [styles.directionsBtn, pressed && styles.btnPressed]}
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Ionicons name="ticket-outline" size={14} color="#2563EB" />
                  <Text style={styles.directionsBtnText}>Đặt chỗ</Text>
                </Pressable>

                <Pressable
                  onPress={() => onToggleDetail(lot.id)}
                  style={({ pressed }) => [styles.viewDetailBtn, pressed && styles.btnPressed]}
                >
                  <Text style={styles.viewDetailBtnText}>
                    {isExpanded ? 'Ẩn sơ đồ ô' : 'Xem sơ đồ ô đỗ'}
                  </Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.primary}
                  />
                </Pressable>
              </View>

              {/* SƠ ĐỒ Ô ĐỖ TRỰC QUAN THEO THỜI GIAN THỰC */}
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
                          <Pressable
                            key={s.id}
                            disabled={!isFree}
                            onPress={() => onBook(lot.id, s.slotNumber)}
                            style={({ pressed }) => [styles.slotItem, { borderColor: color, backgroundColor: bg }, pressed && styles.btnPressed]}
                            accessibilityRole="button"
                            accessibilityLabel={isFree ? `Đặt ô ${s.slotNumber}` : `Ô ${s.slotNumber}`}
                          >
                            <Ionicons
                              name={isFree ? 'radio-button-off' : 'car'}
                              size={18}
                              color={color}
                            />
                            <Text style={[styles.slotItemNum, { color }]}>
                              {s.zone ? `${s.zone}·` : 'Ô '}#{s.slotNumber}
                            </Text>
                            {isOccupied && s.distanceCm && s.distanceCm < 400 ? (
                              <Text style={styles.slotItemDist}>{s.distanceCm} cm</Text>
                            ) : (
                              <Text style={styles.slotItemDist}>
                                {isFree ? 'Chạm để đặt' : isOccupied ? 'Đang đỗ' : 'Đã giữ'}
                              </Text>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })
      )}
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

/** Tab 2: Lịch sử đặt chỗ */
function ReservationsTabSection({ reservations, lots, onOpen, onNew }) {
  const newBtn = (
    <Pressable
      onPress={onNew}
      style={({ pressed }) => [styles.directionsBtn, { alignSelf: 'flex-start', marginBottom: 10 }, pressed && styles.btnPressed]}
      accessibilityRole="button"
    >
      <Ionicons name="add-circle-outline" size={15} color="#2563EB" />
      <Text style={styles.directionsBtnText}>Đặt chỗ mới</Text>
    </Pressable>
  );

  if (reservations.length === 0) {
    return (
      <View>
        {newBtn}
        <EmptyNotice
          icon="ticket-outline"
          title="Chưa có đặt chỗ"
          subtitle="Khi bạn đặt chỗ trước, thông tin vé sẽ xuất hiện tại đây."
        />
      </View>
    );
  }

  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Lịch sử đặt chỗ</Text>
        <Text style={styles.sectionSubTitle}>{reservations.length} lượt ghi nhận</Text>
      </View>
      {newBtn}

      {reservations.map((item) => {
        const lot = lots.find((l) => l.id === item.lotId);
        const cfg = RESV_CONFIG[item.status] || RESV_CONFIG.pending;

        return (
          <Pressable
            key={item.id}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [styles.historyCard, pressed && styles.btnPressed]}
            accessibilityRole="button"
          >
            <View style={styles.historyLeft}>
              <View style={[styles.historyIconCircle, { backgroundColor: cfg.bg }]}>
                <Ionicons name={cfg.icon} size={18} color={cfg.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyLotName}>{lot?.name || item.lotId}</Text>
                <Text style={styles.historyMeta}>
                  {item.zone ? `Khu ${item.zone} • ` : ''}Ô #{item.slotNumber} • giữ {item.minutes} phút{item.code ? ` • ${item.code}` : ''}
                </Text>
              </View>
            </View>

            <View style={styles.historyRight}>
              <View style={[styles.historyStatusBadge, { backgroundColor: cfg.bg }]}>
                <Text style={[styles.historyStatusText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              <Text style={styles.historyTimeAgo}>{formatTimeAgo(item.createdAt)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tab 3: Xe cá nhân (Hỗ trợ thêm xe & xóa xe) */
function VehiclesTabSection({ vehicles, onOpenAdd, onDelete }) {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionTitle}>Phương tiện đã đăng ký</Text>
          <Text style={styles.sectionSubTitle}>{vehicles.length} xe cá nhân đã lưu</Text>
        </View>

        <Pressable onPress={onOpenAdd} style={styles.addVehicleHeaderBtn}>
          <Ionicons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.addVehicleHeaderBtnText}>Thêm xe mới</Text>
        </Pressable>
      </View>

      {vehicles.length === 0 ? (
        <EmptyNotice
          icon="car-sport-outline"
          title="Chưa có phương tiện nào"
          subtitle="Hãy bấm '+ Thêm xe mới' để đăng ký biển số giúp hệ thống tự động nhận diện."
        />
      ) : (
        vehicles.map((v) => (
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

            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={styles.vehicleActiveTag}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                <Text style={styles.vehicleActiveText}>Khả dụng</Text>
              </View>
              <Pressable onPress={() => onDelete(v)} style={styles.deleteVehicleBtn} hitSlop={6}>
                <Ionicons name="trash-outline" size={15} color="#EF4444" />
                <Text style={styles.deleteVehicleBtnText}>Xóa</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/** Tab 4: Hồ sơ & Cài đặt (Hỗ trợ cập nhật hồ sơ) */
function AccountTabSection({ user, onOpenEdit, onLogout }) {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.profileBox}>
        <View style={styles.avatarWrap}>
          <Ionicons name="person" size={28} color="#1D4ED8" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.profileFullName}>
            {user?.fullName || user?.username || 'Chưa cập nhật tên'}
          </Text>
          <Text style={styles.profileRoleBadge}>
            {user?.role === 'admin' ? '🛡️ Quản trị viên hệ thống' : '👤 Khách hàng tiêu chuẩn'}
          </Text>
        </View>

        <Pressable onPress={onOpenEdit} style={styles.editProfileBtn}>
          <Ionicons name="create-outline" size={16} color="#2563EB" />
          <Text style={styles.editProfileBtnText}>Sửa</Text>
        </Pressable>
      </View>

      <View style={styles.detailsCard}>
        <ProfileField icon="mail-outline" label="Địa chỉ Email" value={user?.email} />
        <ProfileField icon="at-outline" label="Tên đăng nhập" value={user?.username} />
        <ProfileField icon="call-outline" label="Số điện thoại" value={user?.phone || 'Chưa cập nhật'} />
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
//  STYLES
// =====================================================================
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 36 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
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

  // Quick Actions Bar
  quickActionsBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'space-between',
    ...shadow.card,
  },
  quickActionItem: { flex: 1, alignItems: 'center' },
  quickActionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  quickActionLabel: { fontSize: 11, fontWeight: '600', color: colors.text },

  // Location Bar
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  locationText: { fontSize: 12, fontWeight: '600', color: '#1E40AF' },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  locationBtnText: { fontSize: 11, fontWeight: '700', color: '#2563EB' },

  // Hero Card
  heroCard: {
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.card,
  },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(56,189,248,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  heroBadgeText: { fontSize: 11, color: '#38BDF8', fontWeight: '700' },
  heroSubText: { fontSize: 11, color: '#94A3B8' },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroStatItem: { flex: 1, alignItems: 'center' },
  heroStatNum: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  heroStatLabel: { fontSize: 10.5, color: '#94A3B8', marginTop: 3 },
  heroDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' },
  recommendedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 8,
    marginTop: 12,
    gap: 6,
  },
  recommendedPillText: { flex: 1, fontSize: 11.5, color: '#E2E8F0' },

  // Shortcut
  routeShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
    ...shadow.card,
  },
  routeShortcutIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  routeShortcutTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  routeShortcutSub: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },

  // Ticket Card
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    ...shadow.card,
  },
  ticketTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  ticketBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  ticketBadgeText: { fontSize: 11.5, fontWeight: '700' },
  ticketTimer: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF7ED', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  ticketTimerText: { fontSize: 11.5, color: '#EA580C', fontWeight: '700' },
  ticketMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 4 },
  ticketLotName: { fontSize: 16, fontWeight: '800', color: colors.text },
  ticketAddress: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  slotPill: { backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  slotPillLabel: { fontSize: 9.5, fontWeight: '700', color: colors.primary },
  slotPillNum: { fontSize: 16, fontWeight: '900', color: colors.primary },
  ticketFooter: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  ticketMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ticketMetaText: { fontSize: 11.5, color: colors.textMuted },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 4,
    marginBottom: 14,
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
  tabButtonActive: { backgroundColor: '#EFF6FF' },
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

  // Search & Filter
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.text, height: '100%' },
  filterChipRow: { marginBottom: 4 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  filterChipText: { fontSize: 11.5, color: colors.textMuted, fontWeight: '600' },
  filterChipTextActive: { color: '#2563EB', fontWeight: '700' },

  // Lot Card
  lotCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow.card,
  },
  lotCardFull: { borderColor: '#FECACA', backgroundColor: '#FFFDFD' },
  lotCardMaintenance: { borderColor: '#FDE68A', opacity: 0.85 },
  alertFullBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF2F2', padding: 6, borderRadius: 6, marginBottom: 10 },
  alertFullText: { fontSize: 11, color: '#DC2626', fontWeight: '700' },
  alertMaintenanceBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFBEB', padding: 6, borderRadius: 6, marginBottom: 10 },
  alertMaintenanceText: { fontSize: 11, color: '#D97706', fontWeight: '700' },

  lotCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  lotNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lotNameText: { fontSize: 15, fontWeight: '700', color: colors.text },
  iotBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  iotOnline: { backgroundColor: '#ECFDF5' },
  iotOffline: { backgroundColor: '#F1F5F9' },
  iotText: { fontSize: 10, fontWeight: '700' },
  iotTextOnline: { color: '#10B981' },
  iotTextOffline: { color: '#64748B' },
  lotAddressText: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  metaBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaBadgeText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  lotPriceTag: { alignItems: 'flex-end', backgroundColor: '#F8FAFC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  lotPriceText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  lotPriceUnit: { fontSize: 10, color: colors.textMuted },

  featureTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  featureTag: { backgroundColor: '#F1F5F9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  featureTagText: { fontSize: 10.5, color: colors.textMuted, fontWeight: '500' },

  // Sức chứa
  capacityStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingVertical: 8,
    marginTop: 10,
  },
  capacityItem: { flex: 1, alignItems: 'center' },
  capacityNum: { fontSize: 14, fontWeight: '800', color: colors.text },
  capacityLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  capacityDivider: { width: 1, height: 18, backgroundColor: '#E2E8F0' },

  // Meter
  meterContainer: { marginTop: 10 },
  meterTrack: { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3 },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  meterValueText: { fontSize: 11.5, color: colors.textMuted },
  meterPercentText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },

  // Action Footer
  lotActionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  directionsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  directionsBtnText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  viewDetailBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  viewDetailBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  // Slot Grid
  slotGridWrap: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  slotGridHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  slotGridTitle: { fontSize: 12, fontWeight: '700', color: colors.text },
  slotLegends: { flexDirection: 'row', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 10, color: colors.textMuted },
  slotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotItem: {
    width: (SCREEN_W - 32 - 28 - 16) / 3,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    gap: 3,
  },
  slotItemNum: { fontSize: 12, fontWeight: '800' },
  slotItemDist: { fontSize: 10, color: colors.textMuted },

  // History Card
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  historyLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  historyIconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  historyLotName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  historyMeta: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
  historyRight: { alignItems: 'flex-end', gap: 4 },
  historyStatusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  historyStatusText: { fontSize: 10.5, fontWeight: '700' },
  historyTimeAgo: { fontSize: 10, color: colors.textMuted },

  // Vehicle Card & Add
  addVehicleHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  addVehicleHeaderBtnText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' },
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  vehiclePlateBox: {
    backgroundColor: '#0F172A',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 80,
  },
  vehiclePlatePrefix: { fontSize: 8.5, color: '#94A3B8', fontWeight: '800' },
  vehiclePlateNum: { fontSize: 13, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  vehicleDetails: { flex: 1 },
  vehicleBrandText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  vehicleColorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  vehicleColorText: { fontSize: 11.5, color: colors.textMuted },
  vehicleActiveTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  vehicleActiveText: { fontSize: 10.5, fontWeight: '700', color: '#10B981' },
  deleteVehicleBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 2 },
  deleteVehicleBtnText: { fontSize: 11, color: '#EF4444', fontWeight: '600' },

  // Profile
  profileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileFullName: { fontSize: 15, fontWeight: '800', color: colors.text },
  profileRoleBadge: { fontSize: 11.5, color: colors.textMuted, marginTop: 3 },
  editProfileBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  editProfileBtnText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  fieldLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldLabel: { fontSize: 12.5, color: colors.textMuted },
  fieldValue: { fontSize: 12.5, fontWeight: '600', color: colors.text, maxWidth: 180 },
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
  logoutCardBtnText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
  appFooterInfo: { alignItems: 'center', marginTop: 8 },
  appFooterText: { fontSize: 11, color: colors.placeholder },

  // Modal dialogs
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  dialogCard: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: 18, ...shadow.card },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  dialogTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  formField: { marginBottom: 12 },
  formLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },
  formInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 40,
    fontSize: 13,
    color: colors.text,
  },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: '#F1F5F9' },
  cancelBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: colors.primary },
  saveBtnText: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 5 },
  emptyIconCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: 'center', maxWidth: 260 },
});
