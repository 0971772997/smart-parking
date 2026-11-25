// THANH TOAN PHI GUI XE qua cong MoMo (moi truong thu nghiem):
//   chi tiet cac khoan phi -> chon phuong thuc (vi MoMo / the ATM / Visa-Master) -> mo trang thanh toan MoMo
//   -> cho xac nhan (may chu nhan IPN hoac tu hoi MoMo) -> ket qua: thanh cong (bien nhan) / that bai (ly do, thu lai)
// Dang cho ma tat app -> mo lai man hinh se tiep tuc theo doi don cu (luu ma don tren may).
// params: { sessionId }
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import OfflineBanner from '../../components/OfflineBanner';
import { paymentsApi } from '../../api/payments';
import { sessionsApi } from '../../api/sessions';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatClock, formatCountdown, formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { formatElapsed } from '../../utils/session';

const METHODS = [
  { key: 'momo', label: 'Ví MoMo', sub: 'Quét QR / mở app MoMo', icon: 'wallet', color: '#A50064' },
  { key: 'atm', label: 'Thẻ ATM nội địa', sub: 'Napas – thẻ ngân hàng Việt Nam', icon: 'card', color: '#0E7490' },
  { key: 'card', label: 'Thẻ Visa / Master', sub: 'Thẻ tín dụng, ghi nợ quốc tế', icon: 'card-outline', color: '#1D4ED8' },
];
const POLL_MS = 3000;
const orderKey = (sid) => `sp_pay_order_${sid}`;

