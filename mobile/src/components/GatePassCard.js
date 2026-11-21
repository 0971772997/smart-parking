// THE MA QR QUA CONG (tai xe): hien ma de nhan vien quet tai cong VAO / RA.
// - Ma ngan han (mac dinh 120s), tu xin ma moi truoc khi het han -> anh chup man hinh cu khong dung lai duoc.
// - Cong ra: bao truoc neu xe chua roi o / chua thanh toan, cho thanh toan ngay trong the.
// props: { resv, onChanged } - onChanged(): yeu cau man cha tai lai dat cho (sau thanh toan / khi ma bao loi)
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import Button from './Button';
import Notice from './Notice';
import { reservationsApi } from '../api/reservations';
import { paymentsApi } from '../api/gates';
import { colors, radius } from '../theme';
import { formatCountdown } from '../utils/booking';
import { formatVND } from '../utils/schedules';

const GATE = {
  entry: { label: 'CỔNG VÀO', icon: 'enter-outline', color: colors.primary, bg: colors.primarySoft,
    hint: 'Đưa mã này cho nhân viên quét tại cổng vào. Barie sẽ tự mở.' },
  exit: { label: 'CỔNG RA', icon: 'exit-outline', color: '#7C3AED', bg: '#F3E8FF',
    hint: 'Khi ra bãi, đưa mã này cho nhân viên quét tại cổng ra.' },
};

const PAY_METHODS = [
  { key: 'momo', label: 'MoMo' },
  { key: 'zalopay', label: 'ZaloPay' },
  { key: 'card', label: 'Thẻ' },
  { key: 'bank', label: 'Chuyển khoản' },
];

const BLOCK_POLL_MS = 10000;

export default function GatePassCard({ resv, onChanged }) {
  const [pass, setPass] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [method, setMethod] = useState('momo');
  const [paying, setPaying] = useState(false);
  const [paidMsg, setPaidMsg] = useState(null);
  const busy = useRef(false);

  const fetchPass = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const p = await reservationsApi.pass(resv.id);
      // Tinh het han theo dong ho may (tranh lech gio giua dien thoai va may chu)
      setPass({ ...p, localExpiry: Date.now() + p.ttlSeconds * 1000 });
      setError(null);
    } catch (e) {
      setPass(null);
      setError(e.message);
      // Dat cho doi trang thai (vd vua ra bai) -> man cha tai lai
      if (e.status === 409) onChanged?.();
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [resv.id, onChanged]);

  // Doi cong (vao -> ra) hoac dat cho cap nhat -> xin ma moi
  // (goi qua hen gio 0ms: khong setState dong bo trong effect)
  useEffect(() => {
    const t = setTimeout(fetchPass, 0);
    return () => clearTimeout(t);
  }, [fetchPass, resv.nextGate, resv.enteredAt]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = pass ? Math.max(0, Math.floor((pass.localExpiry - now) / 1000)) : 0;
  const refreshAt = pass?.refreshBeforeSeconds ?? 20;
  useEffect(() => {
    if (!pass || left > refreshAt) return undefined;
    const t = setTimeout(fetchPass, 0);
    return () => clearTimeout(t);
  }, [pass, left, refreshAt, fetchPass]);

  // Dang bi chan o cong ra (xe chua roi o / chua tra phi) -> hoi lai thuong xuyen hon
  useEffect(() => {
    if (!pass?.block) return undefined;
    const t = setInterval(fetchPass, BLOCK_POLL_MS);
    return () => clearInterval(t);
  }, [pass?.block, fetchPass]);

  async function pay() {
    setPaying(true);
    setPaidMsg(null);
    try {
      const p = await paymentsApi.paySession(pass.block.sessionId, method);
      setPaidMsg(`Đã thanh toán ${formatVND(p.amount)} • Mã GD ${p.code}`);
      await fetchPass();
    } catch (e) {
      if (e.code === 'already_paid') await fetchPass();
      else setError(e.message);
    } finally {
      setPaying(false);
    }
  }

  const gate = GATE[pass?.gate || resv.nextGate] || GATE.entry;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.gateBadge, { backgroundColor: gate.bg }]}>
          <Ionicons name={gate.icon} size={15} color={gate.color} />
          <Text style={[styles.gateText, { color: gate.color }]}>MÃ QR {gate.label}</Text>
        </View>
        <Pressable onPress={fetchPass} hitSlop={8} accessibilityLabel="Làm mới mã QR" disabled={loading}>
          {loading ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="refresh" size={18} color={colors.textMuted} />}
        </Pressable>
      </View>

      {error && !pass ? (
        <Notice type="error" actionLabel="Thử lại" onAction={fetchPass}>{error}</Notice>
      ) : (
        <>
          <View style={styles.qrBox} accessibilityLabel={`Mã QR ${gate.label.toLowerCase()}`}>
            {pass ? (
              <QRCode value={pass.token} size={200} ecl="M" color={colors.navy} backgroundColor="#FFFFFF" />
            ) : (
              <View style={styles.qrPlaceholder}><ActivityIndicator color={colors.primary} /></View>
            )}
          </View>
          <Text style={styles.hint}>{gate.hint}</Text>
          {pass ? (
            <Text style={styles.timer}>
              <Ionicons name="shield-checkmark-outline" size={12} color={colors.textMuted} /> Mã bảo mật tự đổi sau{' '}
              <Text style={styles.timerStrong}>{formatCountdown(left)}</Text>
            </Text>
          ) : null}
        </>
      )}

      {pass?.block?.error === 'still_parked' && (
        <Notice type="info">
          Hệ thống chưa ghi nhận xe rời ô #{resv.slotNumber}. Hãy lái xe ra khỏi ô trước, phí sẽ được tính khi xe rời ô.
        </Notice>
      )}

      {pass?.block?.error === 'payment_required' && (
        <View style={styles.payBox}>
          <View style={styles.payHead}>
            <Ionicons name="wallet-outline" size={18} color={colors.danger} />
            <Text style={styles.payTitle}>Chưa thanh toán phí gửi xe</Text>
            <Text style={styles.payFee}>{formatVND(pass.block.fee)}</Text>
          </View>
          <Text style={styles.payHint}>Thanh toán trước để barie cổng ra tự mở khi quét mã (hoặc trả tiền mặt cho nhân viên).</Text>
          <View style={styles.methods}>
            {PAY_METHODS.map((m) => (
              <Pressable key={m.key} onPress={() => setMethod(m.key)}
                style={[styles.method, method === m.key && styles.methodOn]} accessibilityState={{ selected: method === m.key }}>
                <Text style={[styles.methodText, method === m.key && styles.methodTextOn]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={`Thanh toán ${formatVND(pass.block.fee)}`} onPress={pay} loading={paying} />
        </View>
      )}

      {paidMsg ? <Notice type="success">{paidMsg}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  gateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  gateText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  qrBox: { alignSelf: 'center', padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0' },
  qrPlaceholder: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center', marginTop: 10 },
  timer: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  timerStrong: { fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },

  payBox: { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft, gap: 10 },
  payHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payTitle: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.danger },
  payFee: { fontSize: 16, fontWeight: '900', color: colors.danger },
  payHint: { fontSize: 12, color: '#7F1D1D' },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  method: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#fff' },
  methodOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  methodTextOn: { color: colors.primary },
});
