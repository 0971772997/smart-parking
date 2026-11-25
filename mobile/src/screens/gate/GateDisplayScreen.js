// MA QR CUA BAI (admin / nhan vien): mo tren may tinh bang / man hinh dat tai cong.
// 1 MA CHUNG cho ca cong vao va cong ra: tai xe quet -> he thong tu biet xe dang vao hay ra -> mo barie.
// - Ma tu doi moi 60 giay (anh chup ma cu khong dung de mo cong tu xa duoc).
// - THANH TOAN CHO XAC NHAN: tai xe chon tien mat / chuyen khoan / MoMo -> nhan vien kiem tra da nhan tien
//   -> "Da nhan tien - mo cong" (ghi giao dich + mo barie cong ra ngay) hoac "Chua nhan duoc".
// - Nhat ky luot quet cap nhat lien tuc; che do toan man hinh chi con ma QR + ket qua luot quet gan nhat.
// params: { lotId? }
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { lotsApi } from '../../api/lots';
import { gatesApi } from '../../api/gates';
import { paymentsApi } from '../../api/payments';
import { colors, radius } from '../../theme';
import { formatCountdown, formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { driverError } from '../../utils/gate';
import { vehicleType } from '../../utils/vehicles';

const POLL_MS = 3000;
const FLASH_MS = 6000;
const METHOD_ICON = { cash: 'cash-outline', bank: 'business-outline', momo: 'wallet-outline' };

export default function GateDisplayScreen({ navigation, route }) {
  const { width } = useWindowDimensions();
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState(route.params?.lotId || null);
  const [pass, setPass] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState([]);
  const [pending, setPending] = useState([]);
  const [flash, setFlash] = useState(null); // luot quet moi nhat (hien to vai giay)
  const [kiosk, setKiosk] = useState(false);
  const [working, setWorking] = useState(null); // ma don / luot quet dang xu ly
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
      const p = await gatesApi.display(lotId);
      setPass({ ...p, localExpiry: Date.now() + p.ttlSeconds * 1000 });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      busy.current = false;
    }
  }, [lotId]);

  // Doi bai -> xin ma moi, bat dau lai nhat ky
  useEffect(() => {
    lastSeen.current = null;
    const t = setTimeout(() => { setPass(null); setLog([]); setPending([]); setFlash(null); fetchPass(); }, 0);
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

  // Nhat ky luot quet + don cho xac nhan; luot quet moi -> hien to tren man hinh
  const loadLive = useCallback(async () => {
    if (!lotId) return;
    const [rows, pend] = await Promise.all([
      gatesApi.scans(lotId, 15).catch(() => null),
      paymentsApi.pending(lotId).catch(() => null),
    ]);
    if (pend) setPending(pend);
    if (!rows) return;
    setLog(rows);
    const top = rows[0];
    if (top && lastSeen.current !== null && top.id !== lastSeen.current && top.result !== 'pending') {
      setFlash(top);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    }
    if (top && (top.result !== 'pending' || lastSeen.current === null)) lastSeen.current = top.id;
    if (!top) lastSeen.current = 0;
  }, [lotId]);
  useEffect(() => {
    const t0 = setTimeout(loadLive, 0);
    const t = setInterval(loadLive, POLL_MS);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [loadLive]);

  const gateResult = (who, gate) => {
    if (gate?.opened) return { type: 'success', text: `Đã nhận tiền ${who} – barie cổng ra đã mở.` };
    if (gate?.reason === 'skipped') return { type: 'success', text: `Đã xác nhận nhận tiền ${who}.` };
    return { type: 'info', text: `Đã nhận tiền ${who}. Barie chưa mở: ${gate?.message || 'xe chưa ở cổng ra'} – tài xế quét lại mã khi ra.` };
  };

  async function confirm(o, openGate = true) {
    setWorking(o.orderId);
    setNotice(null);
    try {
      const r = await paymentsApi.confirm(o.orderId, openGate);
      setNotice(gateResult(o.vehiclePlate || o.orderId, r.gate));
    } catch (e) {
      setNotice({ type: e.code === 'already_paid' ? 'info' : 'error', text: e.message });
    } finally {
      setWorking(null);
      loadLive();
    }
  }

  async function reject(o) {
    setWorking(o.orderId);
    setNotice(null);
    try {
      await paymentsApi.reject(o.orderId);
      setNotice({ type: 'info', text: `Đã báo tài xế ${o.vehiclePlate || ''} chưa nhận được tiền.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setWorking(null);
      loadLive();
    }
  }

  // Xe bi chan o cong ra vi chua tra, tai xe dua tien mat truc tiep -> thu + mo cong
  async function collect(scan) {
    setWorking(`scan${scan.id}`);
    setNotice(null);
    try {
      const r = await paymentsApi.collect(lotId, scan.sessionId, 'cash', { openGate: true });
      setNotice(gateResult(scan.vehiclePlate || scan.reservationCode || '', r.gate));
    } catch (e) {
      setNotice(e.code === 'already_paid'
        ? { type: 'info', text: 'Lượt này đã được thanh toán. Mời tài xế quét lại mã.' }
        : { type: 'error', text: e.message });
    } finally {
      setWorking(null);
      loadLive();
    }
  }

  const lot = lots.find((l) => l.id === lotId);
  const qrSize = Math.max(180, Math.min(width - (kiosk ? 48 : 96), kiosk ? 420 : 300));
  const offline = pass ? !pass.online : lot ? !lot.online : false;

  const qrCard = (
    <View style={[styles.qrCard, kiosk && styles.qrCardKiosk]}>
      <View style={styles.gateBadge}>
        <Ionicons name="swap-horizontal" size={18} color="#fff" />
        <Text style={styles.gateBadgeText}>QUÉT KHI VÀO & KHI RA</Text>
      </View>
      <Text style={styles.lotName} numberOfLines={1}>{pass?.lotName || lot?.name || '—'}</Text>
      <View style={styles.qrBox} accessibilityLabel="Mã QR của bãi đỗ">
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
      {kiosk && pending.length > 0 ? (
        <Text style={styles.kioskPending}>{pending.length} thanh toán đang chờ xác nhận</Text>
      ) : null}
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

        {error ? <Notice type="error" actionLabel="Thử lại" onAction={fetchPass}>{error}</Notice> : null}
        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}

        {/* THANH TOAN CHO XAC NHAN */}
        {pending.length > 0 ? (
          <View style={[styles.card, styles.pendingCard]}>
            <Text style={styles.cardTitle}>Thanh toán chờ xác nhận ({pending.length})</Text>
            {pending.map((o) => (
              <View key={o.orderId} style={styles.pendRow}>
                <View style={styles.pendHead}>
                  <Ionicons name={METHOD_ICON[o.method] || 'cash-outline'} size={18} color="#B45309" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pendMain} numberOfLines={1}>
                      {o.vehiclePlate || 'Không rõ xe'}{o.vehicleType ? ` • ${vehicleType(o.vehicleType).label}` : ''} • ô #{o.slotNumber}
                    </Text>
                    <Text style={styles.pendSub} numberOfLines={1}>
                      {o.methodLabel}{o.method !== 'cash' ? ` • ND: ${o.content}` : ` • Mã ${o.orderId}`}
                      {o.userName ? ` • ${o.userName}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.pendAmount}>{formatVND(o.amount)}</Text>
                </View>
                <View style={styles.pendActions}>
                  <Pressable onPress={() => confirm(o)} disabled={working === o.orderId} style={[styles.pendBtn, styles.pendOk]}
                    accessibilityLabel={`Đã nhận tiền ${o.vehiclePlate || ''}, mở cổng`}>
                    {working === o.orderId ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.pendOkText}>Đã nhận tiền – mở cổng</Text>}
                  </Pressable>
                  <Pressable onPress={() => reject(o)} disabled={working === o.orderId} style={[styles.pendBtn, styles.pendNo]}>
                    <Text style={styles.pendNoText}>Chưa nhận được</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {qrCard}

        <View style={styles.card}>
          <View style={styles.logHead}>
            <Text style={styles.cardTitle}>Lượt quét gần đây</Text>
            <Pressable onPress={loadLive} hitSlop={8}><Ionicons name="refresh" size={16} color={colors.textMuted} /></Pressable>
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
                  <Text style={styles.logGate}>{s.gate === 'exit' ? 'RA' : 'VÀO'}</Text>
                  {' • '}{s.vehiclePlate || s.reservationCode || 'Không rõ xe'}
                  {s.vehicleType ? ` • ${vehicleType(s.vehicleType).label}` : ''}
                  {s.slotNumber ? ` • ô #${s.slotNumber}` : ''}
                </Text>
                {s.result === 'denied' ? <Text style={styles.logErr} numberOfLines={1}>{driverError(s.error).title}</Text> : null}
              </View>
              {s.result === 'denied' && s.error === 'payment_required' && s.sessionId
                && !log.some((x) => x.id > s.id && x.reservationId === s.reservationId && x.result === 'granted')
                && !pending.some((o) => o.sessionId === s.sessionId) ? (
                  <Pressable onPress={() => collect(s)} disabled={working === `scan${s.id}`} style={styles.cashBtn}>
                    {working === `scan${s.id}` ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.cashBtnText}>Thu tiền mặt & mở</Text>}
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
          {scan.gate === 'exit' ? 'Cổng RA' : 'Cổng VÀO'} • {scan.vehiclePlate || scan.reservationCode || ''}
          {ok && scan.gate === 'entry' && scan.slotNumber ? ` • ô #${scan.slotNumber}` : ''}
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

  qrCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', gap: 8 },
  qrCardKiosk: { borderWidth: 0, marginBottom: 0, width: '100%', maxWidth: 560 },
  gateBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.navy },
  gateBadgeText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  lotName: { fontSize: 18, fontWeight: '900', color: colors.text },
  qrBox: { padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0' },
  scanHint: { fontSize: 13.5, color: colors.text, fontWeight: '700', textAlign: 'center' },
  timer: { fontSize: 12, color: colors.textMuted },
  timerStrong: { fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  offline: { fontSize: 12.5, color: colors.danger, fontWeight: '700', textAlign: 'center' },
  kioskPending: { fontSize: 13, fontWeight: '800', color: '#B45309' },

  flash: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', padding: 12, borderRadius: radius.md, marginTop: 4 },
  flashTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  flashSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13 },

  kioskWrap: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 16 },
  kioskExit: { position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', zIndex: 2 },

  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  pendingCard: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
  pendRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#FDE68A', gap: 8 },
  pendHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendMain: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  pendSub: { fontSize: 12, color: '#92400E', marginTop: 1 },
  pendAmount: { fontSize: 15, fontWeight: '900', color: '#B45309' },
  pendActions: { flexDirection: 'row', gap: 8 },
  pendBtn: { height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  pendOk: { flex: 1, backgroundColor: colors.success },
  pendOkText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  pendNo: { borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  pendNoText: { color: colors.textMuted, fontWeight: '800', fontSize: 13 },

  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  logMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  logGate: { fontWeight: '900', color: colors.primary },
  logErr: { fontSize: 12, color: colors.danger, marginTop: 1 },
  logTime: { fontSize: 11.5, color: colors.textMuted },
  cashBtn: { backgroundColor: '#B45309', paddingHorizontal: 10, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', minWidth: 120 },
  cashBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