export default function PaymentScreen({ navigation, route }) {
  const { sessionId } = route.params || {};
  const [s, setS] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [method, setMethod] = useState('momo');
  const [order, setOrder] = useState(null);      // don dang xu ly / ket qua
  const [phase, setPhase] = useState('loading'); // loading | choose | waiting | paid | failed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const polling = useRef(false);

  const applyOrder = useCallback((o) => {
    setOrder(o);
    if (o.status === 'paid') { setPhase('paid'); AsyncStorage.removeItem(orderKey(sessionId)).catch(() => {}); }
    else if (o.status === 'pending') setPhase('waiting');
    else { setPhase('failed'); AsyncStorage.removeItem(orderKey(sessionId)).catch(() => {}); }
  }, [sessionId]);

  const poll = useCallback(async (orderId) => {
    if (!orderId || polling.current) return;
    polling.current = true;
    try {
      applyOrder(await paymentsApi.order(orderId));
      setError(null);
    } catch (e) {
      setError(e.message); // mat mang -> giu trang thai cho, lan sau thu lai
    } finally {
      polling.current = false;
    }
  }, [applyOrder]);

  // Tai phien + cau hinh; neu dang co don cho (mo lai app) -> theo doi tiep
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, c] = await Promise.all([sessionsApi.detail(sessionId), paymentsApi.config().catch(() => null)]);
        if (!alive) return;
        setS(d);
        setCfg(c);
        if (d.paid && d.payment) {
          const receipt = await paymentsApi.receipt(d.payment.id).catch(() => ({ ...d.payment }));
          if (!alive) return;
          setOrder({ status: 'paid', amount: d.payment.amount, payment: receipt });
          setPhase('paid');
          return;
        }
        const saved = await AsyncStorage.getItem(orderKey(sessionId)).catch(() => null);
        if (saved) { setPhase('waiting'); poll(saved); } else setPhase('choose');
      } catch (e) {
        if (alive) { setError(e.message); setPhase('choose'); }
      }
    })();
    return () => { alive = false; };
  }, [sessionId, poll]);

  // Dang cho MoMo xac nhan (hoac da thanh cong nhung bien nhan dang duoc tao): hoi lai moi 3 giay
  const waiting = (phase === 'waiting' || (phase === 'paid' && !order?.payment)) && order?.orderId;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => poll(order.orderId), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [waiting, order?.orderId, poll]);
  const waitingId = phase === 'waiting' ? order?.orderId : null;
  useOnLiveChange(useCallback(() => { if (waitingId) poll(waitingId); }, [waitingId, poll]));

  async function openGateway(o) {
    if (!o?.payUrl) return;
    if (Platform.OS === 'web') { globalThis.open?.(o.payUrl, '_blank'); return; }
    await WebBrowser.openBrowserAsync(o.payUrl, { dismissButtonStyle: 'close', toolbarColor: '#A50064' }).catch(() => {});
    poll(o.orderId); // dong trinh duyet -> kiem tra ngay
  }

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const o = await paymentsApi.checkout(sessionId, method);
      AsyncStorage.setItem(orderKey(sessionId), o.orderId).catch(() => {});
      applyOrder(o);
      openGateway(o);
    } catch (e) {
      if (e.code === 'already_paid' || e.code === 'no_payment_needed') navigation.replace('SessionDetail', { id: sessionId });
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={styles.headerTitle}>Thanh toán phí gửi xe</Text>
        {s ? <Text style={styles.headerSub} numberOfLines={1}>{s.lotName} • Ô #{s.slotNumber}</Text> : null}
      </View>
    </View>
  );

  if (phase === 'loading' || !s) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.web}>{header}<View style={styles.center}>
          {error ? <Notice type="error">{error}</Notice> : <ActivityIndicator color={colors.primary} />}
        </View></View>
      </SafeAreaView>
    );
  }

  const amount = order?.amount ?? s.amountDue ?? s.cost.total;
  const sandbox = cfg?.sandbox !== false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.web}>
        {header}
        <OfflineBanner />
        <ScrollView contentContainerStyle={styles.content}>
          {sandbox ? (
            <View style={styles.sandbox}>
              <Ionicons name="flask" size={15} color="#92400E" />
              <Text style={styles.sandboxText}>MÔI TRƯỜNG THỬ NGHIỆM MoMo – không trừ tiền thật</Text>
            </View>
          ) : null}
          {error ? <Notice type="error">{error}</Notice> : null}

          {phase === 'paid' ? (
            <Result ok title="Thanh toán thành công" amount={amount} order={order}
              onReceipt={order?.payment?.id ? () => navigation.replace('Receipt', { paymentId: order.payment.id }) : null}
              onBack={() => navigation.replace('SessionDetail', { id: sessionId })} />
          ) : phase === 'failed' ? (
            <Result title={order?.status === 'expired' ? 'Đơn thanh toán đã hết hạn' : 'Thanh toán chưa thành công'}
              amount={amount} order={order}
              onRetry={() => { setOrder(null); setPhase('choose'); }} />
          ) : phase === 'waiting' ? (
            <View style={styles.card}>
              <View style={styles.waitHead}>
                <ActivityIndicator color="#A50064" />
                <Text style={styles.waitTitle}>Đang chờ xác nhận từ MoMo…</Text>
              </View>
              <Text style={styles.waitAmount}>{formatVND(amount)}</Text>
              <Text style={styles.muted}>{order?.methodLabel} • Mã đơn {order?.orderId}</Text>
              {order?.expiresAt ? (
                <Text style={styles.muted}>Đơn hết hạn sau {formatCountdown(Math.max(0, Math.floor((new Date(order.expiresAt) - now) / 1000)))}</Text>
              ) : null}
              <Text style={styles.waitHint}>
                Hoàn tất thanh toán trên trang MoMo vừa mở. Kết quả sẽ tự cập nhật tại đây.
              </Text>
              {sandbox && cfg?.hints?.[order?.method] ? <Text style={styles.hintBox}>{cfg.hints[order.method]}</Text> : null}
              <Button title="Mở lại trang thanh toán" onPress={() => openGateway(order)} style={{ marginTop: 12 }} />
              <Button title="Tôi đã thanh toán – kiểm tra ngay" variant="outline" onPress={() => poll(order.orderId)} style={{ marginTop: 8 }} />
              <Pressable onPress={() => { setPhase('choose'); }} style={styles.link}>
                <Text style={styles.linkText}>Chọn phương thức khác</Text>
              </Pressable>
            </View>
          ) : null}

          {/* CHI TIET CAC KHOAN PHI */}
          <FeeDetails s={s} amount={amount} now={now} />

          {phase === 'choose' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Phương thức thanh toán</Text>
              {METHODS.filter((m) => !cfg || cfg.methods.includes(m.key)).map((m) => {
                const on = method === m.key;
                return (
                  <Pressable key={m.key} onPress={() => setMethod(m.key)} style={[styles.method, on && styles.methodOn]}
                    accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <View style={[styles.methodIcon, { backgroundColor: `${m.color}14` }]}>
                      <Ionicons name={m.icon} size={20} color={m.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.methodLabel}>{m.label}</Text>
                      <Text style={styles.methodSub}>{m.sub}</Text>
                    </View>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : '#CBD5E1'} />
                  </Pressable>
                );
              })}
              {sandbox && cfg?.hints?.[method] ? <Text style={styles.hintBox}>{cfg.hints[method]}</Text> : null}
              <Button title={`Thanh toán ${formatVND(amount)}`} onPress={pay} loading={busy} disabled={!amount} style={{ marginTop: 12 }} />
              <Text style={styles.secure}>
                <Ionicons name="lock-closed" size={11} color={colors.textMuted} /> Thông tin thẻ được nhập trên trang của MoMo, SmartPark không lưu thông tin thẻ.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function FeeDetails({ s, amount, now }) {
  const seconds = s.durationSeconds ?? s.elapsedSeconds;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Chi tiết các khoản phí</Text>
      <Line label="Vào bãi" value={formatDateTime(s.startedAt)} />
      <Line label={s.endedAt ? 'Rời ô (chốt phí)' : 'Tính đến'} value={s.endedAt ? formatDateTime(s.endedAt) : formatClock(now)} />
      <Line label="Thời gian gửi" value={formatElapsed(seconds)} />
      <Line label="Đơn giá" value={`${formatVND(s.pricePerHour)}/giờ (làm tròn lên theo giờ)`} />
      <View style={styles.sep} />
      {s.cost.base > 0 ? (
        <Line label={`Phí gửi xe${s.cost.hours ? ` (${s.cost.hours} giờ)` : ''}`} value={formatVND(s.cost.base)} />
      ) : null}
      {s.cost.overtime > 0 ? <Line label="Phụ phí quá giờ dự kiến" value={formatVND(s.cost.overtime)} danger /> : null}
      {s.cost.total === 0 ? <Line label="Miễn phí (rời bãi trong thời gian ân hạn)" value={formatVND(0)} /> : null}
      <View style={styles.sep} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Tổng thanh toán</Text>
        <Text style={styles.total}>{formatVND(amount)}</Text>
      </View>
      {!s.endedAt ? <Text style={styles.muted}>Xe chưa đỗ vào ô: phí được chốt tại thời điểm thanh toán.</Text> : null}
    </View>
  );
}

