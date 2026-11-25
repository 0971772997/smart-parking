// PHIEN GUI XE: bat dau khi barie cong vao mo -> dang gui (vi tri do, gio bat dau, dong ho, phi hien tai)
// -> gia han / doi xe -> xe roi o (chot phi) -> thanh toan + ma QR cong ra -> ket thuc.
// Cap nhat thoi gian thuc qua LiveContext (cam bien / barie doi -> tai lai ngay), dong ho chay tren may.
// Mat mang: hien du lieu da luu gan nhat + bao mat ket noi, ket noi lai thi tu dong bo.
// params: { id }
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Notice from '../../components/Notice';
import GateCheckinCard from '../../components/GateCheckinCard';
import OfflineBanner from '../../components/OfflineBanner';
import { sessionsApi } from '../../api/sessions';
import { vehiclesApi } from '../../api/vehicles';
import { useLive, useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatClock, formatDateTime } from '../../utils/booking';
import { formatDuration, formatVND } from '../../utils/schedules';
import { FLAG_LABEL, NOTE_TYPE, PHASE, formatElapsed, secondsSince } from '../../utils/session';

const cacheKey = (id) => `sp_session_${id}`;
const FALLBACK_POLL_MS = 30000;
const EXTEND_OPTIONS = [30, 60, 120];

