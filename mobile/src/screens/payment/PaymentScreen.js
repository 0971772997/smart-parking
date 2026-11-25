// THANH TOAN PHI GUI XE - tra truc tiep cho bai, NHAN VIEN XAC NHAN da nhan tien roi barie cong ra tu mo:
//   - Tien mat: dua tien cho nhan vien tai cong
//   - Chuyen khoan ngan hang: mo thang app ngan hang (deeplink VietQR) dien san STK, so tien, noi dung; du phong ma VietQR
//   - Vi MoMo: chuyen tien vao so MoMo cua bai (hoac dung MoMo quet ma VietQR)
// Chi tiet phi -> chon phuong thuc -> don cho xac nhan (noi dung CK = ma don) -> admin xac nhan -> ket qua + bien nhan.
// Dang cho ma tat app -> mo lai man hinh se tiep tuc theo doi don cu (luu ma don tren may).
// params: { sessionId, method?, auto? }  (auto + method: tao don ngay, vd bam 'Tra tien mat' o man quet ma tai cong)
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import OfflineBanner from '../../components/OfflineBanner';
import { paymentsApi } from '../../api/payments';
import { sessionsApi } from '../../api/sessions';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatClock, formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { formatElapsed } from '../../utils/session';

const METHODS = [
  { key: 'cash', label: 'Tiền mặt', sub: 'Trả cho nhân viên tại cổng ra', icon: 'cash-outline', color: '#16A34A' },
  { key: 'bank', label: 'Chuyển khoản ngân hàng', sub: 'Mở app ngân hàng – tự điền số tiền, nội dung', icon: 'business-outline', color: '#1D4ED8' },
  { key: 'momo', label: 'Ví MoMo', sub: 'Chuyển tiền vào ví MoMo của bãi', icon: 'wallet', color: '#A50064' },
];
const POLL_MS = 3000;
const orderKey = (sid) => `sp_pay_order_${sid}`;
const BANK_APP_KEY = 'sp_bank_app'; // app ngan hang tai xe dung lan truoc

