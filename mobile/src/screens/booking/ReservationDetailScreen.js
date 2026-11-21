// CHI TIET DAT CHO: ma xac nhan, dem nguoc giu cho, tien trinh (tao -> xac nhan -> xe vao / huy / het han)
// Gia han (toi da theo quy tac), huy (xac nhan truoc), chi duong.
// params: { id, initial?, justCreated? }
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Notice from '../../components/Notice';
import { reservationsApi } from '../../api/reservations';
import { colors, radius } from '../../theme';
import { formatDuration, formatVND } from '../../utils/schedules';
import {
  DEFAULT_RULES, FAIL_REASONS, RESV_STATUS, formatClock, formatCountdown, formatDateTime, isOpen, secondsLeft,
} from '../../utils/booking';
import { RulesBox } from './BookingScreen';

const POLL_MS = 10000;

export default function ReservationDetailScreen({ navigation, route }) {
  const { id, initial, justCreated } = route.params || {};
  const [resv, setResv] = useState(initial || null);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(
    justCreated ? { type: 'success', text: 'Đặt chỗ thành công! Thiết bị tại bãi đã xác nhận giữ ô cho bạn.' } : null);
  const [now, setNow] = useState(() => Date.now());
  const [extending, setExtending] = useState(null); // so phut dang gia han
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const statusRef = useRef(resv?.status);
  useEffect(() => { statusRef.current = resv?.status; }, [resv?.status]);

  const load = useCallback(async () => {
    try {
      const r = await reservationsApi.detail(id);
      // Trang thai doi khi dang xem (xe vao / het han) -> bao nguoi dung
      const prev = statusRef.current;
      if (prev && prev !== r.status && r.status === 'fulfilled') {
        setNotice({ type: 'success', text: 'Xe đã vào đúng ô. Lượt đặt chỗ hoàn tất, bắt đầu tính phí gửi xe.' });
      } else if (prev && prev !== r.status && r.status === 'expired') {
        setNotice({ type: 'error', text: 'Đã quá giờ giữ chỗ nên ô được trả lại.' });
      }
      setResv(r);
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    reservationsApi.rules().then((r) => setRules({ ...DEFAULT_RULES, ...r })).catch(() => {});
  }, [load]);

  // Dang giu cho: lam moi tu may chu 10s/lan, dong ho dem nguoc 1s/lan
  const open = isOpen(resv);
  useFocusEffect(useCallback(() => {
    if (!open) return undefined;
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [open, load]));

  // Het gio tren dong ho -> hoi lai may chu (server tu danh dau het han sau thoi gian du phong)
  const left = secondsLeft(resv?.expiresAt, now);
  useEffect(() => {
    if (resv?.status === 'active' && left === 0) {
      const t = setTimeout(load, (rules.graceSeconds + 2) * 1000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [resv?.status, left, load, rules.graceSeconds]);

  async function extend(minutes) {
    setExtending(minutes);
    setNotice(null);
    try {
      const r = await reservationsApi.extend(resv.id, minutes);
      setResv(r);
      setNotice({ type: 'success', text: `Đã gia hạn thêm ${minutes} phút. Giữ chỗ đến ${formatClock(r.expiresAt)}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
      if (e.code === 'reservation_not_active' || e.code === 'reservation_expired') load();
    } finally {
      setExtending(null);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const r = await reservationsApi.cancel(resv.id);
      setResv((old) => ({ ...old, ...r }));
      setConfirmCancel(false);
      setNotice({ type: 'info', text: 'Đã huỷ đặt chỗ. Ô được trả lại cho bãi.' });
    } catch (e) {
      setConfirmCancel(false);
      setNotice({ type: 'error', text: e.message });
      load();
    } finally {
      setCancelling(false);
    }
  }

  function directions() {
    const q = encodeURIComponent(resv.lotAddress ? `${resv.lotName}, ${resv.lotAddress}` : resv.lotName || resv.lotId);
    const url = Platform.select({
      ios: `maps://app?daddr=${q}`,
      android: `google.navigation:q=${q}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    });
    Linking.openURL(url).catch(() => setNotice({ type: 'info', text: `Địa chỉ: ${resv.lotAddress || resv.lotName}` }));
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.headerTitle}>Chi tiết đặt chỗ</Text>
        {resv?.code ? <Text style={styles.headerSub}>Mã {resv.code}</Text> : null}
      </View>
    </View>
  );

  if (loading || !resv) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <View style={styles.center}>
          {loading ? <ActivityIndicator color={colors.primary} /> : <Notice type="error">{notice?.text || 'Không tải được.'}</Notice>}
        </View>
      </SafeAreaView>
    );
  }

  const cfg = RESV_STATUS[resv.status] || RESV_STATUS.pending;
  const total = (resv.holdMinutes || resv.minutes || 1) * 60;
  const ratio = Math.min(1, left / total);
  const urgent = resv.status === 'active' && left <= 5 * 60;
  const ended = !open;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      {header}
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}

        {/* VE */}
        <View style={styles.ticket}>
          <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={14} color={cfg.color} />
            <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>

          <Text style={styles.codeLabel}>MÃ ĐẶT CHỖ</Text>
          <Text style={styles.code} selectable>{resv.code || `#${resv.id}`}</Text>
          <Text style={styles.codeHint}>Đọc mã này cho nhân viên nếu cần đối chiếu tại cổng.</Text>

          {resv.status === 'active' && (
            <View style={styles.countdownBox}>
              <Text style={[styles.countdown, urgent && { color: colors.danger }]}>{formatCountdown(left)}</Text>
              <Text style={styles.countdownSub}>
                {left > 0 ? `còn lại • giữ chỗ đến ${formatClock(resv.expiresAt)}` : 'đã hết giờ • đang chờ thiết bị cập nhật'}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: urgent ? colors.danger : colors.primary }]} />
              </View>
            </View>
          )}

          <View style={styles.dash} />

          <Text style={styles.lotName}>{resv.lotName || resv.lotId}</Text>
          {resv.lotAddress ? <Text style={styles.lotAddr}>{resv.lotAddress}</Text> : null}
          <View style={styles.posRow}>
            <Pos label="KHU" value={resv.zone || '—'} />
            <Pos label="Ô ĐỖ" value={`#${resv.slotNumber}`} />
            <Pos label="XE" value={resv.vehiclePlate || '—'} small />
          </View>
        </View>

        {/* THONG TIN */}
        <View style={styles.card}>
          <Info icon="time-outline" label="Thời gian giữ chỗ"
            value={`${resv.holdMinutes || resv.minutes} phút${resv.extendCount ? ` (đã gia hạn ${resv.extendCount}/${rules.extend.maxTimes} lần)` : ''}`} />
          {resv.expiresAt ? <Info icon="alarm-outline" label="Giữ chỗ đến" value={formatDateTime(resv.expiresAt)} /> : null}
          {resv.durationMinutes ? <Info icon="hourglass-outline" label="Gửi dự kiến" value={formatDuration(resv.durationMinutes)} /> : null}
          {resv.estimatedFee != null ? <Info icon="cash-outline" label="Phí dự kiến" value={formatVND(resv.estimatedFee)} strong /> : null}
          {resv.status === 'failed' || resv.status === 'expired'
            ? <Info icon="alert-circle-outline" label="Lý do" value={FAIL_REASONS[resv.error] || (resv.status === 'expired' ? FAIL_REASONS.no_show : resv.error || '—')} />
            : null}
        </View>

        {/* TIEN TRINH */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tiến trình</Text>
          <Step done label="Tạo yêu cầu đặt chỗ" time={resv.createdAt} />
          <Step done={!!resv.confirmedAt} failed={resv.status === 'failed'}
            label={resv.status === 'failed' ? 'Thiết bị không xác nhận' : 'Thiết bị xác nhận giữ ô'} time={resv.confirmedAt} />
          <Step
            last
            done={resv.status === 'fulfilled'}
            failed={['cancelled', 'expired'].includes(resv.status)}
            label={{
              fulfilled: 'Xe đã vào ô – bắt đầu tính phí',
              cancelled: 'Đã huỷ đặt chỗ',
              expired: 'Hết giờ giữ chỗ (không đến)',
            }[resv.status] || 'Chờ xe vào đúng ô'}
            time={ended && resv.status !== 'failed' ? resv.updatedAt : null}
          />
        </View>

        {/* THAO TAC */}
        {resv.status === 'active' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Gia hạn giữ chỗ</Text>
            {resv.canExtend ? (
              <View style={styles.extRow}>
                {rules.extend.options.map((m) => (
                  <Pressable key={m} onPress={() => extend(m)} disabled={extending != null}
                    style={({ pressed }) => [styles.extBtn, pressed && { opacity: 0.8 }, extending != null && extending !== m && { opacity: 0.5 }]}>
                    {extending === m ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Text style={styles.extText}>+{m} phút</Text>}
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>
                {left > 0 ? `Đã dùng hết ${rules.extend.maxTimes} lần gia hạn.` : 'Đã hết giờ giữ chỗ, không thể gia hạn.'}
              </Text>
            )}
            <Text style={styles.hint}>
              Còn {Math.max(0, rules.extend.maxTimes - (resv.extendCount || 0))} lần gia hạn • mỗi lần tối đa {rules.extend.max} phút.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button title="Chỉ đường" variant="outline" onPress={directions} style={{ flex: 1 }} />
          {resv.canCancel && (
            <Button title="Huỷ đặt chỗ" onPress={() => setConfirmCancel(true)} style={{ flex: 1, backgroundColor: colors.danger }} />
          )}
        </View>
        {ended && (
          <Button title="Đặt chỗ mới" onPress={() => navigation.replace('Booking', { lotId: resv.lotId })} style={{ marginBottom: 14 }} />
        )}

        {open && <RulesBox rules={rules} />}
      </ScrollView>

      <ConfirmDialog
        visible={confirmCancel}
        danger
        title="Huỷ đặt chỗ?"
        message={`Ô #${resv.slotNumber} (khu ${resv.zone}) sẽ được trả lại cho bãi. Huỷ miễn phí và không tính là không đến.`}
        confirmLabel="Huỷ đặt chỗ"
        cancelLabel="Giữ lại"
        loading={cancelling}
        onConfirm={cancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </SafeAreaView>
  );
}

function Pos({ label, value, small }) {
  return (
    <View style={styles.pos}>
      <Text style={styles.posLabel}>{label}</Text>
      <Text style={[styles.posValue, small && { fontSize: 14 }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Info({ icon, label, value, strong }) {
  return (
    <View style={styles.info}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, strong && { color: colors.primary, fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

function Step({ label, time, done, failed, last }) {
  const color = failed ? colors.danger : done ? colors.success : '#CBD5E1';
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <Ionicons name={failed ? 'close-circle' : done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={color} />
        {!last && <View style={[styles.stepLine, { backgroundColor: done ? colors.success : '#E2E8F0' }]} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
        <Text style={[styles.stepLabel, !done && !failed && { color: colors.textMuted }]}>{label}</Text>
        {time ? <Text style={styles.stepTime}>{formatDateTime(time)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  muted: { fontSize: 13, color: colors.textMuted },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 10 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  ticket: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 18, marginBottom: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  badgeText: { fontSize: 12, fontWeight: '800' },
  codeLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.5, marginTop: 14 },
  code: { fontSize: 30, fontWeight: '900', color: colors.navy, letterSpacing: 2, marginTop: 2 },
  codeHint: { fontSize: 11.5, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  countdownBox: { alignSelf: 'stretch', alignItems: 'center', marginTop: 16, padding: 12, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  countdown: { fontSize: 34, fontWeight: '900', color: colors.primary, fontVariant: ['tabular-nums'] },
  countdownSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', marginTop: 10, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  dash: { alignSelf: 'stretch', borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 16 },
  lotName: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  lotAddr: { fontSize: 12.5, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  posRow: { flexDirection: 'row', alignSelf: 'stretch', gap: 8, marginTop: 14 },
  pos: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  posLabel: { fontSize: 10.5, fontWeight: '800', color: colors.primaryDark, letterSpacing: 1 },
  posValue: { fontSize: 20, fontWeight: '900', color: colors.primaryDark, marginTop: 2 },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  infoLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  infoValue: { fontSize: 13.5, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },

  step: { flexDirection: 'row', gap: 10 },
  stepRail: { alignItems: 'center', width: 18 },
  stepLine: { width: 2, flex: 1, marginTop: 2 },
  stepLabel: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  stepTime: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  extRow: { flexDirection: 'row', gap: 10 },
  extBtn: { flex: 1, height: 42, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  extText: { color: colors.primary, fontWeight: '800', fontSize: 14 },

  actions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
});
