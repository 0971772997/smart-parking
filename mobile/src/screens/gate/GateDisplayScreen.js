// MA QR CUA CONG (admin / nhan vien): mo tren may tinh bang / man hinh dat tai cong vao hoac ra.
// Tai xe dung app quet ma nay -> barie tu mo, nhan vien khong phai quet tung xe.
// - Ma tu doi moi 60 giay (anh chup ma cu khong dung de mo cong tu xa duoc).
// - Nhat ky luot quet cua cong cap nhat lien tuc; xe chua tra phi -> "Da thu tien mat" roi tai xe quet lai.
// - Che do toan man hinh: an moi nut, chi con ma QR + ket qua luot quet gan nhat.
// params: { lotId?, gate? }
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { lotsApi } from '../../api/lots';
import { gatesApi, paymentsApi } from '../../api/gates';
import { colors, radius } from '../../theme';
import { formatCountdown, formatDateTime } from '../../utils/booking';
import { driverError } from '../../utils/gate';
import { vehicleType } from '../../utils/vehicles';

const GATES = [
  { key: 'entry', label: 'Cổng VÀO', icon: 'enter-outline', color: colors.primary },
  { key: 'exit', label: 'Cổng RA', icon: 'exit-outline', color: '#7C3AED' },
];
const LOG_POLL_MS = 3000;
const FLASH_MS = 6000;

