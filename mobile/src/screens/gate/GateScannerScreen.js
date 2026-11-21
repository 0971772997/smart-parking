// QUET MA QR TAI CONG (nhan vien / admin)
// Chon bai + cong (vao/ra) -> quet ma tren app tai xe -> may chu xac thuc -> lenh mo barie toi ESP32
// -> hien KET QUA ro rang (mo barie / tu choi + cach xu ly). Co o nhap ma thu cong khi camera loi.
// params: { lotId? }
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Button from '../../components/Button';
import { lotsApi } from '../../api/lots';
import { gatesApi, paymentsApi } from '../../api/gates';
import { colors, radius } from '../../theme';
import { formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';

const GATES = [
  { key: 'entry', label: 'Cổng VÀO', icon: 'enter-outline' },
  { key: 'exit', label: 'Cổng RA', icon: 'exit-outline' },
];
const gateLabel = (g) => (g === 'exit' ? 'cổng RA' : 'cổng VÀO');

// Huong dan nhan vien xu ly theo tung loi quet
const HELP = {
  qr_invalid: 'Không phải mã SmartPark. Yêu cầu tài xế mở đúng màn "Chi tiết đặt chỗ" trên app.',
  qr_expired: 'Mã đã quá 2 phút. Yêu cầu tài xế kéo xuống để làm mới mã rồi quét lại.',
  reservation_not_found: 'Đối chiếu mã đặt chỗ (DC-...) với tài xế hoặc xử lý như khách vãng lai.',
  wrong_lot: 'Tài xế đặt chỗ ở bãi khác – hướng dẫn tài xế đến đúng bãi.',
  wrong_gate: 'Mã này dành cho cổng còn lại.',
  already_entered: 'Mã đã được dùng để vào. Nếu barie chưa mở, kiểm tra nhật ký bên dưới.',
  already_exited: 'Lượt đặt chỗ đã kết thúc.',
  not_entered: 'Xe chưa quét mã ở cổng vào. Kiểm tra lại với tài xế.',
  pass_expired: 'Mã ra bãi quá hạn (48 giờ) – mở barie thủ công sau khi đối chiếu.',
  reservation_expired: 'Đặt chỗ đã hết giờ giữ chỗ. Tài xế có thể đặt lại hoặc gửi xe như khách vãng lai.',
  reservation_not_active: 'Đặt chỗ đã huỷ / hết hạn / thất bại.',
  still_parked: 'Cảm biến vẫn thấy xe trong ô. Kiểm tra ô đỗ hoặc chờ vài giây rồi quét lại.',
  payment_required: 'Thu phí rồi mở cổng, hoặc để tài xế thanh toán trên app rồi quét lại.',
  device_offline: 'Bộ điều khiển barie mất kết nối – mở barie thủ công.',
  device_timeout: 'Barie chưa phản hồi. Bấm "Thử lại"; nếu vẫn lỗi hãy mở thủ công.',
  scan_in_progress: 'Mã đang được xử lý ở máy quét khác – chờ vài giây.',
  network_error: 'Kiểm tra kết nối mạng của máy quét.',
  timeout: 'Máy chủ phản hồi chậm. Bấm "Thử lại".',
};

const RETRYABLE = ['device_timeout', 'device_offline', 'network_error', 'timeout', 'scan_in_progress', 'still_parked', 'internal_error'];
const SAME_CODE_IGNORE_MS = 4000;
const AUTO_RESUME_MS = 3500;

export default function GateScannerScreen({ navigation, route }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState(route.params?.lotId || null);
  const [gate, setGate] = useState('entry');
  const [result, setResult] = useState(null); // { ok, ...data } | { ok:false, code, message, details }
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [log, setLog] = useState([]);
  const [collecting, setCollecting] = useState(false);
  const lastRef = useRef({ token: null, at: 0 });
  const lastToken = useRef(null);
  const resumeTimer = useRef(null);

  useEffect(() => {
    lotsApi.list().then((l) => {
      setLots(l);
      // Mac dinh: bai dang online (co barie dieu khien duoc)
      setLotId((cur) => cur || (l.find((x) => x.online) || l[0])?.id || null);
    }).catch(() => {});
    return () => clearTimeout(resumeTimer.current);
  }, []);

  const loadLog = useCallback(() => {
    if (!lotId) return;
    gatesApi.scans(lotId, 15).then(setLog).catch(() => {});
  }, [lotId]);
  useEffect(() => { loadLog(); }, [loadLog]);

  const submit = useCallback(async (token, gateOverride) => {
    if (!lotId || !token) return;
    const g = gateOverride || gate;
    clearTimeout(resumeTimer.current);
    lastToken.current = token;
    setBusy(true);
    setResult(null);
    try {
      const r = await gatesApi.scan({ lotId, gate: g, token });
      setResult({ ok: true, ...r });
      if (Platform.OS !== 'web') Vibration.vibrate(80);
      // Thanh cong -> tu quay lai che do quet cho xe tiep theo
      resumeTimer.current = setTimeout(() => setResult(null), AUTO_RESUME_MS);
    } catch (e) {
      setResult({ ok: false, code: e.code, message: e.message, details: e.details || {} });
      if (Platform.OS !== 'web') Vibration.vibrate([0, 120, 80, 120]);
    } finally {
      setBusy(false);
      loadLog();
    }
  }, [lotId, gate, loadLog]);

  function onScanned({ data }) {
    if (busy || result) return;
    const now = Date.now();
    // Camera bao cung 1 ma nhieu lan/giay -> bo qua ma vua quet
    if (data === lastRef.current.token && now - lastRef.current.at < SAME_CODE_IGNORE_MS) return;
    lastRef.current = { token: data, at: now };
    submit(data);
  }

  // Thu tien mat tai cong roi quet lai cung ma -> mo barie
  async function collectAndOpen() {
    setCollecting(true);
    try {
      await paymentsApi.collect(lotId, result.details.sessionId, 'cash');
    } catch (e) {
      if (e.code !== 'already_paid') {
        setResult((r) => ({ ...r, message: e.message }));
        setCollecting(false);
        return;
      }
    }
    setCollecting(false);
    submit(lastToken.current);
  }

  function switchGateAndRetry() {
    const other = gate === 'entry' ? 'exit' : 'entry';
    setGate(other);
    submit(lastToken.current, other);
  }

  const scanning = !busy && !result;
  const lot = lots.find((l) => l.id === lotId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.webContainer}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.headerTitle}>Quét mã tại cổng</Text>
            <Text style={styles.headerSub}>{lot ? `${lot.name}${lot.online ? '' : ' • thiết bị offline'}` : 'Chọn bãi đỗ'}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* CHON BAI + CONG */}
          {lots.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {lots.map((l) => (
                <Pressable key={l.id} onPress={() => { setLotId(l.id); setResult(null); }}
                  style={[styles.chip, l.id === lotId && styles.chipOn]}>
                  <View style={[styles.dot, { backgroundColor: l.online ? colors.accent : '#94A3B8' }]} />
                  <Text style={[styles.chipText, l.id === lotId && styles.chipTextOn]} numberOfLines={1}>{l.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <View style={styles.gateRow}>
            {GATES.map((g) => (
              <Pressable key={g.key} onPress={() => { setGate(g.key); setResult(null); }}
                style={[styles.gateBtn, gate === g.key && styles.gateBtnOn]} accessibilityState={{ selected: gate === g.key }}>
                <Ionicons name={g.icon} size={18} color={gate === g.key ? '#fff' : colors.textMuted} />
                <Text style={[styles.gateBtnText, gate === g.key && { color: '#fff' }]}>{g.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* CAMERA / KET QUA */}
          <View style={styles.viewport}>
            {result ? (
              <ResultPanel
                result={result}
                gate={gate}
                collecting={collecting}
                onNext={() => setResult(null)}
                onRetry={() => submit(lastToken.current)}
                onCollect={collectAndOpen}
                onSwitchGate={switchGateAndRetry}
              />
            ) : !permission ? (
              <ActivityIndicator color="#fff" />
            ) : !permission.granted ? (
              <View style={styles.permBox}>
                <Ionicons name="camera-outline" size={36} color="#fff" />
                <Text style={styles.permText}>Cần quyền camera để quét mã QR của tài xế.</Text>
                <Button title="Cho phép camera" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
              </View>
            ) : (
              <>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanning ? onScanned : undefined}
                />
                <View style={styles.frame} pointerEvents="none" />
                <Text style={styles.camHint} pointerEvents="none">
                  {busy ? 'Đang xác thực…' : `Đưa mã QR ${gateLabel(gate)} vào khung`}
                </Text>
                {busy && <View style={styles.busy}><ActivityIndicator size="large" color="#fff" /></View>}
              </>
            )}
          </View>

          {/* NHAP THU CONG */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Không quét được? Nhập nội dung mã</Text>
            <View style={styles.manualRow}>
              <TextInput
                value={manual}
                onChangeText={setManual}
                placeholder="SP1.xxxx…"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                onSubmitEditing={() => manual.trim() && submit(manual.trim())}
              />
              <Button title="Kiểm tra" onPress={() => submit(manual.trim())} disabled={!manual.trim() || busy}
                style={{ paddingHorizontal: 16 }} />
            </View>
          </View>

          {/* NHAT KY */}
          <View style={styles.card}>
            <View style={styles.logHead}>
              <Text style={styles.cardTitle}>Lượt quét gần đây</Text>
              <Pressable onPress={loadLog} hitSlop={8}><Ionicons name="refresh" size={16} color={colors.textMuted} /></Pressable>
            </View>
            {log.length === 0 ? <Text style={styles.muted}>Chưa có lượt quét.</Text> : log.map((s) => (
              <View key={s.id} style={styles.logRow}>
                <Ionicons
                  name={s.result === 'granted' ? 'checkmark-circle' : s.result === 'pending' ? 'time' : 'close-circle'}
                  size={18}
                  color={s.result === 'granted' ? colors.success : s.result === 'pending' ? colors.warning : colors.danger}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.logMain} numberOfLines={1}>
                    {s.gate === 'exit' ? 'RA' : 'VÀO'} • {s.reservationCode || 'Mã lạ'}{s.slotNumber ? ` • ô #${s.slotNumber}` : ''}
                    {s.vehiclePlate ? ` • ${s.vehiclePlate}` : ''}
                  </Text>
                  {s.result === 'denied' ? <Text style={styles.logErr} numberOfLines={1}>{errorTitle(s.error)}</Text> : null}
                </View>
                <Text style={styles.logTime}>{formatDateTime(s.createdAt)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const TITLES = {
  qr_invalid: 'Mã không hợp lệ', qr_expired: 'Mã đã hết hạn', reservation_not_found: 'Không tìm thấy đặt chỗ',
  wrong_lot: 'Sai bãi đỗ', wrong_gate: 'Sai cổng', already_entered: 'Mã đã dùng để vào', already_exited: 'Đã ra bãi',
  not_entered: 'Xe chưa vào bãi', pass_expired: 'Mã ra quá hạn', reservation_expired: 'Đặt chỗ hết giờ giữ',
  reservation_not_active: 'Đặt chỗ không còn hiệu lực', still_parked: 'Xe vẫn trong ô', payment_required: 'Chưa thanh toán',
  device_offline: 'Thiết bị offline', device_timeout: 'Barie không phản hồi', scan_in_progress: 'Đang xử lý ở máy khác',
};
const errorTitle = (code) => TITLES[code] || code || 'Lỗi';

function ResultPanel({ result, gate, collecting, onNext, onRetry, onCollect, onSwitchGate }) {
  const r = result.reservation || result.details?.reservation;
  if (result.ok) {
    return (
      <View style={[styles.result, { backgroundColor: colors.success }]}>
        <Ionicons name="checkmark-circle" size={64} color="#fff" />
        <Text style={styles.resultTitle}>{result.gate === 'exit' ? 'MỞ BARIE RA' : 'MỞ BARIE VÀO'}</Text>
        {result.gate === 'entry' && r ? (
          <Text style={styles.resultBig}>Khu {r.zone || '—'} • Ô #{r.slotNumber}</Text>
        ) : <Text style={styles.resultBig}>Hẹn gặp lại!</Text>}
        {r ? <Text style={styles.resultSub}>{r.code}{r.vehiclePlate ? ` • ${r.vehiclePlate}` : ''}</Text> : null}
        <Text style={styles.resultSub}>Thiết bị đã xác nhận mở barie</Text>
        <Pressable onPress={onNext} style={styles.resultBtn}><Text style={styles.resultBtnText}>Quét xe tiếp theo</Text></Pressable>
      </View>
    );
  }
  const { code, details = {} } = result;
  const other = details.qrGate || (gate === 'entry' ? 'exit' : 'entry');
  return (
    <View style={[styles.result, { backgroundColor: code === 'payment_required' ? '#B45309' : colors.danger }]}>
      <Ionicons name={code === 'payment_required' ? 'wallet' : 'close-circle'} size={56} color="#fff" />
      <Text style={styles.resultTitle}>KHÔNG MỞ BARIE</Text>
      <Text style={styles.resultBig}>{errorTitle(code)}</Text>
      <Text style={styles.resultSub}>{result.message}</Text>
      {code === 'wrong_lot' && details.expectedLot ? <Text style={styles.resultSub}>Bãi đúng: {details.expectedLot.name}</Text> : null}
      {code === 'payment_required' ? <Text style={styles.resultFee}>{formatVND(details.fee)}</Text> : null}
      {r ? <Text style={styles.resultSub}>{r.code} • ô #{r.slotNumber}{r.vehiclePlate ? ` • ${r.vehiclePlate}` : ''}</Text> : null}
      {HELP[code] ? <Text style={styles.resultHelp}>{HELP[code]}</Text> : null}

      <View style={styles.resultActions}>
        {code === 'payment_required' && (
          <Pressable onPress={onCollect} style={styles.resultBtn} disabled={collecting}>
            {collecting ? <ActivityIndicator color={colors.text} />
              : <Text style={styles.resultBtnText}>Đã thu tiền mặt – mở cổng</Text>}
          </Pressable>
        )}
        {code === 'wrong_gate' && (
          <Pressable onPress={onSwitchGate} style={styles.resultBtn}>
            <Text style={styles.resultBtnText}>Chuyển sang {gateLabel(other)} & mở</Text>
          </Pressable>
        )}
        {RETRYABLE.includes(code) && (
          <Pressable onPress={onRetry} style={styles.resultBtn}><Text style={styles.resultBtnText}>Thử lại</Text></Pressable>
        )}
        <Pressable onPress={onNext} style={[styles.resultBtn, styles.resultBtnGhost]}>
          <Text style={[styles.resultBtnText, { color: '#fff' }]}>Quét mã khác</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  webContainer: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: '100vh' } : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  muted: { fontSize: 13, color: colors.textMuted },

  chips: { gap: 8, paddingBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff', maxWidth: 220 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4 },

  gateRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  gateBtn: { flex: 1, height: 48, borderRadius: radius.md, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0' },
  gateBtnOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  gateBtnText: { fontSize: 15, fontWeight: '800', color: colors.textMuted },

  viewport: { height: 380, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  frame: { width: 220, height: 220, borderRadius: 18, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  camHint: { position: 'absolute', bottom: 18, color: '#fff', fontSize: 13.5, fontWeight: '700', backgroundColor: 'rgba(15,23,42,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, overflow: 'hidden' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center' },
  permBox: { alignItems: 'center', gap: 12, padding: 24, alignSelf: 'stretch' },
  permText: { color: '#E2E8F0', fontSize: 14, textAlign: 'center' },

  result: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 4 },
  resultTitle: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 1.5, marginTop: 6 },
  resultBig: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  resultFee: { color: '#fff', fontSize: 30, fontWeight: '900' },
  resultSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13, textAlign: 'center' },
  resultHelp: { color: '#fff', fontSize: 12.5, textAlign: 'center', marginTop: 8, backgroundColor: 'rgba(0,0,0,0.15)', padding: 8, borderRadius: radius.sm, overflow: 'hidden' },
  resultActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  resultBtn: { backgroundColor: '#fff', paddingHorizontal: 16, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', minWidth: 110 },
  resultBtnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  resultBtnText: { color: colors.text, fontWeight: '800', fontSize: 13.5 },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  manualRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: '#fff' },
  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  logMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  logErr: { fontSize: 12, color: colors.danger, marginTop: 1 },
  logTime: { fontSize: 11.5, color: colors.textMuted },
});
