// DAT CHO: chon bai do -> khu vuc / vi tri o -> xe -> thoi gian giu cho -> thoi luong gui du kien -> xac nhan
// params: { lotId?, zone?, slotNumber? } (mo tu the bai / o tren Home)
// - So do o cap nhat moi 10 giay; o dang chon bi nguoi khac lay -> bo chon + bao
// - Quy tac lay tu may chu (GET /reservations/rules); dang co ve / bi khoa -> chan dat, chi dan
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Notice from '../../components/Notice';
import { lotsApi } from '../../api/lots';
import { reservationsApi } from '../../api/reservations';
import { vehiclesApi } from '../../api/vehicles';
import { vehicleType } from '../../utils/vehicles';
import { colors, radius } from '../../theme';
import { formatDuration, formatVND } from '../../utils/schedules';
import { DEFAULT_RULES, estimateFee, formatClock, formatDateTime, isOpen } from '../../utils/booking';

const POLL_MS = 10000;
const SLOT_COLORS = {
  free: { fg: '#059669', bg: '#ECFDF5', border: '#A7F3D0', label: 'Trống' },
  occupied: { fg: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'Có xe' },
  reserved: { fg: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Đã giữ' },
};

// Khu nhieu o trong nhat (uu tien khu dang chon neu van con cho)
function bestZone(zones, current) {
  if (!zones?.length) return null;
  const cur = zones.find((z) => z.zone === current);
  if (cur) return cur.zone;
  return [...zones].sort((a, b) => b.free - a.free || a.zone.localeCompare(b.zone))[0].zone;
}

export default function BookingScreen({ navigation, route }) {
  const params = route.params || {};
  const [lots, setLots] = useState([]);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [vehicles, setVehicles] = useState([]);
  const [openResv, setOpenResv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [lotId, setLotId] = useState(params.lotId || null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [zone, setZone] = useState(params.zone || null);
  const [slotNumber, setSlotNumber] = useState(params.slotNumber || null); // null = tu chon o trong
  const [vehicleId, setVehicleId] = useState(null);
  const [hold, setHold] = useState(DEFAULT_RULES.hold.default);
  const [duration, setDuration] = useState(DEFAULT_RULES.duration.default);

  const [notice, setNotice] = useState(null); // { type, text }
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Gia tri moi nhat cho callback chay ngam (poll, ket qua tai cham)
  const lotRef = useRef(lotId);
  const slotRef = useRef(slotNumber);
  useEffect(() => { lotRef.current = lotId; slotRef.current = slotNumber; }, [lotId, slotNumber]);

  // ---------- Tai du lieu ----------
  const loadAll = useCallback(async () => {
    setLoadError('');
    const [l, ru, v, open] = await Promise.allSettled([
      lotsApi.list(), reservationsApi.rules(), vehiclesApi.list(), reservationsApi.list({ status: 'active,pending' }),
    ]);
    if (l.status === 'fulfilled') {
      const list = l.value || [];
      setLots(list);
      // Chua chon bai -> bai online con nhieu cho nhat
      if (!lotRef.current && list.length) {
        const pick = [...list].sort((a, b) => (b.online - a.online) || (b.freeSlots || 0) - (a.freeSlots || 0))[0];
        setLotId(pick.id);
      }
    } else setLoadError(l.reason?.message || 'Không tải được danh sách bãi đỗ.');
    if (ru.status === 'fulfilled') setRules({ ...DEFAULT_RULES, ...ru.value });
    if (v.status === 'fulfilled') {
      const list = v.value || [];
      setVehicles(list);
      setVehicleId((cur) => cur ?? (list.length === 1 ? list[0].id : null));
    }
    if (open.status === 'fulfilled') setOpenResv((open.value || []).find(isOpen) || null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadDetail = useCallback(async (id, silent) => {
    if (!id) return;
    if (!silent) setLoadingDetail(true);
    try {
      const d = await lotsApi.detail(id);
      if (lotRef.current !== id) return;
      setDetail(d);
      setZone((z) => bestZone(d.zones, z));
      // O dang chon vua bi nguoi khac giu / co xe -> bo chon
      const n = slotRef.current;
      const s = n == null ? null : d.slots.find((x) => x.slotNumber === n);
      if (n != null && (!s || s.state !== 'free')) {
        setSlotNumber(null);
        setNotice({ type: 'info', text: `Ô #${n} vừa có người giữ hoặc có xe. Đã chuyển sang tự chọn ô trống.` });
      } else if (s && s.zone) setZone(s.zone);
    } catch (e) {
      if (!silent) setNotice({ type: 'error', text: e.message });
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    setDetail(null);
    loadDetail(lotId);
  }, [lotId, loadDetail]);

  useFocusEffect(useCallback(() => {
    const t = setInterval(() => loadDetail(lotRef.current, true), POLL_MS);
    return () => clearInterval(t);
  }, [loadDetail]));

  // Gia tri mac dinh theo quy tac may chu
  useEffect(() => {
    setHold((h) => (rules.hold.options.includes(h) ? h : rules.hold.default));
    setDuration((d) => (rules.duration.options.includes(d) ? d : rules.duration.default));
  }, [rules]);

  // ---------- Tinh toan ----------
  const lot = useMemo(() => lots.find((l) => l.id === lotId) || null, [lots, lotId]);
  const zoneSlots = useMemo(() => (detail?.slots || []).filter((s) => s.zone === zone), [detail, zone]);
  const autoSlot = zoneSlots.find((s) => s.state === 'free') || null;
  const targetSlot = slotNumber ?? autoSlot?.slotNumber ?? null;
  const price = detail?.pricePerHour ?? lot?.pricePerHour;
  const fee = estimateFee(price, duration);
  const holdUntil = new Date(Date.now() + hold * 60000);
  const suspendedUntil = rules.me?.suspendedUntil;
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const online = detail ? detail.online : lot?.online;

  const blocker = openResv
    ? 'open'
    : suspendedUntil && new Date(suspendedUntil) > new Date()
      ? 'suspended'
      : !lot ? 'nolot'
        : online === false ? 'offline'
          : detail && !targetSlot ? 'full'
            : null;

  // ---------- Dat cho ----------
  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const resv = await reservationsApi.create(lotId, {
        zone,
        ...(slotNumber != null && { slotNumber }),
        minutes: hold,
        durationMinutes: duration,
        ...(vehicleId && { vehicleId }),
      });
      setConfirming(false);
      navigation.replace('ReservationDetail', { id: resv.id, initial: resv, justCreated: true });
    } catch (e) {
      setConfirming(false);
      let text = e.message;
      if (e.code === 'booking_suspended' && e.details?.suspendedUntil) {
        text = `${e.message} Có thể đặt lại sau ${formatDateTime(e.details.suspendedUntil)}.`;
        setRules((r) => ({ ...r, me: { ...r.me, suspendedUntil: e.details.suspendedUntil } }));
      }
      if (['slot_not_free', 'zone_full', 'lot_full'].includes(e.code)) {
        setSlotNumber(null);
        loadDetail(lotId, true);
      }
      if (e.code === 'already_has_reservation') loadAll();
      setNotice({ type: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  // ---------- Giao dien ----------
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header navigation={navigation} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Đang tải bãi đỗ...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.webContainer}>
        <Header navigation={navigation} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary}
          onRefresh={() => { setRefreshing(true); loadAll(); loadDetail(lotId, true); }} />}
      >
        {loadError ? <Notice type="error" actionLabel="Thử lại" onAction={loadAll}>{loadError}</Notice> : null}

        {blocker === 'open' && (
          <Notice type="info" actionLabel="Xem vé"
            onAction={() => navigation.navigate('ReservationDetail', { id: openResv.id, initial: openResv })}>
            Bạn đang có 1 lượt đặt chỗ (ô #{openResv.slotNumber}{openResv.lotName ? ` – ${openResv.lotName}` : ''}).
            Mỗi tài khoản chỉ giữ {rules.maxActivePerUser} chỗ cùng lúc.
          </Notice>
        )}
        {blocker === 'suspended' && (
          <Notice type="error">
            Tài khoản tạm khoá đặt chỗ đến {formatDateTime(suspendedUntil)} do không đến {rules.noShow.limit} lần
            trong {rules.noShow.windowDays} ngày.
          </Notice>
        )}

        {/* 1. BAI DO */}
        <Section index={1} title="Chọn bãi đỗ">
          {lots.length === 0 ? (
            <Text style={styles.muted}>Chưa có bãi đỗ nào.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {lots.map((l) => (
                <LotCard key={l.id} lot={l} on={l.id === lotId}
                  onPress={() => { if (l.id !== lotId) { setLotId(l.id); setZone(null); setSlotNumber(null); setNotice(null); } }} />
              ))}
            </ScrollView>
          )}
        </Section>

        {/* 2. KHU VUC & VI TRI */}
        <Section index={2} title="Khu vực & vị trí đỗ"
          hint={slotNumber == null ? 'Để trống vị trí: hệ thống tự chọn ô trống gần lối vào nhất trong khu.' : null}>
          {loadingDetail && !detail ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
          ) : detail ? (
            <>
              <View style={styles.zoneRow}>
                {detail.zones.map((z) => (
                  <Pressable key={z.zone} onPress={() => { setZone(z.zone); setSlotNumber(null); }}
                    style={[styles.zoneCard, z.zone === zone && styles.zoneCardOn]}
                    accessibilityRole="button" accessibilityState={{ selected: z.zone === zone }}>
                    <Text style={[styles.zoneName, z.zone === zone && styles.onText]}>Khu {z.zone}</Text>
                    <Text style={[styles.zoneFree, z.zone === zone && styles.onTextSoft, !z.free && { color: colors.danger }]}>
                      {z.free ? `${z.free}/${z.total} ô trống` : 'Hết chỗ'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => setSlotNumber(null)} style={[styles.autoRow, slotNumber == null && styles.autoRowOn]}>
                <Ionicons name={slotNumber == null ? 'radio-button-on' : 'radio-button-off'} size={18}
                  color={slotNumber == null ? colors.primary : colors.textMuted} />
                <Text style={styles.autoText}>
                  Tự chọn ô trống{autoSlot && slotNumber == null ? ` (ô #${autoSlot.slotNumber})` : ''}
                </Text>
              </Pressable>

              <View style={styles.slotGrid}>
                {zoneSlots.map((s) => {
                  const c = SLOT_COLORS[s.state] || SLOT_COLORS.occupied;
                  const on = slotNumber === s.slotNumber;
                  const free = s.state === 'free';
                  return (
                    <Pressable key={s.id} disabled={!free} onPress={() => setSlotNumber(on ? null : s.slotNumber)}
                      style={[styles.slot, { backgroundColor: c.bg, borderColor: c.border }, on && styles.slotOn]}
                      accessibilityRole="button" accessibilityState={{ selected: on, disabled: !free }}
                      accessibilityLabel={`Ô ${s.slotNumber}, ${c.label}`}>
                      <Ionicons name={free ? (on ? 'checkmark-circle' : 'square-outline') : 'car'} size={20}
                        color={on ? '#fff' : c.fg} />
                      <Text style={[styles.slotNum, { color: on ? '#fff' : c.fg }]}>#{s.slotNumber}</Text>
                      <Text style={[styles.slotState, { color: on ? '#DBEAFE' : c.fg }]}>{on ? 'Đã chọn' : c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.legend}>
                {Object.values(SLOT_COLORS).map((c) => (
                  <View key={c.label} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: c.fg }]} />
                    <Text style={styles.legendText}>{c.label}</Text>
                  </View>
                ))}
                <Text style={styles.legendText}>• cập nhật mỗi 10 giây</Text>
              </View>
            </>
          ) : null}
        </Section>

        {/* 3. XE */}
        <Section index={3} title="Xe gửi" hint={vehicles.length ? null : 'Chưa có xe. Có thể thêm ở tab "Xe của tôi" trên trang chủ (không bắt buộc).'}>
          <View style={styles.chipWrap}>
            <Chip label="Không chọn" on={vehicleId == null} onPress={() => setVehicleId(null)} />
            {vehicles.map((v) => (
              <Chip key={v.id} icon={vehicleType(v.vehicleType).icon} label={v.plateNumber} on={vehicleId === v.id} onPress={() => setVehicleId(v.id)} />
            ))}
          </View>
        </Section>

        {/* 4. GIU CHO */}
        <Section index={4} title="Thời gian giữ chỗ"
          hint={`Ô được giữ đến khoảng ${formatClock(holdUntil)}. Quá giờ mà xe chưa vào ô, chỗ tự huỷ và tính 1 lần không đến.`}>
          <View style={styles.chipWrap}>
            {rules.hold.options.map((m) => (
              <Chip key={m} label={`${m} phút`} on={hold === m} onPress={() => setHold(m)} />
            ))}
          </View>
        </Section>

        {/* 5. THOI LUONG */}
        <Section index={5} title="Thời lượng gửi dự kiến"
          hint={price != null ? `${formatVND(price)}/giờ • làm tròn lên theo giờ, tính từ lúc xe vào ô.` : null}>
          <View style={styles.chipWrap}>
            {rules.duration.options.map((m) => (
              <Chip key={m} label={formatDuration(m)} on={duration === m} onPress={() => setDuration(m)} />
            ))}
          </View>
        </Section>

        {/* TOM TAT */}
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Tóm tắt đặt chỗ</Text>
          <Row label="Bãi đỗ" value={lot?.name || '—'} />
          <Row label="Vị trí" value={targetSlot ? `Khu ${zone} • Ô #${targetSlot}${slotNumber == null ? ' (tự chọn)' : ''}` : 'Không còn ô trống'} />
          <Row label="Xe" value={vehicle?.plateNumber || 'Không chọn'} />
          <Row label="Giữ chỗ" value={`${hold} phút (đến ~${formatClock(holdUntil)})`} />
          <Row label="Gửi dự kiến" value={formatDuration(duration)} />
          <View style={styles.divider} />
          <Row label="Phí dự kiến" value={formatVND(fee)} strong />
          <Text style={styles.summaryNote}>Giữ chỗ miễn phí. Phí thực tế tính theo thời gian đỗ thật.</Text>
        </View>

        <RulesBox rules={rules} />

        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
        {blocker === 'offline' && <Notice type="error">Bãi đỗ đang mất kết nối thiết bị, tạm thời chưa đặt được.</Notice>}
        {blocker === 'full' && <Notice type="error">Khu {zone} đã hết ô trống. Hãy chọn khu hoặc bãi khác.</Notice>}

        <Button title="Đặt chỗ" onPress={() => setConfirming(true)} disabled={!!blocker} loading={busy} />
      </ScrollView>

        <ConfirmDialog
          visible={confirming}
          title="Xác nhận đặt chỗ"
          message={`${lot?.name || ''}\nKhu ${zone} • Ô #${targetSlot}${slotNumber == null ? ' (tự chọn)' : ''}\n`
            + `Giữ chỗ ${hold} phút • Gửi dự kiến ${formatDuration(duration)} • ~${formatVND(fee)}`}
          confirmLabel="Đặt ngay"
          cancelLabel="Xem lại"
          loading={busy}
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
        />
      </View>
    </SafeAreaView>
  );
}

// ---------- Thanh phan con ----------
function Header({ navigation }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.headerTitle}>Đặt chỗ đỗ xe</Text>
        <Text style={styles.headerSub}>Chọn bãi, khu vực, vị trí và thời lượng</Text>
      </View>
    </View>
  );
}

function Section({ index, title, hint, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.stepDot}><Text style={styles.stepText}>{index}</Text></View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function LotCard({ lot, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.lotCard, on && styles.lotCardOn]}
      accessibilityRole="button" accessibilityState={{ selected: on }}>
      <View style={styles.lotTop}>
        <View style={[styles.onlineDot, { backgroundColor: lot.online ? colors.accent : '#94A3B8' }]} />
        <Text style={[styles.lotStatus, on && styles.onTextSoft]}>{lot.online ? 'Online' : 'Offline'}</Text>
      </View>
      <Text style={[styles.lotName, on && styles.onText]} numberOfLines={1}>{lot.name}</Text>
      <Text style={[styles.lotAddr, on && styles.onTextSoft]} numberOfLines={1}>{lot.address || lot.id}</Text>
      <View style={styles.lotBottom}>
        <Text style={[styles.lotFree, on && styles.onText]}>{lot.freeSlots ?? 0}/{lot.totalSlots} trống</Text>
        <Text style={[styles.lotPrice, on && styles.onTextSoft]}>{formatVND(lot.pricePerHour)}/h</Text>
      </View>
    </Pressable>
  );
}

function Chip({ label, icon, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button" accessibilityState={{ selected: on }}>
      {icon ? <Ionicons name={icon} size={14} color={on ? '#fff' : colors.textMuted} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value, strong }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

export function RulesBox({ rules }) {
  const items = [
    `Mỗi tài khoản giữ tối đa ${rules.maxActivePerUser} chỗ cùng lúc.`,
    'Đặt chỗ chỉ thành công khi thiết bị tại bãi xác nhận giữ ô (đèn ô chuyển vàng).',
    `Gia hạn tối đa ${rules.extend.maxTimes} lần, mỗi lần ≤ ${rules.extend.max} phút, khi chỗ còn đang giữ.`,
    'Huỷ miễn phí bất cứ lúc nào trước khi xe vào ô.',
    `Quá giờ giữ chỗ mà xe chưa vào ô → hết hạn, tính 1 lần không đến. ${rules.noShow.limit} lần trong ${rules.noShow.windowDays} ngày → tạm khoá đặt chỗ ${rules.noShow.suspendHours} giờ.`,
    'Đến cổng vào, dùng app quét mã QR tại cổng → barie mở, bắt đầu phiên gửi xe, phí tính từ lúc vào bãi (làm tròn lên theo giờ, tối thiểu 1 giờ).',
    'Gửi quá giờ dự kiến hơn 5 phút → phụ phí 50% giá/giờ cho mỗi giờ quá hạn. Có thể gia hạn miễn phí trong phiên gửi xe.',
  ];
  return (
    <View style={styles.rules}>
      <View style={styles.rulesHead}>
        <Ionicons name="information-circle-outline" size={18} color={colors.primaryDark} />
        <Text style={styles.rulesTitle}>Quy tắc giữ chỗ</Text>
      </View>
      {items.map((t) => (
        <View key={t} style={styles.ruleRow}>
          <Text style={styles.ruleBullet}>•</Text>
          <Text style={styles.ruleText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  webContainer: {
    width: '100%',
    maxWidth: 520,
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 8 },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  section: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 10, lineHeight: 17 },

  lotCard: { width: 190, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  lotCardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  lotTop: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  lotStatus: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  lotName: { fontSize: 14, fontWeight: '800', color: colors.text },
  lotAddr: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lotBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  lotFree: { fontSize: 12.5, fontWeight: '800', color: colors.success },
  lotPrice: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  onText: { color: '#fff' },
  onTextSoft: { color: '#DBEAFE' },

  zoneRow: { flexDirection: 'row', gap: 10 },
  zoneCard: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  zoneCardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  zoneName: { fontSize: 15, fontWeight: '800', color: colors.text },
  zoneFree: { fontSize: 12, color: colors.success, fontWeight: '700', marginTop: 2 },

  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  autoRowOn: { backgroundColor: colors.primarySoft },
  autoText: { fontSize: 13.5, fontWeight: '600', color: colors.text },

  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  slot: { width: 86, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', gap: 2 },
  slotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotNum: { fontSize: 15, fontWeight: '800' },
  slotState: { fontSize: 11, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.textMuted },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: '#fff' },

  summary: { backgroundColor: '#0F172A', borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  summaryTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { color: '#94A3B8', fontSize: 13 },
  rowValue: { color: '#E2E8F0', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowStrong: { color: '#38BDF8', fontSize: 17, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#1E293B', marginVertical: 6 },
  summaryNote: { color: '#64748B', fontSize: 11.5, marginTop: 6 },

  rules: { backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: 14, marginBottom: 14 },
  rulesHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  rulesTitle: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  ruleRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  ruleBullet: { color: colors.primaryDark, fontSize: 13 },
  ruleText: { flex: 1, color: '#1E3A8A', fontSize: 12.5, lineHeight: 18 },
});