function Line({ label, value, danger }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, danger && { color: colors.danger }]}>{label}</Text>
      <Text style={[styles.lineValue, danger && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

function Result({ ok, title, amount, order, onReceipt, onBack, onRetry }) {
  const p = order?.payment;
  return (
    <View style={[styles.card, styles.result]}>
      <View style={[styles.resultIcon, { backgroundColor: ok ? colors.successSoft : colors.dangerSoft }]}>
        <Ionicons name={ok ? 'checkmark' : 'close'} size={36} color={ok ? colors.success : colors.danger} />
      </View>
      <Text style={[styles.resultTitle, { color: ok ? colors.success : colors.danger }]}>{title}</Text>
      <Text style={styles.resultAmount}>{formatVND(amount)}</Text>
      {!ok && order?.message ? <Text style={styles.resultReason}>Lý do: {order.message}</Text> : null}
      {ok && p ? (
        <View style={styles.resultInfo}>
          {p.receiptNo ? <Line label="Số biên nhận" value={p.receiptNo} /> : null}
          {p.methodLabel ? <Line label="Phương thức" value={p.methodLabel} /> : null}
          {p.gatewayTransId ? <Line label="Mã giao dịch MoMo" value={p.gatewayTransId} /> : null}
          {p.code ? <Line label="Mã GD SmartPark" value={p.code} /> : null}
          {p.createdAt || p.paidAt ? <Line label="Thời gian" value={formatDateTime(p.createdAt || p.paidAt)} /> : null}
        </View>
      ) : null}
      {ok ? (
        <>
          <Text style={styles.muted}>Đến cổng ra, dùng app quét mã QR tại cổng, barie sẽ tự mở.</Text>
          {onReceipt ? <Button title="Xem biên nhận điện tử" onPress={onReceipt} style={styles.fullBtn} /> : null}
          <Button title="Về phiên gửi xe" variant="outline" onPress={onBack} style={styles.fullBtn} />
        </>
      ) : (
        <Button title="Thử lại / chọn phương thức khác" onPress={onRetry} style={styles.fullBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  web: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: '100vh' } : {}),
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  muted: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center', marginTop: 4 },

  sandbox: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: '#FEF3C7', marginBottom: 12 },
  sandboxText: { fontSize: 11, fontWeight: '900', color: '#92400E', letterSpacing: 0.3 },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 5 },
  lineLabel: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  lineValue: { fontSize: 13.5, fontWeight: '700', color: colors.text, textAlign: 'right', flexShrink: 1 },
  sep: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  totalLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  total: { fontSize: 22, fontWeight: '900', color: colors.primary },

  method: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0', marginBottom: 8 },
  methodOn: { borderColor: colors.primary, backgroundColor: '#F8FAFF' },
  methodIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  methodSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  hintBox: { fontSize: 12, color: '#92400E', backgroundColor: '#FFFBEB', borderRadius: radius.md, padding: 10, marginTop: 6, lineHeight: 17 },
  secure: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', marginTop: 10 },

  waitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  waitTitle: { fontSize: 15, fontWeight: '800', color: '#A50064' },
  waitAmount: { fontSize: 30, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 10 },
  waitHint: { fontSize: 13, color: colors.text, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  link: { alignItems: 'center', paddingVertical: 12 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },

  result: { alignItems: 'center' },
  resultIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 18, fontWeight: '900', marginTop: 10 },
  resultAmount: { fontSize: 28, fontWeight: '900', color: colors.text, marginTop: 4 },
  resultReason: { fontSize: 13.5, color: colors.danger, marginTop: 6, textAlign: 'center' },
  resultInfo: { alignSelf: 'stretch', marginTop: 10, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  fullBtn: { alignSelf: 'stretch', marginTop: 10 },
});