export default function PaymentScreen({ navigation, route }) {
  const { sessionId, method: presetMethod, auto } = route.params || {};
  const [s, setS] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [method, setMethod] = useState(presetMethod || 'cash');
  const [order, setOrder] = useState(null);      // don dang xu ly / ket qua
  const [phase, setPhase] = useState('loading'); // loading | choose | waiting | paid | failed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now] = useState(() => Date.now());
  const polling = useRef(false);
  const autoDone = useRef(false);

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

  // Dang cho nhan vien xac nhan (hoac da xong nhung bien nhan dang duoc tao): hoi lai moi 3 giay
  const waiting = (phase === 'waiting' || (phase === 'paid' && !order?.payment)) && order?.orderId;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => poll(order.orderId), POLL_MS);
    return () => clearInterval(t);
  }, [waiting, order?.orderId, poll]);
  const waitingId = phase === 'waiting' ? order?.orderId : null;
  useOnLiveChange(useCallback(() => { if (waitingId) poll(waitingId); }, [waitingId, poll]));

  async function pay(m = method) {
    setBusy(true);
    setError(null);
    try {
      const o = await paymentsApi.manualPay(sessionId, m);
      AsyncStorage.setItem(orderKey(sessionId), o.orderId).catch(() => {});
      applyOrder(o);
    } catch (e) {
      if (e.code === 'already_paid' || e.code === 'no_payment_needed') navigation.replace('SessionDetail', { id: sessionId });
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Mo tu cong ra voi phuong thuc chon san -> tao don ngay (khong bat chon lai)
  useEffect(() => {
    if (!auto || !presetMethod || phase !== 'choose' || autoDone.current) return;
    autoDone.current = true;
    const t = setTimeout(() => pay(presetMethod), 0);
    return () => clearTimeout(t);
  });

  // Don cong MoMo thu nghiem cu (truoc khi doi sang tra truc tiep) -> mo lai trang thanh toan
  async function openGateway(o) {
    if (!o?.payUrl) return;
    if (Platform.OS === 'web') { globalThis.open?.(o.payUrl, '_blank'); return; }
    await WebBrowser.openBrowserAsync(o.payUrl, { dismissButtonStyle: 'close' }).catch(() => {});
    poll(o.orderId);
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
  const payee = order?.payInfo || cfg?.manual?.payee;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.web}>
        {header}
        <OfflineBanner />
        <ScrollView contentContainerStyle={styles.content}>
          {error ? <Notice type="error">{error}</Notice> : null}

          {phase === 'paid' ? (
            <Result ok title="Thanh toán thành công" amount={amount} order={order}
              onReceipt={order?.payment?.id ? () => navigation.replace('Receipt', { paymentId: order.payment.id }) : null}
              onBack={() => navigation.replace('SessionDetail', { id: sessionId })} />
          ) : phase === 'failed' ? (
            <Result title={order?.status === 'expired' ? 'Đơn thanh toán đã hết hạn' : 'Thanh toán chưa được xác nhận'}
              amount={amount} order={order}
              onRetry={() => { setOrder(null); setPhase('choose'); }} />
          ) : phase === 'waiting' && order ? (
            <Waiting order={order} amount={amount} payee={payee}
              onCheck={() => poll(order.orderId)} onChange={() => setPhase('choose')} onGateway={openGateway} />
          ) : null}

          {/* CHI TIET CAC KHOAN PHI */}
          <FeeDetails s={s} amount={amount} now={now} />

          {phase === 'choose' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Phương thức thanh toán</Text>
              {METHODS.map((m) => {
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
              {method !== 'cash' && payee ? (
                <Text style={styles.hintBox}>
                  Tiền chuyển vào tài khoản {payee.accountName} • {method === 'momo' ? `MoMo ${payee.momoPhone}` : `${payee.bankName} ${payee.accountNo}`}.
                </Text>
              ) : null}
              <Button title={method === 'cash' ? `Trả tiền mặt ${formatVND(amount)}` : `Tiếp tục – ${formatVND(amount)}`}
                onPress={() => pay()} loading={busy} disabled={!amount} style={{ marginTop: 12 }} />
              <Text style={styles.secure}>
                <Ionicons name="shield-checkmark-outline" size={11} color={colors.textMuted} /> Nhân viên xác nhận đã nhận tiền thì barie cổng ra tự mở.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// Dang cho nhan vien xac nhan: huong dan tra tien theo phuong thuc + thong tin chuyen khoan
function Waiting({ order, amount, payee, onCheck, onChange, onGateway }) {
  const info = order.payInfo;
  const cash = order.method === 'cash';
  const momo = order.method === 'momo';
  const [showQr, setShowQr] = useState(false);
  const [lastApp, setLastApp] = useState(null);
  const [opened, setOpened] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(BANK_APP_KEY).then(setLastApp).catch(() => {});
  }, []);

  // Mo app ngan hang: dien san STK, so tien, noi dung (app ho tro tu dien) -> tai xe chi bam xac nhan chuyen
  function openBank(app) {
    setOpened(app.appId);
    setLastApp(app.appId);
    AsyncStorage.setItem(BANK_APP_KEY, app.appId).catch(() => {});
    if (Platform.OS === 'web') globalThis.open?.(app.url, '_blank');
    else Linking.openURL(app.url).catch(() => setShowQr(true));
  }

  if (order.provider && order.provider !== 'manual') {
    return (
      <View style={styles.card}>
        <View style={styles.waitHead}>
          <ActivityIndicator color="#A50064" />
          <Text style={styles.waitTitle}>Đang chờ xác nhận từ MoMo…</Text>
        </View>
        <Text style={styles.waitAmount}>{formatVND(amount)}</Text>
        <Button title="Mở lại trang thanh toán" onPress={() => onGateway(order)} style={{ marginTop: 12 }} />
        <Pressable onPress={onChange} style={styles.link}><Text style={styles.linkText}>Chọn phương thức khác</Text></Pressable>
      </View>
    );
  }

  const apps = info?.bankApps || [];
  const preferred = apps.find((a) => a.appId === lastApp) || apps.find((a) => a.autofill);
  const autoApps = apps.filter((a) => a.autofill && a !== preferred);
  const otherApps = apps.filter((a) => !a.autofill);

  return (
    <View style={styles.card}>
      <View style={styles.waitHead}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.waitTitle}>Đang chờ nhân viên xác nhận…</Text>
      </View>
      <Text style={styles.waitAmount}>{formatVND(amount)}</Text>
      <Text style={styles.muted}>{order.methodLabel || (cash ? 'Tiền mặt' : momo ? 'Ví MoMo' : 'Chuyển khoản')} • Mã đơn {order.orderId}</Text>

      {cash ? (
        <Text style={styles.waitHint}>
          Đưa <Text style={styles.strong}>{formatVND(amount)}</Text> cho nhân viên tại cổng ra và đọc mã đơn{' '}
          <Text style={styles.strong}>{order.orderId}</Text>. Nhân viên xác nhận xong, barie sẽ tự mở.
        </Text>
      ) : info && !momo ? (
        <>
          <Text style={styles.waitHint}>
            Chọn app ngân hàng của bạn: số tài khoản, số tiền và nội dung được <Text style={styles.strong}>điền sẵn</Text>,
            bạn chỉ cần xác nhận chuyển rồi quay lại đây.
          </Text>
          {preferred ? (
            <Button title={`Mở ${preferred.name}${preferred.autofill ? ' – tự điền' : ''}`} onPress={() => openBank(preferred)}
              style={{ marginTop: 12 }} />
          ) : null}
          <View style={styles.appGrid}>
            {autoApps.map((a) => (
              <Pressable key={a.appId} onPress={() => openBank(a)} style={[styles.appChip, opened === a.appId && styles.appChipOn]}
                accessibilityLabel={`Mở ${a.name}, tự điền thông tin chuyển khoản`}>
                <Ionicons name="flash" size={13} color={colors.success} />
                <Text style={styles.appChipText}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
          {otherApps.length ? (
            <Text style={styles.mutedSmall}>
              {otherApps.map((a) => a.name).join(', ')} chưa hỗ trợ tự điền – dùng mã VietQR bên dưới.
            </Text>
          ) : null}
          <Summary info={info} />
          <Pressable onPress={() => setShowQr((v) => !v)} style={styles.link}>
            <Text style={styles.linkText}>{showQr ? 'Ẩn mã QR' : 'Dùng mã VietQR (quét bằng máy khác)'}</Text>
          </Pressable>
          {showQr ? (
            <View style={styles.qrBox}>
              <QRCode value={info.vietqr} size={190} ecl="M" color={colors.navy} backgroundColor="#FFFFFF" />
            </View>
          ) : null}
        </>
      ) : info && momo ? (
        <>
          <Text style={styles.waitHint}>
            Ví MoMo cá nhân chưa hỗ trợ tự điền. Mở MoMo ▸ Quét mã (hoặc chuyển tới số ví) với đúng số tiền và nội dung bên dưới.
          </Text>
          {Platform.OS !== 'web' ? (
            <Button title="Mở app MoMo" onPress={() => Linking.openURL('momo://').catch(() => {})} style={{ marginTop: 12 }} />
          ) : null}
          <Summary info={info} momo />
          <View style={styles.qrBox}>
            <QRCode value={info.vietqr} size={190} ecl="M" color={colors.navy} backgroundColor="#FFFFFF" />
          </View>
        </>
      ) : payee ? <Text style={styles.waitHint}>Chuyển {formatVND(amount)} tới {payee.accountName}.</Text> : null}

      <Button title={cash ? 'Kiểm tra trạng thái' : 'Tôi đã chuyển tiền – kiểm tra'} variant="outline" onPress={onCheck} style={{ marginTop: 12 }} />
      <Pressable onPress={onChange} style={styles.link}><Text style={styles.linkText}>Đổi phương thức thanh toán</Text></Pressable>
    </View>
  );
}

// Thong tin chuyen khoan de doi chieu (da duoc dien san khi mo app ngan hang)
function Summary({ info, momo }) {
  return (
    <View style={styles.infoBox}>
      {momo ? <InfoLine label="Số ví MoMo" value={info.momoPhone} /> : (
        <InfoLine label="Tài khoản" value={`${info.bankName} • ${info.accountNo}`} />
      )}
      <InfoLine label="Chủ tài khoản" value={info.accountName} />
      <InfoLine label="Số tiền" value={formatVND(info.amount)} />
      <InfoLine label="Nội dung" value={info.content} />
    </View>
  );
}

function InfoLine({ label, value }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
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
      {s.cost.holdFee > 0 ? (
        <Line label={`Phí giữ chỗ thêm${s.cost.holdExtensions ? ` (gồm ${s.cost.holdExtensions} lần gia hạn)` : ''}`} value={formatVND(s.cost.holdFee)} />
      ) : null}
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
          <Text style={styles.muted}>Nếu barie chưa mở, quét mã QR tại cổng bằng app.</Text>
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
  strong: { fontWeight: '900', color: colors.text },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 5 },
  lineLabel: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  lineValue: { fontSize: 13.5, fontWeight: '700', color: colors.text, textAlign: 'right', flexShrink: 1 },
  appGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 10 },
  appChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  appChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  appChipText: { fontSize: 13, fontWeight: '800', color: colors.text },
  mutedSmall: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  sep: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  totalLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  total: { fontSize: 22, fontWeight: '900', color: colors.primary },

  method: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0', marginBottom: 8 },
  methodOn: { borderColor: colors.primary, backgroundColor: '#F8FAFF' },
  methodIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  methodSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  hintBox: { fontSize: 12, color: colors.primaryDark, backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 10, marginTop: 6, lineHeight: 17 },
  secure: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', marginTop: 10 },

  waitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  waitTitle: { fontSize: 15, fontWeight: '800', color: colors.primary },
  waitAmount: { fontSize: 30, fontWeight: '900', color: colors.text, textAlign: 'center', marginTop: 10 },
  waitHint: { fontSize: 13.5, color: colors.text, textAlign: 'center', marginTop: 10, lineHeight: 19 },
  qrBox: { alignSelf: 'center', padding: 10, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', marginTop: 12 },
  infoBox: { marginTop: 10, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  warn: { fontSize: 12, color: '#92400E', backgroundColor: '#FFFBEB', borderRadius: radius.md, padding: 8, marginTop: 8, textAlign: 'center' },
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
