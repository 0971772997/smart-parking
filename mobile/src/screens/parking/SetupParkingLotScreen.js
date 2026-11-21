// SETUP PARKING LOT SCREEN
// Màn hình Thiết lập, Sơ đồ mặt bằng ô đỗ đời thực & Quản lý Lộ trình Bãi đỗ xe trên Bản đồ
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { lotsApi } from '../../api/lots';
import { useAuth } from '../../context/AuthContext';
import { colors, radius, shadow } from '../../theme';

const { width: SCREEN_W } = Dimensions.get('window');

// Tọa độ mô phỏng cho bản đồ khu vực
const DEFAULT_COORDS = [
  { x: 0.28, y: 0.35, label: 'Khu vực Hải Châu' },
  { x: 0.65, y: 0.28, label: 'Khu vực Sơn Trà' },
  { x: 0.45, y: 0.68, label: 'Khu vực Ngũ Hành Sơn' },
  { x: 0.22, y: 0.75, label: 'Khu vực Cẩm Lệ' },
];

export default function SetupParkingLotScreen({ navigation, route }) {
  const initialLotId = route?.params?.lotId;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Danh sách bãi đỗ gốc từ server
  const [allLots, setAllLots] = useState([]);
  const [loading, setLoading] = useState(true);

  // Show/Hide excluded lots (Ẩn / Hiện bãi đỗ bị loại khỏi lộ trình)
  const [hideExcluded, setHideExcluded] = useState(false);

  // Danh sách ID các bãi đỗ nằm trong Lộ trình ưu tiên (Included Route)
  const [includedLotIds, setIncludedLotIds] = useState([]);

  // Chế độ xem bản đồ: 'realistic' (Sơ đồ ô vuông đời thực) hoặc 'city' (Bản đồ khu vực)
  const [mapMode, setMapMode] = useState('realistic');

  // Bãi đỗ đang được xem sơ đồ mặt bằng chi tiết
  const [activeLotId, setActiveLotId] = useState(initialLotId || null);
  const [activeLotDetail, setActiveLotDetail] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Ô đỗ đang được chọn trên sơ đồ đời thực (để xem chi tiết cảm biến)
  const [selectedSlot, setSelectedSlot] = useState(null);

  // Tìm kiếm địa điểm trên bản đồ
  const [searchQuery, setSearchQuery] = useState('');

  // Giờ xuất phát & Dự tính thời gian
  const [startedTime, setStartedTime] = useState('08:00'); // HH:mm
  const [parkingDurationHours, setParkingDurationHours] = useState('2'); // giờ

  // Dialog thông tin lộ trình
  const [showRouteDialog, setShowRouteDialog] = useState(false);

  // Chỉnh sửa bãi đỗ (dành cho Admin)
  const [editingLot, setEditingLot] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', address: '', pricePerHour: '10000' });
  const [savingEdit, setSavingEdit] = useState(false);

  // Cập nhật khi có route.params.lotId
  useEffect(() => {
    if (initialLotId) {
      setActiveLotId(initialLotId);
      setSelectedSlot(null);
    }
  }, [initialLotId]);

  // Tải danh sách bãi đỗ
  const fetchLots = useCallback(async () => {
    setLoading(true);
    try {
      const data = await lotsApi.list();
      setAllLots(data || []);
      if (data && data.length > 0) {
        if (!activeLotId && !initialLotId) {
          setActiveLotId(data[0].id);
        }
        if (includedLotIds.length === 0) {
          setIncludedLotIds([initialLotId || data[0].id]);
        }
      }
    } catch {
      Alert.alert('Thông báo', 'Không thể kết nối máy chủ để lấy danh sách bãi đỗ.');
    } finally {
      setLoading(false);
    }
  }, [activeLotId, initialLotId, includedLotIds.length]);

  // Tải chi tiết các ô đỗ của bãi đang kích hoạt
  const fetchLotDetail = useCallback(async (lotId) => {
    if (!lotId) return;
    setLoadingSlots(true);
    try {
      const detail = await lotsApi.detail(lotId);
      setActiveLotDetail(detail);
    } catch {
      setActiveLotDetail(null);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    fetchLots();
  }, [fetchLots]);

  useEffect(() => {
    if (activeLotId) {
      fetchLotDetail(activeLotId);
    }
  }, [activeLotId, fetchLotDetail]);

  // Map các bãi đỗ kèm tọa độ biểu diễn
  const mappedLots = useMemo(() => {
    return allLots.map((lot, idx) => {
      const coord = DEFAULT_COORDS[idx % DEFAULT_COORDS.length];
      return {
        ...lot,
        mapX: coord.x,
        mapY: coord.y,
        isIncluded: includedLotIds.includes(lot.id),
      };
    });
  }, [allLots, includedLotIds]);

  // Lọc theo tìm kiếm & ẩn/hiện loại trừ
  const filteredLots = useMemo(() => {
    let result = mappedLots;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (l) => l.name.toLowerCase().includes(q) || (l.address && l.address.toLowerCase().includes(q))
      );
    }
    if (hideExcluded) {
      result = result.filter((l) => l.isIncluded);
    }
    return result;
  }, [mappedLots, searchQuery, hideExcluded]);

  // Danh sách bãi đỗ trong lộ trình theo thứ tự
  const routeLots = useMemo(() => {
    return includedLotIds
      .map((id) => mappedLots.find((l) => l.id === id))
      .filter(Boolean);
  }, [includedLotIds, mappedLots]);

  // Bãi đỗ hiện đang được chọn xem sơ đồ
  const currentLot = useMemo(() => {
    return mappedLots.find((l) => l.id === activeLotId) || mappedLots[0];
  }, [mappedLots, activeLotId]);

  const addLotToRoute = (lotId) => {
    if (!includedLotIds.includes(lotId)) {
      setIncludedLotIds([...includedLotIds, lotId]);
    }
  };

  const removeLotFromRoute = (lotId) => {
    setIncludedLotIds(includedLotIds.filter((id) => id !== lotId));
  };

  // Sắp xếp thứ tự ưu tiên các bãi đỗ trên tuyến
  const moveRouteLot = (index, direction) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= includedLotIds.length) return;
    const newArr = [...includedLotIds];
    const temp = newArr[index];
    newArr[index] = newArr[targetIdx];
    newArr[targetIdx] = temp;
    setIncludedLotIds(newArr);
  };

  // Tính toán thời gian tới bãi cuối & chi phí đỗ
  const routeCalculation = useMemo(() => {
    const durationMins = (parseFloat(parkingDurationHours) || 1) * 60;
    const [h, m] = startedTime.split(':').map((x) => parseInt(x, 10) || 0);
    const startMinsTotal = h * 60 + m;

    const travelTimeMins = Math.max(0, (routeLots.length - 1) * 15);
    const arrivalMinsTotal = startMinsTotal + travelTimeMins;
    const endMinsTotal = arrivalMinsTotal + durationMins;

    const formatHHMM = (totalM) => {
      const hours = Math.floor((totalM % 1440) / 60);
      const minutes = totalM % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    };

    const lastLot = routeLots[routeLots.length - 1];
    const rate = lastLot ? lastLot.pricePerHour : 10000;
    const estimatedFee = Math.ceil(durationMins / 60) * rate;

    return {
      arrivalTime: formatHHMM(arrivalMinsTotal),
      finishTime: formatHHMM(endMinsTotal),
      travelTimeMins,
      estimatedFee,
      lastLotName: lastLot?.name || 'Chưa chọn bãi đích',
    };
  }, [startedTime, parkingDurationHours, routeLots]);

  // Chỉnh sửa thông tin bãi đỗ
  const openEditLotDialog = (lot) => {
    setEditingLot(lot);
    setEditForm({
      name: lot.name,
      address: lot.address || '',
      pricePerHour: String(lot.pricePerHour || 10000),
    });
  };

  const saveEditLot = async () => {
    if (!editingLot) return;
    if (!editForm.name.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên bãi đỗ.');
      return;
    }
    setSavingEdit(true);
    try {
      await lotsApi.update(editingLot.id, {
        name: editForm.name.trim(),
        address: editForm.address.trim(),
        pricePerHour: parseInt(editForm.pricePerHour, 10) || 10000,
      });
      Alert.alert('Thành công', 'Đã cập nhật thông tin bãi đỗ.');
      setEditingLot(null);
      fetchLots();
      if (activeLotId === editingLot.id) {
        fetchLotDetail(activeLotId);
      }
    } catch (e) {
      Alert.alert('Lỗi', e.message || 'Không thể lưu thông tin bãi đỗ.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Xóa bãi đỗ
  const handleDeleteLot = (lot) => {
    Alert.alert(
      'Xóa bãi đỗ',
      `Bạn có chắc chắn muốn xóa bãi đỗ "${lot.name}" khỏi hệ thống?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa ngay',
          style: 'destructive',
          onPress: async () => {
            try {
              await lotsApi.remove(lot.id);
              Alert.alert('Thành công', 'Đã xóa bãi đỗ khỏi hệ thống.');
              removeLotFromRoute(lot.id);
              fetchLots();
            } catch (e) {
              Alert.alert('Lỗi', e.message || 'Không thể xóa bãi đỗ này.');
            }
          },
        },
      ]
    );
  };

  // Danh sách slots của bãi hiện tại
  const currentSlots = useMemo(() => {
    if (activeLotDetail?.slots && activeLotDetail.slots.length > 0) {
      return activeLotDetail.slots;
    }
    return [
      { id: 1, slotNumber: 1, state: 'free', distanceCm: 150 },
      { id: 2, slotNumber: 2, state: 'occupied', distanceCm: 14 },
      { id: 3, slotNumber: 3, state: 'free', distanceCm: 160 },
      { id: 4, slotNumber: 4, state: 'reserved', distanceCm: 145 },
    ];
  }, [activeLotDetail]);

  // Phân chia ô đỗ thành 2 dãy: Dãy A (Hàng trên) & Dãy B (Hàng dưới) như bãi đỗ xe thực tế
  const { topRowSlots, bottomRowSlots } = useMemo(() => {
    const mid = Math.ceil(currentSlots.length / 2);
    return {
      topRowSlots: currentSlots.slice(0, mid),
      bottomRowSlots: currentSlots.slice(mid),
    };
  }, [currentSlots]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      {/* WEB CONTAINER ĐỂ CĂN GIỮA ĐẸP TRÊN MÀN HÌNH MÁY TÍNH */}
      <View style={styles.webContainer}>
        {/* TOP HEADER */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.headerTitle}>Sơ đồ Mặt bằng Bãi đỗ xe</Text>
            <Text style={styles.headerSubtitle}>Mô phỏng mặt bằng thực tế • Cảm biến IoT thời gian thực</Text>
          </View>
          <Pressable
            onPress={() => setShowRouteDialog(true)}
            style={styles.headerRouteBtn}
            accessibilityLabel="Xem thông tin lộ trình"
          >
            <Ionicons name="navigate" size={15} color="#FFFFFF" />
            <Text style={styles.headerRouteBtnText}>Lộ trình ({routeLots.length})</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* SEARCH LOCATION ON MAP */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={17} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Tìm bãi đỗ hoặc địa chỉ khu vực..."
              placeholderTextColor={colors.placeholder}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* CHỌN BÃI ĐỖ & CHUYỂN ĐỔI CHẾ ĐỘ XEM MAP */}
          <View style={styles.mapToolBar}>
            {/* Danh sách bãi đỗ để chọn xem mặt bằng */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lotSelectorScroll} contentContainerStyle={{ gap: 6 }}>
              {allLots.map((l) => {
                const isCurrent = (activeLotId || allLots[0]?.id) === l.id;
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => {
                      setActiveLotId(l.id);
                      setSelectedSlot(null);
                    }}
                    style={[styles.lotChip, isCurrent && styles.lotChipActive]}
                  >
                    <View style={[styles.lotChipDot, { backgroundColor: l.online ? '#10B981' : '#94A3B8' }]} />
                    <Text style={[styles.lotChipText, isCurrent && styles.lotChipTextActive]}>
                      {l.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Nút chuyển chế độ xem: Realistic Bay vs City Map */}
            <View style={styles.modeSwitchRow}>
              <Pressable
                onPress={() => setMapMode('realistic')}
                style={[styles.modeBtn, mapMode === 'realistic' && styles.modeBtnActive]}
              >
                <Ionicons name="grid" size={13} color={mapMode === 'realistic' ? '#1D4ED8' : colors.textMuted} />
                <Text style={[styles.modeBtnText, mapMode === 'realistic' && styles.modeBtnTextActive]}>Mặt bằng ô đỗ</Text>
              </Pressable>
              <Pressable
                onPress={() => setMapMode('city')}
                style={[styles.modeBtn, mapMode === 'city' && styles.modeBtnActive]}
              >
                <Ionicons name="map" size={13} color={mapMode === 'city' ? '#1D4ED8' : colors.textMuted} />
                <Text style={[styles.modeBtnText, mapMode === 'city' && styles.modeBtnTextActive]}>Bản đồ đô thị</Text>
              </Pressable>
            </View>
          </View>

          {/* PHẦN MAP: HIỂN THỊ CÁC VỊ TRÍ Ô VUÔNG BÃI ĐỖ NHƯ ĐỜI THỰC */}
          <View style={styles.mapWrapper}>
            {mapMode === 'realistic' ? (
              /* ========================================================
                 CHẾ ĐỘ 1: SƠ ĐỒ MẶT BẰNG Ô VUÔNG ĐỖ XE NHƯ ĐỜI THỰC
                 ======================================================== */
              <View style={styles.realisticContainer}>
                {/* Thanh tiêu đề mặt bằng bãi xe */}
                <View style={styles.realisticHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={styles.pulseDot} />
                    <Text style={styles.realisticLotTitle}>
                      {currentLot?.name || 'Mặt bằng bãi đỗ xe'}
                    </Text>
                  </View>
                  <View style={styles.realisticStatsBadge}>
                    <Text style={styles.realisticStatsText}>
                      Còn trống: <Text style={{ color: '#10B981', fontWeight: '900' }}>{currentLot?.freeSlots ?? 0}</Text>/{currentLot?.totalSlots ?? 4} ô
                    </Text>
                  </View>
                </View>

                {/* KHUNG MẶT BẰNG BÃI ĐỖ CHÂN THỰC */}
                <View style={styles.floorPlan}>
                  {/* 1. DÃY Ô ĐỖ PHÍA TRÊN (ROW A) */}
                  <View style={styles.parkingRow}>
                    {topRowSlots.map((slot) => (
                      <RealisticSlotBay
                        key={slot.id || slot.slotNumber}
                        slot={slot}
                        isSelected={selectedSlot?.slotNumber === slot.slotNumber}
                        onPress={() => setSelectedSlot(slot)}
                        direction="top"
                      />
                    ))}
                  </View>

                  {/* 2. LÀN ĐƯỜNG XE CHẠY Ở TRUNG TÂM (CENTRAL DRIVEWAY) */}
                  <View style={styles.driveway}>
                    {/* Cổng vào bên trái */}
                    <View style={styles.gateEntry}>
                      <View style={styles.gateBarie}>
                        <View style={[styles.barieArm, currentLot?.gates?.entry === 'open' ? styles.barieArmOpen : styles.barieArmClosed]} />
                      </View>
                      <View style={styles.gateSign}>
                        <Ionicons name="arrow-forward" size={10} color="#FFFFFF" />
                        <Text style={styles.gateSignText}>VÀO</Text>
                      </View>
                    </View>

                    {/* Vạch sơn kẻ đường đứt nét ở giữa làn */}
                    <View style={styles.roadLineContainer}>
                      <View style={styles.roadLineDash} />
                      <View style={styles.roadLineDash} />
                      <View style={styles.roadLineDash} />
                      <View style={styles.roadLineDash} />
                      <View style={styles.roadLineDash} />
                    </View>

                    {/* Mũi tên điều hướng trên mặt đường */}
                    <View style={styles.roadArrowsWrap}>
                      <View style={styles.roadArrowBox}>
                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                      </View>
                      <Text style={styles.drivewayText}>LÀN XE LƯU THÔNG (DRIVEWAY)</Text>
                      <View style={styles.roadArrowBox}>
                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
                      </View>
                    </View>

                    {/* Cổng ra bên phải */}
                    <View style={styles.gateExit}>
                      <View style={styles.gateSignExit}>
                        <Text style={styles.gateSignText}>RA</Text>
                        <Ionicons name="arrow-forward" size={10} color="#FFFFFF" />
                      </View>
                      <View style={styles.gateBarie}>
                        <View style={[styles.barieArm, currentLot?.gates?.exit === 'open' ? styles.barieArmOpen : styles.barieArmClosed]} />
                      </View>
                    </View>
                  </View>

                  {/* 3. DÃY Ô ĐỖ PHÍA DƯỚI (ROW B) */}
                  <View style={styles.parkingRow}>
                    {bottomRowSlots.map((slot) => (
                      <RealisticSlotBay
                        key={slot.id || slot.slotNumber}
                        slot={slot}
                        isSelected={selectedSlot?.slotNumber === slot.slotNumber}
                        onPress={() => setSelectedSlot(slot)}
                        direction="bottom"
                      />
                    ))}
                  </View>
                </View>

                {/* CHÚ THÍCH CÁC TRẠNG THÁI Ô ĐỖ NHƯ ĐỜI THỰC */}
                <View style={styles.slotLegendBar}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendIndicator, { backgroundColor: '#10B981' }]} />
                    <Text style={styles.legendText}>Ô trống</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendIndicator, { backgroundColor: '#EF4444' }]} />
                    <Text style={styles.legendText}>Có xe đỗ</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendIndicator, { backgroundColor: '#F59E0B' }]} />
                    <Text style={styles.legendText}>Đã giữ chỗ</Text>
                  </View>
                  <Pressable onPress={() => fetchLotDetail(activeLotId)} style={styles.syncBtn} hitSlop={6}>
                    <Ionicons name="sync" size={12} color="#3B82F6" />
                    <Text style={styles.syncBtnText}>Đồng bộ IoT</Text>
                  </Pressable>
                </View>

                {/* THÔNG TIN CHI TIẾT VỊ TRÍ Ô ĐỖ ĐANG CHỌN (CHỈ DÀNH ĐỂ XEM VỊ TRÍ) */}
                {selectedSlot && (
                  <View style={styles.slotDetailBox}>
                    <View style={styles.slotDetailLeft}>
                      <View style={[styles.slotDetailBadge, { backgroundColor: selectedSlot.state === 'free' ? '#ECFDF5' : selectedSlot.state === 'occupied' ? '#FEF2F2' : '#FFFBEB' }]}>
                        <Text style={[styles.slotDetailBadgeText, { color: selectedSlot.state === 'free' ? '#10B981' : selectedSlot.state === 'occupied' ? '#EF4444' : '#F59E0B' }]}>
                          {selectedSlot.state === 'free' ? 'Ô TRỐNG SẴN SÀNG' : selectedSlot.state === 'occupied' ? 'XE ĐANG ĐỖ TẠI Ô NÀY' : 'Ô ĐANG CÓ LỊCH GIỮ CHỖ'}
                        </Text>
                      </View>
                      <Text style={styles.slotDetailNum}>Vị trí: Ô đỗ xe #{selectedSlot.slotNumber}</Text>
                      {selectedSlot.distanceCm ? (
                        <Text style={styles.slotDetailDist}>
                          Cảm biến khoảng cách: <Text style={{ fontWeight: '700', color: colors.text }}>{selectedSlot.distanceCm} cm</Text>
                        </Text>
                      ) : (
                        <Text style={styles.slotDetailDist}>
                          Tình trạng: <Text style={{ fontWeight: '600', color: colors.text }}>{selectedSlot.state === 'free' ? 'Không có vật cản' : 'Phát hiện phương tiện'}</Text>
                        </Text>
                      )}
                    </View>

                    <Pressable
                      onPress={() => setSelectedSlot(null)}
                      style={styles.closeSlotDetailBtn}
                      hitSlop={8}
                      accessibilityLabel="Đóng thông tin ô đỗ"
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                    </Pressable>
                  </View>
                )}
              </View>
            ) : (
              /* ========================================================
                 CHẾ ĐỘ 2: BẢN ĐỒ KHU VỰC ĐÔ THỊ (CITY MAP)
                 ======================================================== */
              <View style={styles.mapCanvas}>
                <View style={styles.mapGridLineH} />
                <View style={[styles.mapGridLineH, { top: '65%' }]} />
                <View style={styles.mapGridLineV} />
                <View style={[styles.mapGridLineV, { left: '70%' }]} />

                {/* Vị trí của tài xế */}
                <View style={[styles.mapPin, styles.driverPin, { left: '15%', top: '48%' }]}>
                  <Ionicons name="navigate-circle" size={26} color="#2563EB" />
                  <View style={styles.driverTag}>
                    <Text style={styles.driverTagText}>Vị trí của bạn</Text>
                  </View>
                </View>

                {/* Marker các bãi đỗ */}
                {filteredLots.map((lot) => {
                  const isSelected = (activeLotId || allLots[0]?.id) === lot.id;
                  const hasFree = (lot.freeSlots || 0) > 0;
                  const markerBg = lot.isIncluded ? '#1D4ED8' : hasFree ? '#10B981' : '#EF4444';

                  return (
                    <Pressable
                      key={lot.id}
                      onPress={() => {
                        setActiveLotId(lot.id);
                        setSelectedSlot(null);
                      }}
                      style={[
                        styles.mapPin,
                        { left: `${lot.mapX * 100}%`, top: `${lot.mapY * 100}%` },
                        isSelected && styles.mapPinSelected,
                      ]}
                    >
                      <View style={[styles.markerBadge, { backgroundColor: markerBg }]}>
                        <Text style={styles.markerText}>P</Text>
                        <Text style={styles.markerSlots}>{lot.freeSlots ?? 0}</Text>
                      </View>
                      <Text style={styles.markerLotName} numberOfLines={1}>
                        {lot.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* DỰ TÍNH LỘ TRÌNH & CHI PHÍ ĐỖ XE */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="calculator-outline" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>Dự tính Lộ trình & Chi phí Đỗ xe</Text>
            </View>

            <View style={styles.calcRow}>
              <View style={styles.calcInputCol}>
                <Text style={styles.inputLabel}>Giờ xuất phát (HH:mm)</Text>
                <TextInput
                  style={styles.calcInput}
                  value={startedTime}
                  onChangeText={setStartedTime}
                  placeholder="08:00"
                  keyboardType="numbers-and-punctuation"
                />
              </View>

              <View style={styles.calcInputCol}>
                <Text style={styles.inputLabel}>Thời gian đỗ (Giờ)</Text>
                <TextInput
                  style={styles.calcInput}
                  value={parkingDurationHours}
                  onChangeText={setParkingDurationHours}
                  placeholder="2"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.calcResultBox}>
              <View style={styles.calcResultItem}>
                <Text style={styles.calcResultLabel}>Đến bãi đích dự kiến:</Text>
                <Text style={styles.calcResultVal}>{routeCalculation.arrivalTime}</Text>
              </View>
              <View style={styles.calcResultItem}>
                <Text style={styles.calcResultLabel}>Rời bãi đỗ dự kiến:</Text>
                <Text style={styles.calcResultVal}>{routeCalculation.finishTime}</Text>
              </View>
              <View style={[styles.calcResultItem, { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 6, marginTop: 4 }]}>
                <Text style={[styles.calcResultLabel, { fontWeight: '700', color: colors.text }]}>Chi phí đỗ ước tính:</Text>
                <Text style={[styles.calcResultVal, { color: '#16A34A', fontSize: 16 }]}>
                  {routeCalculation.estimatedFee.toLocaleString('vi-VN')}đ
                </Text>
              </View>
            </View>
          </View>

          {/* DANH SÁCH BÃI ĐỖ & QUẢN LÝ LỘ TRÌNH */}
          <View style={styles.filterRow}>
            <Text style={styles.sectionTitle}>
              Danh sách Bãi đỗ ({filteredLots.length})
            </Text>

            <Pressable
              onPress={() => setHideExcluded(!hideExcluded)}
              style={[styles.toggleBtn, hideExcluded && styles.toggleBtnActive]}
            >
              <Ionicons
                name={hideExcluded ? 'eye-off' : 'eye'}
                size={14}
                color={hideExcluded ? '#FFFFFF' : colors.textMuted}
              />
              <Text style={[styles.toggleBtnText, hideExcluded && styles.toggleBtnTextActive]}>
                {hideExcluded ? 'Đang ẩn bãi ngoài tuyến' : 'Hiện tất cả bãi'}
              </Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 20 }} />
          ) : filteredLots.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>Không tìm thấy bãi đỗ phù hợp.</Text>
            </View>
          ) : (
            filteredLots.map((lot) => {
              const inRouteIdx = includedLotIds.indexOf(lot.id);
              const isIncluded = inRouteIdx !== -1;
              const isCurrentlySelected = activeLotId === lot.id;

              return (
                <Pressable
                  key={lot.id}
                  onPress={() => {
                    setActiveLotId(lot.id);
                    setSelectedSlot(null);
                  }}
                  style={[
                    styles.lotCardItem,
                    isIncluded && styles.lotCardIncluded,
                    isCurrentlySelected && styles.lotCardActiveView,
                  ]}
                >
                  <View style={styles.lotItemLeft}>
                    <View style={[styles.orderCircle, isIncluded ? styles.orderCircleActive : styles.orderCircleInactive]}>
                      <Text style={[styles.orderNum, isIncluded && { color: '#FFFFFF' }]}>
                        {isIncluded ? `#${inRouteIdx + 1}` : 'P'}
                      </Text>
                    </View>

                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.lotItemName}>{lot.name}</Text>
                        {lot.online ? (
                          <View style={styles.onlineDot} />
                        ) : (
                          <Text style={styles.offlineTag}>Offline</Text>
                        )}
                      </View>
                      <Text style={styles.lotItemAddr} numberOfLines={1}>
                        {lot.address || 'Chưa cập nhật địa chỉ'}
                      </Text>
                      <Text style={styles.lotItemMeta}>
                        Trống: <Text style={{ color: '#10B981', fontWeight: '700' }}>{lot.freeSlots ?? 0}</Text>/{lot.totalSlots} ô • {Number(lot.pricePerHour).toLocaleString()}đ/h
                      </Text>
                    </View>
                  </View>

                  {/* THAO TÁC TUYẾN & SẮP XẾP */}
                  <View style={styles.lotItemActions}>
                    {/* Nút bấm trực tiếp Thêm / Loại khỏi lộ trình */}
                    <Pressable
                      onPress={() => (isIncluded ? removeLotFromRoute(lot.id) : addLotToRoute(lot.id))}
                      style={[styles.routeBadgeBtn, isIncluded ? styles.routeBadgeActive : styles.routeBadgeInactive]}
                      hitSlop={4}
                    >
                      <Ionicons
                        name={isIncluded ? 'checkmark-circle' : 'add-circle-outline'}
                        size={13}
                        color={isIncluded ? '#FFFFFF' : '#2563EB'}
                      />
                      <Text style={[styles.routeBadgeText, isIncluded && styles.routeBadgeTextActive]}>
                        {isIncluded ? 'Trong tuyến' : '+ Tuyến'}
                      </Text>
                    </Pressable>

                    {isIncluded && (
                      <View style={styles.reorderCol}>
                        <Pressable
                          onPress={() => moveRouteLot(inRouteIdx, -1)}
                          disabled={inRouteIdx === 0}
                          style={[styles.reorderBtn, inRouteIdx === 0 && { opacity: 0.3 }]}
                          hitSlop={6}
                        >
                          <Ionicons name="chevron-up" size={16} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => moveRouteLot(inRouteIdx, 1)}
                          disabled={inRouteIdx === includedLotIds.length - 1}
                          style={[styles.reorderBtn, inRouteIdx === includedLotIds.length - 1 && { opacity: 0.3 }]}
                          hitSlop={6}
                        >
                          <Ionicons name="chevron-down" size={16} color={colors.primary} />
                        </Pressable>
                      </View>
                    )}

                    {isAdmin && (
                      <View style={{ flexDirection: 'row', gap: 4, marginLeft: 6 }}>
                        <Pressable onPress={() => openEditLotDialog(lot)} style={styles.actionIconBtn} hitSlop={6}>
                          <Ionicons name="pencil" size={15} color={colors.textMuted} />
                        </Pressable>
                        <Pressable onPress={() => handleDeleteLot(lot)} style={styles.actionIconBtn} hitSlop={6}>
                          <Ionicons name="trash-outline" size={15} color="#EF4444" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* DIALOG XEM LỘ TRÌNH */}
        <Modal visible={showRouteDialog} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="navigate-circle" size={22} color={colors.primary} />
                  <Text style={styles.dialogTitle}>Thông tin Lộ trình Đỗ xe</Text>
                </View>
                <Pressable onPress={() => setShowRouteDialog(false)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 320 }}>
                <View style={styles.routeSummaryRow}>
                  <View style={styles.routeSummaryItem}>
                    <Text style={styles.routeSummaryNum}>{routeLots.length}</Text>
                    <Text style={styles.routeSummaryLabel}>Bãi trên tuyến</Text>
                  </View>
                  <View style={styles.routeSummaryItem}>
                    <Text style={styles.routeSummaryNum}>
                      {routeLots.reduce((acc, l) => acc + (l.freeSlots || 0), 0)}
                    </Text>
                    <Text style={styles.routeSummaryLabel}>Tổng ô trống</Text>
                  </View>
                  <View style={styles.routeSummaryItem}>
                    <Text style={[styles.routeSummaryNum, { color: '#16A34A' }]}>
                      {routeCalculation.estimatedFee.toLocaleString()}đ
                    </Text>
                    <Text style={styles.routeSummaryLabel}>Phí dự kiến</Text>
                  </View>
                </View>

                <Text style={styles.routeListHeading}>Thứ tự các bãi đỗ sẽ ghé qua:</Text>
                {routeLots.length === 0 ? (
                  <Text style={styles.emptyText}>Chưa có bãi đỗ nào được chọn vào lộ trình.</Text>
                ) : (
                  routeLots.map((lot, idx) => (
                    <View key={lot.id} style={styles.routeStepItem}>
                      <View style={styles.stepCircle}>
                        <Text style={styles.stepNum}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.stepName}>{lot.name}</Text>
                        <Text style={styles.stepAddr}>{lot.address || 'Đà Nẵng'}</Text>
                      </View>
                      <Text style={styles.stepSlots}>{lot.freeSlots ?? 0} ô trống</Text>
                    </View>
                  ))
                )}
              </ScrollView>

              <Pressable onPress={() => setShowRouteDialog(false)} style={styles.dialogCloseBtn}>
                <Text style={styles.dialogCloseBtnText}>Đóng hộp thoại</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* MODAL SỬA BÃI ĐỖ (ADMIN) */}
        <Modal visible={!!editingLot} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <Text style={styles.dialogTitle}>Chỉnh sửa Bãi đỗ xe</Text>
                <Pressable onPress={() => setEditingLot(null)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </Pressable>
              </View>

              <View style={styles.editField}>
                <Text style={styles.inputLabel}>Tên bãi đỗ xe</Text>
                <TextInput
                  style={styles.textInput}
                  value={editForm.name}
                  onChangeText={(t) => setEditForm((f) => ({ ...f, name: t }))}
                  placeholder="Ví dụ: Bãi đỗ xe Trung tâm Hải Châu"
                />
              </View>

              <View style={styles.editField}>
                <Text style={styles.inputLabel}>Địa chỉ bãi đỗ</Text>
                <TextInput
                  style={styles.textInput}
                  value={editForm.address}
                  onChangeText={(t) => setEditForm((f) => ({ ...f, address: t }))}
                  placeholder="Ví dụ: 123 Bạch Đằng, Hải Châu, Đà Nẵng"
                />
              </View>

              <View style={styles.editField}>
                <Text style={styles.inputLabel}>Giá gửi mỗi giờ (VNĐ)</Text>
                <TextInput
                  style={styles.textInput}
                  value={editForm.pricePerHour}
                  onChangeText={(t) => setEditForm((f) => ({ ...f, pricePerHour: t }))}
                  keyboardType="numeric"
                  placeholder="10000"
                />
              </View>

              <View style={styles.editActions}>
                <Pressable onPress={() => setEditingLot(null)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Hủy bỏ</Text>
                </Pressable>
                <Pressable onPress={saveEditLot} disabled={savingEdit} style={styles.saveBtn}>
                  {savingEdit ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Lưu cập nhật</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

// =====================================================================
//  COMPONENT Ô ĐỖ THỰC TẾ (REALISTIC PARKING SLOT BAY)
// =====================================================================
function RealisticSlotBay({ slot, isSelected, onPress, direction = 'top' }) {
  const isOccupied = slot.state === 'occupied';
  const isReserved = slot.state === 'reserved';
  const isFree = slot.state === 'free';

  // Màu sắc đèn LED trên trần bãi xe
  const ledColor = isFree ? '#10B981' : isOccupied ? '#EF4444' : '#F59E0B';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.bayBox,
        direction === 'top' ? styles.bayTop : styles.bayBottom,
        isSelected && styles.baySelected,
      ]}
    >
      {/* 1. ĐÈN CẢM BIẾN TRÊN TRẦN (LED SENSOR) */}
      <View style={[styles.bayLedSensor, { backgroundColor: ledColor }]}>
        <View style={[styles.bayLedInner, { backgroundColor: ledColor }]} />
      </View>

      {/* 2. GỜ CHẶN BÁNH XE (WHEEL STOPPER) */}
      {direction === 'top' && (
        <View style={styles.wheelStopper}>
          <View style={styles.wheelStripe} />
          <View style={styles.wheelStripe} />
          <View style={styles.wheelStripe} />
        </View>
      )}

      {/* 3. NỘI DUNG TRONG Ô ĐỖ */}
      <View style={styles.bayInterior}>
        {/* Số hiệu ô đỗ sơn trên mặt đường */}
        <Text style={styles.bayNumberText}>#{slot.slotNumber}</Text>

        {isOccupied ? (
          /* HÌNH ẢNH CHIẾC XE Ô TÔ THẬT ĐANG ĐỖ (TOP-DOWN CAR) */
          <View style={styles.realisticCar}>
            {/* Thân xe */}
            <View style={styles.carBody}>
              {/* Kính chắn gió trước */}
              <View style={styles.carWindshieldFront} />
              {/* Mui xe */}
              <View style={styles.carRoof}>
                <Ionicons name="car-sport" size={17} color="#FFFFFF" />
              </View>
              {/* Kính chắn gió sau */}
              <View style={styles.carWindshieldRear} />
            </View>
            <Text style={styles.carStateLabel}>ĐANG ĐỖ</Text>
          </View>
        ) : isReserved ? (
          /* TRẠNG THÁI ĐÃ ĐƯỢC GIỮ CHỖ */
          <View style={styles.reservedMarker}>
            <Ionicons name="shield-checkmark" size={18} color="#F59E0B" />
            <Text style={styles.reservedText}>ĐÃ GIỮ</Text>
          </View>
        ) : (
          /* Ô TRỐNG SẴN SÀNG */
          <View style={styles.freeMarker}>
            <View style={styles.freeIconCircle}>
              <Text style={styles.freePText}>P</Text>
            </View>
            <Text style={styles.freeLabel}>TRỐNG</Text>
          </View>
        )}

        {/* Cảm biến khoảng cách siêu âm HC-SR04 */}
        {slot.distanceCm ? (
          <Text style={styles.distanceBadge}>{slot.distanceCm}cm</Text>
        ) : null}
      </View>

      {/* Gờ chặn bánh xe phía dưới nếu ô ở dãy dưới */}
      {direction === 'bottom' && (
        <View style={styles.wheelStopper}>
          <View style={styles.wheelStripe} />
          <View style={styles.wheelStripe} />
          <View style={styles.wheelStripe} />
        </View>
      )}
    </Pressable>
  );
}

// =====================================================================
//  STYLES
// =====================================================================
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  webContainer: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    flex: 1,
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          minHeight: '100vh',
        }
      : {}),
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  headerSubtitle: { fontSize: 11, color: colors.textMuted },
  headerRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  headerRouteBtnText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' },

  scroll: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 40 },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.text, height: '100%' },

  // Map Toolbar
  mapToolBar: { marginBottom: 10, gap: 8 },
  lotSelectorScroll: { maxHeight: 36 },
  lotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  lotChipActive: { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' },
  lotChipDot: { width: 7, height: 7, borderRadius: 3.5 },
  lotChipText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  lotChipTextActive: { color: '#1D4ED8', fontWeight: '800' },

  modeSwitchRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
    alignSelf: 'flex-start',
  },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  modeBtnActive: { backgroundColor: '#FFFFFF', ...shadow.card },
  modeBtnText: { fontSize: 11.5, color: colors.textMuted, fontWeight: '600' },
  modeBtnTextActive: { color: '#1D4ED8', fontWeight: '700' },

  // Map Wrapper
  mapWrapper: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    marginBottom: 14,
    ...shadow.card,
  },

  // Real floor plan styles
  realisticContainer: { padding: 12, backgroundColor: '#0B132B' },
  realisticHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  realisticLotTitle: { fontSize: 13.5, fontWeight: '800', color: '#F8FAFC' },
  realisticStatsBadge: { backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  realisticStatsText: { fontSize: 11, color: '#94A3B8' },

  floorPlan: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 8,
    borderWidth: 2,
    borderColor: '#475569',
  },
  parkingRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 8,
  },

  // Driveway (Làn xe chạy)
  driveway: {
    height: 64,
    marginVertical: 8,
    backgroundColor: '#0F172A',
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    paddingHorizontal: 6,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#475569',
  },
  gateEntry: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  gateExit: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  gateSign: { backgroundColor: '#10B981', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 2 },
  gateSignExit: { backgroundColor: '#EF4444', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 2 },
  gateSignText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  gateBarie: { width: 4, height: 26, backgroundColor: '#64748B', justifyContent: 'center' },
  barieArm: { width: 18, height: 3, backgroundColor: '#F87171' },
  barieArmClosed: { transform: [{ rotate: '0deg' }] },
  barieArmOpen: { transform: [{ rotate: '-45deg' }], backgroundColor: '#34D399' },

  roadLineContainer: {
    position: 'absolute',
    left: 45,
    right: 45,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roadLineDash: { width: 22, height: 2.5, backgroundColor: '#FBBF24' },
  roadArrowsWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  roadArrowBox: { opacity: 0.6 },
  drivewayText: { fontSize: 8.5, color: 'rgba(255,255,255,0.45)', fontWeight: '800', letterSpacing: 1 },

  // Ô ĐỖ THỰC TẾ (SLOT BAY)
  bayBox: {
    flex: 1,
    height: 108,
    backgroundColor: '#0F172A',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    position: 'relative',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bayTop: { borderBottomWidth: 0 },
  bayBottom: { borderTopWidth: 0 },
  baySelected: { borderColor: '#38BDF8', backgroundColor: '#1E293B' },

  bayLedSensor: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
    top: 4,
    right: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bayLedInner: { width: 4, height: 4, borderRadius: 2 },

  wheelStopper: {
    width: '80%',
    height: 5,
    backgroundColor: '#F59E0B',
    borderRadius: 2,
    flexDirection: 'row',
    justifyContent: 'space-around',
    overflow: 'hidden',
  },
  wheelStripe: { width: 4, height: '100%', backgroundColor: '#000000' },

  bayInterior: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  bayNumberText: { fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.4)', position: 'absolute', top: 2, left: 4 },

  // Xe ô tô thật (Top-down car view)
  realisticCar: { alignItems: 'center', width: '85%', height: '70%', justifyContent: 'center' },
  carBody: {
    width: '100%',
    height: 48,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#60A5FA',
    ...shadow.card,
  },
  carWindshieldFront: { width: '70%', height: 6, backgroundColor: '#0F172A', borderRadius: 2 },
  carRoof: { width: '80%', flex: 1, backgroundColor: '#1D4ED8', alignItems: 'center', justifyContent: 'center', marginVertical: 2, borderRadius: 4 },
  carWindshieldRear: { width: '65%', height: 5, backgroundColor: '#0F172A', borderRadius: 2 },
  carStateLabel: { fontSize: 8, color: '#EF4444', fontWeight: '800', marginTop: 2 },

  // Ô Trống
  freeMarker: { alignItems: 'center', gap: 2 },
  freeIconCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#10B981' },
  freePText: { color: '#10B981', fontSize: 14, fontWeight: '900' },
  freeLabel: { fontSize: 8.5, color: '#10B981', fontWeight: '800' },

  // Ô Đã Đặt
  reservedMarker: { alignItems: 'center', gap: 2 },
  reservedText: { fontSize: 8, color: '#F59E0B', fontWeight: '800' },

  distanceBadge: { fontSize: 8, color: '#94A3B8', fontWeight: '600', position: 'absolute', bottom: 1 },

  // Legend Bar
  slotLegendBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendIndicator: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { fontSize: 10.5, color: '#94A3B8', fontWeight: '600' },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  syncBtnText: { fontSize: 11, color: '#3B82F6', fontWeight: '700' },

  // Popup chi tiết ô đỗ
  slotDetailBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotDetailLeft: { flex: 1 },
  slotDetailBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginBottom: 3 },
  slotDetailBadgeText: { fontSize: 9.5, fontWeight: '800' },
  slotDetailNum: { fontSize: 12.5, fontWeight: '800', color: colors.text },
  slotDetailDist: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  closeSlotDetailBtn: { padding: 4 },

  // City Map styles
  mapCanvas: { height: 230, backgroundColor: '#E0F2FE', position: 'relative' },
  mapGridLineH: { position: 'absolute', left: 0, right: 0, top: '35%', height: 8, backgroundColor: '#BAE6FD' },
  mapGridLineV: { position: 'absolute', top: 0, bottom: 0, left: '40%', width: 8, backgroundColor: '#BAE6FD' },
  mapPin: { position: 'absolute', alignItems: 'center' },
  driverPin: { transform: [{ translateX: -13 }, { translateY: -13 }] },
  driverTag: { backgroundColor: '#1E40AF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 2 },
  driverTagText: { color: '#FFFFFF', fontSize: 9, fontWeight: '700' },

  markerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 3,
    ...shadow.card,
  },
  markerText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  markerSlots: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  markerLotName: { fontSize: 10, fontWeight: '700', color: '#1E293B', backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 4, borderRadius: 3, marginTop: 2 },
  mapPinSelected: { transform: [{ scale: 1.15 }] },

  // Card Calculator
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    ...shadow.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  calcRow: { flexDirection: 'row', gap: 12 },
  calcInputCol: { flex: 1 },
  inputLabel: { fontSize: 11.5, color: colors.textMuted, marginBottom: 4, fontWeight: '500' },
  calcInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    height: 38,
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  calcResultBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    padding: 10,
    marginTop: 10,
    gap: 4,
  },
  calcResultItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calcResultLabel: { fontSize: 12, color: colors.textMuted },
  calcResultVal: { fontSize: 13, fontWeight: '800', color: colors.text },

  // Filter
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  toggleBtnActive: { backgroundColor: '#3B82F6' },
  toggleBtnText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  toggleBtnTextActive: { color: '#FFFFFF' },

  // Lot Card
  lotCardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  lotCardIncluded: { borderColor: '#3B82F6', backgroundColor: '#F0F7FF' },
  lotCardActiveView: { borderWidth: 1.5, borderColor: '#1D4ED8' },
  lotItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  orderCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  orderCircleActive: { backgroundColor: '#1D4ED8' },
  orderCircleInactive: { backgroundColor: '#E2E8F0' },
  orderNum: { fontSize: 12, fontWeight: '800', color: colors.textMuted },
  lotItemName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  offlineTag: { fontSize: 9, color: '#EF4444', backgroundColor: '#FEE2E2', paddingHorizontal: 4, borderRadius: 3 },
  lotItemAddr: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
  lotItemMeta: { fontSize: 11.5, color: colors.text, marginTop: 2 },
  lotItemActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  routeBadgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  routeBadgeInactive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  routeBadgeActive: {
    backgroundColor: '#2563EB',
    borderColor: '#1D4ED8',
  },
  routeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  routeBadgeTextActive: {
    color: '#FFFFFF',
  },

  reorderCol: { gap: 2 },
  reorderBtn: { padding: 2 },
  actionIconBtn: { padding: 4 },

  emptyBox: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { fontSize: 12.5, color: colors.textMuted },

  // Dialogs
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  dialogCard: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: 18, ...shadow.card, maxWidth: 440, width: '100%', alignSelf: 'center' },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  dialogTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  routeSummaryRow: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginBottom: 12 },
  routeSummaryItem: { flex: 1, alignItems: 'center' },
  routeSummaryNum: { fontSize: 16, fontWeight: '800', color: colors.text },
  routeSummaryLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  routeListHeading: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 8 },
  routeStepItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  stepCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#1D4ED8', alignItems: 'center', justifyContent: 'center' },
  stepNum: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  stepName: { fontSize: 13, fontWeight: '700', color: colors.text },
  stepAddr: { fontSize: 11, color: colors.textMuted },
  stepSlots: { fontSize: 11, color: '#10B981', fontWeight: '700' },
  dialogCloseBtn: { backgroundColor: '#F1F5F9', borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', marginTop: 14 },
  dialogCloseBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },

  // Edit form
  editField: { marginBottom: 12 },
  textInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 40,
    fontSize: 13.5,
    color: colors.text,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: '#F1F5F9' },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: colors.primary },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});
