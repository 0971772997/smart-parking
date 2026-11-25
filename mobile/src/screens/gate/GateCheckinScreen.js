// TAI XE QUET MA QR TAI CONG
// Den cong vao / ra -> mo man nay -> quet ma QR hien tren man hinh cua cong (admin dat tai cong)
// -> may chu tim dat cho cua toi o bai do, kiem tra -> mo barie. Co o nhap ma thu cong khi camera loi.
// Chon xe dang lai (gan vao dat cho neu luc dat chua chon xe).
// params: { reservationId? } - mo tu chi tiet dat cho / phien gui xe -> chi dung dat cho nay
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import ScreenShell from '../../components/ScreenShell';
import Button from '../../components/Button';
import { gatesApi } from '../../api/gates';
import { vehiclesApi } from '../../api/vehicles';
import { reservationsApi } from '../../api/reservations';
import { colors, radius } from '../../theme';
import { formatVND } from '../../utils/schedules';
import { classifyQr, driverError, gateLabel, RETRYABLE } from '../../utils/gate';
import { vehicleType } from '../../utils/vehicles';

const SAME_CODE_IGNORE_MS = 4000;

export default function GateCheckinScreen({ navigation, route }) {
  const reservationId = route.params?.reservationId || null;
  const [permission, requestPermission] = useCameraPermissions();
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState(null);
  const [resvVehicle, setResvVehicle] = useState(null); // xe da gan voi dat cho (khong doi duoc nua)
  const [result, setResult] = useState(null); // { ok, ...data } | { ok:false, code, message, details }
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [hint, setHint] = useState(null);
  const [scannedGate, setScannedGate] = useState(null);
  const lastRef = useRef({ token: null, at: 0 });
  const lastToken = useRef(null);

  useEffect(() => {
    vehiclesApi.list().then((list) => {
      setVehicles(list);
      setVehicleId((cur) => cur ?? list[0]?.id ?? null);
    }).catch(() => {});
    if (reservationId) {
      reservationsApi.detail(reservationId).then((r) => {
        if (r.vehicleId) {
          setResvVehicle({ id: r.vehicleId, plateNumber: r.vehiclePlate, vehicleType: r.vehicleType });
          setVehicleId(r.vehicleId);
        }
      }).catch(() => {});
    }
  }, [reservationId]);

  const submit = useCallback(async (token) => {
    if (!token) return;
    lastToken.current = token;
    setScannedGate(classifyQr(token).gate || null);
    setBusy(true);
    setResult(null);
    setHint(null);
    try {
      const r = await gatesApi.checkin({
        token,
        ...(reservationId && { reservationId }),
        ...(vehicleId && !resvVehicle && { vehicleId }),
      });
      setResult({ ok: true, ...r });
      if (r.reservation?.vehicleId) {
        setResvVehicle({ id: r.reservation.vehicleId, plateNumber: r.reservation.vehiclePlate, vehicleType: r.reservation.vehicleType });
      }
      if (Platform.OS !== 'web') Vibration.vibrate(80);
    } catch (e) {
      setResult({ ok: false, code: e.code, message: e.message, details: e.details || {} });
      if (Platform.OS !== 'web') Vibration.vibrate([0, 120, 80, 120]);
    } finally {
      setBusy(false);
    }
  }, [reservationId, vehicleId, resvVehicle]);

  function handleData(data) {
    const q = classifyQr(data);
    if (q.kind === 'reservation') {
      setHint('Đây là mã đặt chỗ cũ. Hãy quét mã QR hiển thị trên màn hình tại cổng.');
      return;
    }
    if (q.kind !== 'gate') {
      setHint('Không phải mã QR cổng SmartPark.');
      return;
    }
    submit(String(data).trim());
  }

  function onScanned({ data }) {
    if (busy || result) return;
    const now = Date.now();
    // Camera bao cung 1 ma nhieu lan/giay -> bo qua ma vua quet
    if (data === lastRef.current.token && now - lastRef.current.at < SAME_CODE_IGNORE_MS) return;
    lastRef.current = { token: data, at: now };
    handleData(data);
  }

  const scanAgain = () => {
    lastRef.current = { token: null, at: 0 };
    setResult(null);
  };

  const scanning = !busy && !result;
  const pickable = !resvVehicle && vehicles.length > 0;

  return (
    <ScreenShell navigation={navigation} title="Quét mã tại cổng" subtitle="Quét mã QR trên màn hình ở cổng vào / ra">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* XE DANG LAI */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Xe của bạn</Text>
          {resvVehicle ? (
            <View style={styles.vehRow}>
              <Ionicons name={vehicleType(resvVehicle.vehicleType).icon} size={18} color={colors.primary} />
              <Text style={styles.vehPlate}>{resvVehicle.plateNumber}</Text>
              <Text style={styles.muted}>• {vehicleType(resvVehicle.vehicleType).label} (đã gắn với đặt chỗ)</Text>
            </View>
          ) : pickable ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {vehicles.map((v) => {
                const on = v.id === vehicleId;
                const t = vehicleType(v.vehicleType);
                return (
                  <Pressable key={v.id} onPress={() => setVehicleId(v.id)} style={[styles.chip, on && styles.chipOn]}
                    accessibilityState={{ selected: on }} accessibilityLabel={`${t.label} ${v.plateNumber}`}>
                    <Ionicons name={t.icon} size={16} color={on ? colors.primary : colors.textMuted} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{v.plateNumber}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.muted}>Chưa khai báo xe. Thêm xe ở tab “Xe của tôi” trên trang chủ để nhân viên dễ đối chiếu.</Text>
          )}
        </View>

        {/* CAMERA / KET QUA */}
        <View style={styles.viewport}>
          {result ? (
            <ResultPanel
              result={result}
              gate={scannedGate}
              onAgain={scanAgain}
              onRetry={() => submit(lastToken.current)}
              onDone={() => navigation.goBack()}
              onPay={(sessionId) => navigation.navigate('Payment', { sessionId })}
              onBook={(lotId) => navigation.navigate('Booking', { lotId })}
              onSession={(id) => navigation.navigate('SessionDetail', { id })}
            />
          ) : !permission ? (
            <ActivityIndicator color="#fff" />
          ) : !permission.granted ? (
            <View style={styles.permBox}>
              <Ionicons name="camera-outline" size={36} color="#fff" />
              <Text style={styles.permText}>Cần quyền camera để quét mã QR tại cổng.</Text>
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
                {busy ? 'Đang mở barie…' : hint || 'Đưa mã QR ở cổng vào khung'}
              </Text>
              {busy && <View style={styles.busy}><ActivityIndicator size="large" color="#fff" /></View>}
            </>
          )}
        </View>

        <View style={styles.steps}>
          <Step n={1} text="Dừng xe trước barie, mở màn hình này." />
          <Step n={2} text="Quét mã QR trên màn hình đặt tại cổng." />
          <Step n={3} text="Barie tự mở khi hợp lệ. Cổng ra cần thanh toán trước." />
        </View>

        {/* NHAP THU CONG */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Không quét được? Nhập nội dung mã</Text>
          <View style={styles.manualRow}>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder="SPG1.xxxx…"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={() => manual.trim() && handleData(manual.trim())}
            />
            <Button title="Gửi" onPress={() => handleData(manual.trim())} disabled={!manual.trim() || busy}
              style={{ paddingHorizontal: 16 }} />
          </View>
          {hint && result == null && !busy ? <Text style={styles.hintText}>{hint}</Text> : null}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

function Step({ n, text }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function ResultPanel({ result, gate, onAgain, onRetry, onDone, onPay, onBook, onSession }) {
  const r = result.reservation || result.details?.reservation;
  if (result.ok) {
    const entry = result.gate === 'entry';
    return (
      <View style={[styles.result, { backgroundColor: colors.success }]}>
        <Ionicons name="checkmark-circle" size={64} color="#fff" />
        <Text style={styles.resultTitle}>{entry ? 'BARIE VÀO ĐÃ MỞ' : 'BARIE RA ĐÃ MỞ'}</Text>
        {entry && r ? <Text style={styles.resultBig}>Khu {r.zone || '—'} • Ô #{r.slotNumber}</Text>
          : <Text style={styles.resultBig}>Hẹn gặp lại!</Text>}
        <Text style={styles.resultSub}>{result.lotName}{r?.vehiclePlate ? ` • ${r.vehiclePlate}` : ''}</Text>
        {!entry && result.fee != null ? <Text style={styles.resultSub}>Tổng phí {formatVND(result.fee)}</Text> : null}
        {entry ? <Text style={styles.resultSub}>Phí gửi xe được tính từ bây giờ</Text> : null}
        <View style={styles.resultActions}>
          {result.sessionId ? (
            <Pressable onPress={() => onSession(result.sessionId)} style={styles.resultBtn}>
              <Text style={styles.resultBtnText}>Xem phiên gửi xe</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onDone} style={[styles.resultBtn, styles.resultBtnGhost]}>
            <Text style={[styles.resultBtnText, { color: '#fff' }]}>Xong</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  const { code, details = {} } = result;
  const { title, help } = driverError(code, result.message);
  const pay = code === 'payment_required';
  return (
    <View style={[styles.result, { backgroundColor: pay ? '#B45309' : colors.danger }]}>
      <Ionicons name={pay ? 'wallet' : 'close-circle'} size={56} color="#fff" />
      <Text style={styles.resultTitle}>BARIE CHƯA MỞ{gate ? ` • ${gateLabel(gate).toUpperCase()}` : ''}</Text>
      <Text style={styles.resultBig}>{title}</Text>
      {pay ? <Text style={styles.resultFee}>{formatVND(details.fee)}</Text> : null}
      {details.lot?.name ? <Text style={styles.resultSub}>{details.lot.name}</Text> : null}
      {r ? <Text style={styles.resultSub}>{r.code} • ô #{r.slotNumber}</Text> : null}
      <Text style={styles.resultHelp}>{help}</Text>
      <View style={styles.resultActions}>
        {pay && details.sessionId ? (
          <Pressable onPress={() => onPay(details.sessionId)} style={styles.resultBtn}>
            <Text style={styles.resultBtnText}>Thanh toán ngay</Text>
          </Pressable>
        ) : null}
        {['no_reservation', 'reservation_expired', 'reservation_not_active'].includes(code) && details.lot?.id ? (
          <Pressable onPress={() => onBook(details.lot.id)} style={styles.resultBtn}>
            <Text style={styles.resultBtnText}>Đặt chỗ ở bãi này</Text>
          </Pressable>
        ) : null}
        {RETRYABLE.includes(code) && code !== 'qr_expired' ? (
          <Pressable onPress={onRetry} style={styles.resultBtn}><Text style={styles.resultBtnText}>Thử lại</Text></Pressable>
        ) : null}
        <Pressable onPress={onAgain} style={[styles.resultBtn, styles.resultBtnGhost]}>
          <Text style={[styles.resultBtnText, { color: '#fff' }]}>Quét lại</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  muted: { fontSize: 13, color: colors.textMuted },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },

  vehRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  vehPlate: { fontSize: 15, fontWeight: '900', color: colors.text, letterSpacing: 0.5 },
  chips: { gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  chipTextOn: { color: colors.primary },

  viewport: { height: 380, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  frame: { width: 220, height: 220, borderRadius: 18, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  camHint: { position: 'absolute', bottom: 18, left: 16, right: 16, textAlign: 'center', color: '#fff', fontSize: 13.5, fontWeight: '700', backgroundColor: 'rgba(15,23,42,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, overflow: 'hidden' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center' },
  permBox: { alignItems: 'center', gap: 12, padding: 24, alignSelf: 'stretch' },
  permText: { color: '#E2E8F0', fontSize: 14, textAlign: 'center' },

  steps: { gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 12, fontWeight: '900', color: colors.primary },
  stepText: { flex: 1, fontSize: 13, color: colors.textMuted },

  result: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 4 },
  resultTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1.2, marginTop: 6, textAlign: 'center' },
  resultBig: { color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'center' },
  resultFee: { color: '#fff', fontSize: 30, fontWeight: '900' },
  resultSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13, textAlign: 'center' },
  resultHelp: { color: '#fff', fontSize: 12.5, textAlign: 'center', marginTop: 8, backgroundColor: 'rgba(0,0,0,0.15)', padding: 8, borderRadius: radius.sm, overflow: 'hidden' },
  resultActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  resultBtn: { backgroundColor: '#fff', paddingHorizontal: 16, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', minWidth: 110 },
  resultBtnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  resultBtnText: { color: colors.text, fontWeight: '800', fontSize: 13.5 },

  manualRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: '#fff' },
  hintText: { fontSize: 12.5, color: colors.danger, marginTop: 8 },
});