export default function SessionDetailScreen({ navigation, route }) {
  const { id } = route.params || {};
  const { online } = useLive();
  const [s, setS] = useState(null);
  const [stale, setStale] = useState(false); // dang hien du lieu luu tren may (chua tai duoc tu may chu)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(null);
  const [vehicles, setVehicles] = useState(null);
  const [savingVehicle, setSavingVehicle] = useState(null);
  const phaseRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await sessionsApi.detail(id);
      const prev = phaseRef.current;
      if (prev && prev !== d.phase) {
        const msg = {
          parked: { type: 'success', text: `Cảm biến đã ghi nhận xe tại ô #${d.slotNumber}.` },
          left: { type: 'info', text: `Xe đã rời ô. Phí đã chốt: ${formatVND(d.fee)}.${d.amountDue > 0 ? ' Thanh toán để barie cổng ra tự mở.' : ''}` },
          completed: { type: 'success', text: 'Xe đã ra bãi. Phiên gửi xe kết thúc. Cảm ơn bạn!' },
        }[d.phase];
        if (msg) setNotice(msg);
      }
      phaseRef.current = d.phase;
      setS(d);
      setStale(false);
      AsyncStorage.setItem(cacheKey(id), JSON.stringify({ ...d, cachedAt: Date.now() })).catch(() => {});
    } catch (e) {
      if (e.code === 'network_error' || e.code === 'timeout') {
        // Mat mang -> dung ban luu gan nhat tren may
        const raw = await AsyncStorage.getItem(cacheKey(id)).catch(() => null);
        if (raw) {
          setS((cur) => cur || JSON.parse(raw));
          setStale(true);
        } else setNotice({ type: 'error', text: e.message });
      } else setNotice({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load); // cam bien / barie / thanh toan doi -> tai lai ngay

  const live = s && s.phase !== 'completed';
  useFocusEffect(useCallback(() => {
    if (!live) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, FALLBACK_POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [live, load]));

  // Den moc phi tiep theo -> hoi lai may chu (phi moi + thong bao thay doi chi phi)
  const nextChange = s?.cost?.nextChangeAt ? new Date(s.cost.nextChangeAt).getTime() : null;
  useEffect(() => {
    if (!nextChange || s?.cost?.final) return undefined;
    const wait = Math.max(1000, nextChange - Date.now() + 1500);
    if (wait > 6 * 3600 * 1000) return undefined;
    const t = setTimeout(load, wait);
    return () => clearTimeout(t);
  }, [nextChange, s?.cost?.final, load]);

  async function extend(minutes) {
    setExtending(minutes);
    setNotice(null);
    try {
      const d = await sessionsApi.extend(s.id, minutes);
      setS((cur) => ({ ...cur, ...d }));
      setNotice({ type: 'success', text: `Đã gia hạn thêm ${minutes} phút. Giờ gửi dự kiến mới: ${formatClock(d.plannedEndAt)}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
      load();
    } finally {
      setExtending(null);
    }
  }

  async function openVehicles() {
    if (vehicles) { setVehicles(null); return; }
    try {
      setVehicles(await vehiclesApi.list());
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    }
  }

  async function chooseVehicle(v) {
    setSavingVehicle(v.id);
    try {
      const d = await sessionsApi.update(s.id, { vehicleId: v.id });
      setS((cur) => ({ ...cur, ...d }));
      setVehicles(null);
      setNotice({ type: 'success', text: `Đã cập nhật xe ${v.plateNumber} cho phiên gửi xe.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setSavingVehicle(null);
    }
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.headerTitle}>Phiên gửi xe</Text>
        {s ? <Text style={styles.headerSub} numberOfLines={1}>{s.lotName}{s.reservationCode ? ` • ${s.reservationCode}` : ''}</Text> : null}
      </View>
    </View>
  );

  if (loading || !s) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.webContainer}>
          {header}
          <OfflineBanner />
          <View style={styles.center}>
            {loading ? <ActivityIndicator color={colors.primary} /> : <Notice type="error">{notice?.text || 'Không tải được phiên gửi xe.'}</Notice>}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const cfg = PHASE[s.phase] || PHASE.parked;
  const open = !s.cost.final;
  // Dong ho chay tren may: tu luc vao bai den bay gio (hoac den luc chot phi)
  const elapsed = open ? secondsSince(s.startedAt, now) : s.durationSeconds ?? s.elapsedSeconds;
  const plannedEnd = s.plannedEndAt ? new Date(s.plannedEndAt).getTime() : null;
  const toEnd = plannedEnd ? Math.round((plannedEnd - now) / 1000) : null;
  const progress = plannedEnd ? Math.min(1, elapsed / Math.max(1, s.plannedMinutes * 60)) : 0;
  const overtime = open && toEnd !== null && toEnd < 0;
  const nearEnd = open && toEnd !== null && toEnd >= 0 && toEnd <= 15 * 60;
  const showPass = s.reservationId && s.phase !== 'completed';
  // So gio tinh phi: dang gui -> tu may chu; da chot -> phi gui / gia
  const baseHours = open ? s.cost.hours : s.pricePerHour && s.cost.base ? Math.round(s.cost.base / s.pricePerHour) : null;
  const passResv = { id: s.reservationId, nextGate: 'exit', enteredAt: s.startedAt, slotNumber: s.slotNumber };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.webContainer}>
        {header}
        <OfflineBanner />
        <ScrollView contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {stale ? (
            <Notice type="info">Đang hiển thị dữ liệu lưu trên máy{online ? '' : ' (mất kết nối)'}. Phí thực tế sẽ cập nhật khi có mạng.</Notice>
          ) : null}
          {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}

          {/* TONG QUAN: trang thai, dong ho, phi hien tai */}
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                <Ionicons name={cfg.icon} size={14} color={cfg.color} />
                <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              {open ? (
                <View style={styles.livePill}>
                  <View style={[styles.liveDot, !online && { backgroundColor: '#F59E0B' }]} />
                  <Text style={styles.liveText}>{online ? 'TRỰC TIẾP' : 'NGOẠI TUYẾN'}</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.timerLabel}>{open ? 'THỜI GIAN GỬI XE' : 'TỔNG THỜI GIAN GỬI'}</Text>
            <Text style={[styles.timer, overtime && { color: colors.danger }]} accessibilityLabel={`Đã gửi ${formatElapsed(elapsed)}`}>
              {formatElapsed(elapsed)}
            </Text>
            <Text style={styles.timerSub}>Bắt đầu lúc {formatDateTime(s.startedAt)} {s.source === 'gate' ? '(qua cổng vào)' : '(xe vào ô)'}</Text>

            <View style={styles.feeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.feeLabel}>{open ? 'Phí hiện tại' : s.paid ? 'Đã thanh toán' : 'Phí phải trả'}</Text>
                <Text style={[styles.fee, s.paid && { color: colors.success }]}>{formatVND(s.cost.total)}</Text>
              </View>
              {open && s.cost.nextChangeAt ? (
                <View style={styles.nextFee}>
                  <Ionicons name="trending-up-outline" size={14} color="#B45309" />
                  <Text style={styles.nextFeeText}>Phí đổi lúc{'\n'}{formatClock(s.cost.nextChangeAt)}</Text>
                </View>
              ) : null}
            </View>
            {s.phase === 'entered' && s.cost.total === 0 ? (
              <Text style={styles.heroHint}>Chưa đỗ vào ô: rời bãi trong 15 phút sẽ được miễn phí.</Text>
            ) : null}
          </View>

          {/* VI TRI DO */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vị trí đỗ</Text>
            <View style={styles.posRow}>
              <Pos label="KHU" value={s.zone || '—'} />
              <Pos label="Ô ĐỖ" value={`#${s.slotNumber}`} />
              <Pressable style={[styles.pos, styles.posVehicle]} onPress={s.phase !== 'completed' ? openVehicles : undefined}
                accessibilityRole="button" accessibilityLabel="Đổi xe của phiên gửi xe">
                <Text style={styles.posLabel}>XE {s.phase !== 'completed' ? '✎' : ''}</Text>
                <Text style={[styles.posValue, { fontSize: 14 }]} numberOfLines={1}>{s.vehiclePlate || 'Chọn xe'}</Text>
              </Pressable>
            </View>
            {vehicles ? (
              <View style={styles.vehList}>
                {vehicles.length === 0 ? <Text style={styles.muted}>Chưa có xe nào. Thêm xe ở tab Xe của tôi.</Text> : null}
                {vehicles.map((v) => (
                  <Pressable key={v.id} onPress={() => chooseVehicle(v)} disabled={savingVehicle != null || !online}
                    style={[styles.vehChip, v.id === s.vehicleId && styles.vehChipOn]}>
                    {savingVehicle === v.id ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Text style={[styles.vehText, v.id === s.vehicleId && { color: colors.primary }]}>{v.plateNumber}</Text>}
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Info icon="business-outline" label="Bãi đỗ" value={s.lotName} />
            <Info icon="enter-outline" label="Qua cổng vào" value={s.source === 'gate' ? formatDateTime(s.startedAt) : '—'} />
            <Info icon="car-outline" label="Vào ô" value={s.parkedAt ? formatDateTime(s.parkedAt) : 'Chưa ghi nhận'} />
            {s.endedAt ? <Info icon="log-out-outline" label="Rời ô (chốt phí)" value={formatDateTime(s.endedAt)} /> : null}
            {s.exitedAt ? <Info icon="flag-outline" label="Ra cổng" value={formatDateTime(s.exitedAt)} /> : null}
            {s.flags.length ? (
              <View style={styles.flags}>
                {s.flags.map((f) => (
                  <View key={f} style={styles.flag}>
                    <Ionicons name="information-circle-outline" size={13} color="#B45309" />
                    <Text style={styles.flagText}>{FLAG_LABEL[f] || f}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* THOI GIAN DU KIEN + GIA HAN */}
          {s.plannedEndAt ? (
            <View style={[styles.card, overtime && styles.cardDanger]}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Thời gian gửi dự kiến</Text>
                <Text style={styles.muted}>{formatDuration(s.plannedMinutes)}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: overtime ? colors.danger : nearEnd ? '#F59E0B' : colors.primary }]} />
              </View>
              <Text style={[styles.planText, overtime && { color: colors.danger }, nearEnd && { color: '#B45309' }]}>
                {!open ? `Dự kiến đến ${formatClock(s.plannedEndAt)}`
                  : overtime ? `Đã quá giờ ${formatElapsed(-toEnd)} • phụ phí ${formatVND(s.cost.overtime)}`
                    : `Còn ${formatElapsed(toEnd)} • đến ${formatClock(s.plannedEndAt)}`}
              </Text>
              {open && s.canExtend ? (
                <>
                  <View style={styles.extRow}>
                    {EXTEND_OPTIONS.map((m) => (
                      <Pressable key={m} onPress={() => extend(m)} disabled={extending != null || !online}
                        style={({ pressed }) => [styles.extBtn, pressed && { opacity: 0.8 }, (extending != null && extending !== m) || !online ? { opacity: 0.45 } : null]}>
                        {extending === m ? <ActivityIndicator size="small" color={colors.primary} />
                          : <Text style={styles.extText}>+{m >= 60 ? `${m / 60} giờ` : `${m} phút`}</Text>}
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.hint}>
                    Gia hạn miễn phí (tối đa 5 lần, tổng 24 giờ). Quá giờ dự kiến hơn 5 phút: phụ phí 50% giá/giờ cho mỗi giờ quá hạn.
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}

          {/* CHI PHI */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Chi phí {open ? '(tạm tính)' : '(đã chốt)'}</Text>
            <Info icon="pricetag-outline" label="Giá" value={`${formatVND(s.pricePerHour)}/giờ`} />
            <Info icon="time-outline" label={baseHours ? `Phí gửi (${baseHours} giờ × ${formatVND(s.pricePerHour)})` : 'Phí gửi'} value={formatVND(s.cost.base)} />
            {s.cost.overtime ? <Info icon="warning-outline" label="Phụ phí quá giờ" value={formatVND(s.cost.overtime)} danger /> : null}
            {s.cost.holdFee ? <Info icon="time-outline" label={`Phí gia hạn giữ chỗ (${s.cost.holdExtensions} lần)`} value={formatVND(s.cost.holdFee)} /> : null}
            <View style={styles.divider} />
            <Info icon="cash-outline" label="Tổng" value={formatVND(s.cost.total)} strong />
            {open && s.cost.planned != null ? (
              <Info icon="calculator-outline" label="Dự kiến nếu lấy xe đúng giờ" value={formatVND(s.cost.planned)} />
            ) : null}
            {s.payment ? (
              <Info icon="checkmark-done-outline" label="Thanh toán" value={`${formatVND(s.payment.amount)} • ${s.payment.code}`} />
            ) : null}
            {s.canPay && s.amountDue > 0 ? (
              <Pressable onPress={() => navigation.navigate('Payment', { sessionId: s.id })} style={styles.payBtn} accessibilityRole="button">
                <Ionicons name="wallet" size={17} color="#fff" />
                <Text style={styles.payBtnText}>Thanh toán {formatVND(s.amountDue)}</Text>
              </Pressable>
            ) : null}
            {s.payment ? (
              <Pressable onPress={() => navigation.navigate('Receipt', { paymentId: s.payment.id })} style={styles.receiptBtn} accessibilityRole="button">
                <Ionicons name="receipt-outline" size={16} color={colors.primary} />
                <Text style={styles.receiptBtnText}>Xem biên nhận điện tử</Text>
              </Pressable>
            ) : null}
          </View>

          {/* MA QR CONG RA + THANH TOAN */}
          {showPass ? <GateCheckinCard key={`${s.id}-${s.phase}-${s.paid}`} resv={passResv} onChanged={load} /> : null}

          {/* DONG THOI GIAN */}
          {s.timeline?.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Diễn biến</Text>
              {s.timeline.map((n, i) => {
                const t = NOTE_TYPE[n.type] || { icon: 'ellipse', color: colors.textMuted };
                const last = i === s.timeline.length - 1;
                return (
                  <View key={n.id} style={styles.step}>
                    <View style={styles.stepRail}>
                      <Ionicons name={t.icon} size={17} color={t.color} />
                      {!last && <View style={styles.stepLine} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: last ? 0 : 12 }}>
                      <Text style={styles.stepLabel}>{n.title}</Text>
                      {n.body ? <Text style={styles.stepBody}>{n.body}</Text> : null}
                      <Text style={styles.stepTime}>{formatDateTime(n.createdAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* DANH GIA + HO TRO */}
          <View style={styles.helpRow}>
            {s.phase === 'left' || s.phase === 'completed' ? (
              <Pressable onPress={() => navigation.navigate('ReviewForm', { lotId: s.lotId, lotName: s.lotName })} style={styles.helpBtn} accessibilityRole="button">
                <Ionicons name="star-outline" size={16} color="#B45309" />
                <Text style={[styles.helpText, { color: '#B45309' }]}>Đánh giá bãi đỗ</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => navigation.navigate('SupportTicketForm', { kind: 'incident', sessionId: s.id, lotId: s.lotId, slotNumber: s.slotNumber })}
              style={styles.helpBtn} accessibilityRole="button">
              <Ionicons name="warning-outline" size={16} color={colors.danger} />
              <Text style={[styles.helpText, { color: colors.danger }]}>Báo cáo sự cố</Text>
            </Pressable>
          </View>

          {s.reservationId ? (
            <Pressable onPress={() => navigation.navigate('ReservationDetail', { id: s.reservationId })} style={styles.link}>
              <Ionicons name="ticket-outline" size={16} color={colors.primary} />
              <Text style={styles.linkText}>Xem lượt đặt chỗ {s.reservationCode || ''}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Pos({ label, value }) {
  return (
    <View style={styles.pos}>
      <Text style={styles.posLabel}>{label}</Text>
      <Text style={styles.posValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Info({ icon, label, value, strong, danger }) {
  return (
    <View style={styles.info}>
      <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.textMuted} />
      <Text style={[styles.infoLabel, danger && { color: colors.danger }]}>{label}</Text>
      <Text style={[styles.infoValue, strong && { color: colors.primary, fontWeight: '900', fontSize: 15 }, danger && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  webContainer: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: '100vh' } : {}),
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  muted: { fontSize: 13, color: colors.textMuted },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 10, lineHeight: 17 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  hero: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  heroTop: { flexDirection: 'row', alignSelf: 'stretch', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  badgeText: { fontSize: 12, fontWeight: '800' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveText: { fontSize: 10, fontWeight: '900', color: colors.textMuted, letterSpacing: 1 },
  timerLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.5, marginTop: 16 },
  timer: { fontSize: 42, fontWeight: '900', color: colors.navy, fontVariant: ['tabular-nums'], marginTop: 2 },
  timerSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  feeRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: 16, padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  feeLabel: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  fee: { fontSize: 26, fontWeight: '900', color: colors.primaryDark, marginTop: 2 },
  nextFee: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, backgroundColor: '#FEF3C7' },
  nextFeeText: { fontSize: 11.5, fontWeight: '700', color: '#B45309', textAlign: 'right' },
  heroHint: { fontSize: 12, color: colors.textMuted, marginTop: 8, textAlign: 'center' },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardDanger: { borderColor: '#FECACA', backgroundColor: '#FFFBFB' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  posRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pos: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  posVehicle: { borderWidth: 1, borderColor: '#C7D2FE', borderStyle: 'dashed' },
  posLabel: { fontSize: 10.5, fontWeight: '800', color: colors.primaryDark, letterSpacing: 1 },
  posValue: { fontSize: 20, fontWeight: '900', color: colors.primaryDark, marginTop: 2 },
  vehList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  vehChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff', minWidth: 80, alignItems: 'center' },
  vehChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  vehText: { fontSize: 13, fontWeight: '700', color: colors.text },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  infoLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  infoValue: { fontSize: 13.5, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: '#EEF2F7', marginVertical: 4 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#FEF3C7' },
  flagText: { fontSize: 11.5, fontWeight: '700', color: '#B45309' },

  track: { height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  planText: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 8 },
  extRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  extBtn: { flex: 1, height: 42, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  extText: { color: colors.primary, fontWeight: '800', fontSize: 14 },

  step: { flexDirection: 'row', gap: 10 },
  stepRail: { alignItems: 'center', width: 18 },
  stepLine: { width: 2, flex: 1, marginTop: 2, backgroundColor: '#E2E8F0' },
  stepLabel: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  stepBody: { fontSize: 12.5, color: colors.textMuted, marginTop: 1, lineHeight: 17 },
  stepTime: { fontSize: 11.5, color: '#94A3B8', marginTop: 2 },

  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radius.md, backgroundColor: '#A50064', marginTop: 10 },
  payBtnText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, marginTop: 10 },
  receiptBtnText: { color: colors.primary, fontWeight: '800', fontSize: 13.5 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },
  helpRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  helpBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  helpText: { fontSize: 13.5, fontWeight: '800' },
});