export default function GateDisplayScreen({ navigation, route }) {
  const { width } = useWindowDimensions();
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState(route.params?.lotId || null);
  const [gate, setGate] = useState(route.params?.gate || 'entry');
  const [pass, setPass] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState([]);
  const [flash, setFlash] = useState(null); // luot quet moi nhat (hien to vai giay)
  const [kiosk, setKiosk] = useState(false);
  const [collecting, setCollecting] = useState(null);
  const [notice, setNotice] = useState(null);
  const busy = useRef(false);
  const lastSeen = useRef(null);
  const flashTimer = useRef(null);

  useEffect(() => {
    lotsApi.list().then((l) => {
      setLots(l);
      setLotId((cur) => cur || (l.find((x) => x.online) || l[0])?.id || null);
    }).catch((e) => setError(e.message));
    return () => clearTimeout(flashTimer.current);
  }, []);

  const fetchPass = useCallback(async () => {
    if (!lotId || busy.current) return;
    busy.current = true;
    try {
      const p = await gatesApi.display(lotId, gate);
      setPass({ ...p, localExpiry: Date.now() + p.ttlSeconds * 1000 });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      busy.current = false;
    }
  }, [lotId, gate]);

  // Doi bai / cong -> xin ma moi, bat dau lai nhat ky
  useEffect(() => {
    lastSeen.current = null;
    const t = setTimeout(() => { setPass(null); setLog([]); setFlash(null); fetchPass(); }, 0);
    return () => clearTimeout(t);
  }, [fetchPass]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = pass ? Math.max(0, Math.floor((pass.localExpiry - now) / 1000)) : 0;
  useEffect(() => {
    if (!pass || left > (pass.refreshBeforeSeconds ?? 10)) return undefined;
    const t = setTimeout(fetchPass, 0);
    return () => clearTimeout(t);
  }, [pass, left, fetchPass]);

  // Nhat ky luot quet cua cong nay; luot moi -> hien to tren man hinh
  const loadLog = useCallback(async () => {
    if (!lotId) return;
    try {
      const rows = await gatesApi.scans(lotId, 15, { gate });
      setLog(rows);
      const top = rows[0];
      if (top && lastSeen.current !== null && top.id !== lastSeen.current && top.result !== 'pending') {
        setFlash(top);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      }
      if (top && (top.result !== 'pending' || lastSeen.current === null)) lastSeen.current = top.id;
      if (!top) lastSeen.current = 0;
    } catch { /* giu nhat ky cu khi mang chap chon */ }
  }, [lotId, gate]);
  useEffect(() => {
    const t0 = setTimeout(loadLog, 0);
    const t = setInterval(loadLog, LOG_POLL_MS);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [loadLog]);

  async function collect(scan) {
    setCollecting(scan.id);
    setNotice(null);
    try {
      await paymentsApi.collect(lotId, scan.sessionId, 'cash');
      setNotice({ type: 'success', text: `Đã ghi nhận thu tiền mặt ${scan.vehiclePlate || scan.reservationCode || ''}. Mời tài xế quét lại mã.` });
    } catch (e) {
      setNotice(e.code === 'already_paid'
        ? { type: 'info', text: 'Lượt này đã được thanh toán. Mời tài xế quét lại mã.' }
        : { type: 'error', text: e.message });
    } finally {
      setCollecting(null);
    }
  }

  const lot = lots.find((l) => l.id === lotId);
  const g = GATES.find((x) => x.key === gate);
  const qrSize = Math.max(180, Math.min(width - (kiosk ? 48 : 96), kiosk ? 420 : 300));
  const offline = pass ? !pass.online : lot ? !lot.online : false;

  const qrCard = (
    <View style={[styles.qrCard, kiosk && styles.qrCardKiosk]}>
      <View style={[styles.gateBadge, { backgroundColor: g.color }]}>
        <Ionicons name={g.icon} size={18} color="#fff" />
        <Text style={styles.gateBadgeText}>{g.label.toUpperCase()}</Text>
      </View>
      <Text style={styles.lotName} numberOfLines={1}>{pass?.lotName || lot?.name || '—'}</Text>
      <View style={styles.qrBox} accessibilityLabel={`Mã QR ${g.label}`}>
        {pass ? <QRCode value={pass.token} size={qrSize} ecl="M" color={colors.navy} backgroundColor="#FFFFFF" />
          : <View style={{ width: qrSize, height: qrSize, alignItems: 'center', justifyContent: 'center' }}>
            {error ? <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} /> : <ActivityIndicator color={colors.primary} />}
          </View>}
      </View>
      <Text style={styles.scanHint}>Mở app SmartPark ▸ “Quét mã tại cổng” ▸ quét mã này</Text>
      {pass ? (
        <Text style={styles.timer}>
          <Ionicons name="shield-checkmark-outline" size={12} color={colors.textMuted} /> Mã tự đổi sau{' '}
          <Text style={styles.timerStrong}>{formatCountdown(left)}</Text>
        </Text>
      ) : null}
      {offline ? <Text style={styles.offline}>Thiết bị barie đang offline – tài xế quét sẽ chưa mở được cổng</Text> : null}
      {flash ? <FlashBanner scan={flash} /> : null}
    </View>
  );

  if (kiosk) {
    return (
      <View style={styles.kioskWrap}>
        <Pressable onPress={() => setKiosk(false)} style={styles.kioskExit} accessibilityLabel="Thoát toàn màn hình" hitSlop={10}>
          <Ionicons name="contract-outline" size={20} color={colors.textMuted} />
        </Pressable>
        {qrCard}
      </View>
    );
  }

  return (
    <ScreenShell
      navigation={navigation}
      title="Mã QR tại cổng"
      subtitle={lot ? `${lot.name}${lot.online ? '' : ' • thiết bị offline'}` : 'Chọn bãi đỗ'}
      right={(
        <Pressable onPress={() => setKiosk(true)} style={styles.iconBtn} accessibilityLabel="Toàn màn hình" hitSlop={8}>
          <Ionicons name="expand-outline" size={18} color={colors.text} />
        </Pressable>
      )}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {lots.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {lots.map((l) => (
              <Pressable key={l.id} onPress={() => setLotId(l.id)} style={[styles.chip, l.id === lotId && styles.chipOn]}>
                <View style={[styles.dot, { backgroundColor: l.online ? colors.accent : '#94A3B8' }]} />
                <Text style={[styles.chipText, l.id === lotId && styles.chipTextOn]} numberOfLines={1}>{l.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        <View style={styles.gateRow}>
          {GATES.map((x) => (
            <Pressable key={x.key} onPress={() => setGate(x.key)} accessibilityState={{ selected: gate === x.key }}
              style={[styles.gateBtn, gate === x.key && styles.gateBtnOn]}>
              <Ionicons name={x.icon} size={18} color={gate === x.key ? '#fff' : colors.textMuted} />
              <Text style={[styles.gateBtnText, gate === x.key && { color: '#fff' }]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Notice type="error" actionLabel="Thử lại" onAction={fetchPass}>{error}</Notice> : null}
        {qrCard}
        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}

        <View style={styles.card}>
          <View style={styles.logHead}>
            <Text style={styles.cardTitle}>Lượt quét {g.label.toLowerCase()}</Text>
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
                  {s.vehiclePlate || s.reservationCode || 'Không rõ xe'}
                  {s.vehicleType ? ` • ${vehicleType(s.vehicleType).label}` : ''}
                  {s.slotNumber ? ` • ô #${s.slotNumber}` : ''}
                </Text>
                {s.result === 'denied' ? <Text style={styles.logErr} numberOfLines={1}>{driverError(s.error).title}</Text> : null}
              </View>
              {s.result === 'denied' && s.error === 'payment_required' && s.sessionId
                && !log.some((x) => x.id > s.id && x.reservationId === s.reservationId && x.result === 'granted') ? (
                <Pressable onPress={() => collect(s)} disabled={collecting === s.id} style={styles.cashBtn}>
                  {collecting === s.id ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.cashBtnText}>Đã thu tiền mặt</Text>}
                </Pressable>
              ) : <Text style={styles.logTime}>{formatDateTime(s.createdAt)}</Text>}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

function FlashBanner({ scan }) {
  const ok = scan.result === 'granted';
  return (
    <View style={[styles.flash, { backgroundColor: ok ? colors.success : colors.danger }]} accessibilityLiveRegion="polite">
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={22} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={styles.flashTitle}>
          {ok ? (scan.gate === 'entry' ? 'Mời xe vào' : 'Hẹn gặp lại!') : driverError(scan.error).title}
        </Text>
        <Text style={styles.flashSub} numberOfLines={1}>
          {scan.vehiclePlate || scan.reservationCode || ''}{ok && scan.gate === 'entry' && scan.slotNumber ? ` • ô #${scan.slotNumber}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  muted: { fontSize: 13, color: colors.textMuted },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },

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

  qrCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', gap: 8 },
  qrCardKiosk: { borderWidth: 0, marginBottom: 0, width: '100%', maxWidth: 560 },
  gateBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill },
  gateBadgeText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1.5 },
  lotName: { fontSize: 18, fontWeight: '900', color: colors.text },
  qrBox: { padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0' },
  scanHint: { fontSize: 13.5, color: colors.text, fontWeight: '700', textAlign: 'center' },
  timer: { fontSize: 12, color: colors.textMuted },
  timerStrong: { fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  offline: { fontSize: 12.5, color: colors.danger, fontWeight: '700', textAlign: 'center' },

  flash: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', padding: 12, borderRadius: radius.md, marginTop: 4 },
  flashTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  flashSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13 },

  kioskWrap: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 16 },
  kioskExit: { position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', zIndex: 2 },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  logMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  logErr: { fontSize: 12, color: colors.danger, marginTop: 1 },
  logTime: { fontSize: 11.5, color: colors.textMuted },
  cashBtn: { backgroundColor: '#B45309', paddingHorizontal: 10, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', minWidth: 110 },
  cashBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
