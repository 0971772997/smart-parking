// THE QUA CONG (tai xe): huong dan quet ma QR o cong VAO / RA + nut mo man quet ma (GateCheckin).
// - Cong ra: bao truoc neu xe chua roi o / chua thanh toan -> nut sang man Thanh toan (tien mat / chuyen khoan / MoMo, nhan vien xac nhan).
// props: { resv, onChanged } - onChanged(): yeu cau man cha tai lai dat cho (khi dat cho doi trang thai)
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from './Button';
import Notice from './Notice';
import { reservationsApi } from '../api/reservations';
import { navigate } from '../navigation/ref';
import { colors, radius } from '../theme';
import { formatVND } from '../utils/schedules';

const GATE = {
  entry: { label: 'CỔNG VÀO', icon: 'enter-outline', color: colors.primary, bg: colors.primarySoft,
    hint: 'Đến cổng vào, quét mã QR trên màn hình tại cổng. Barie sẽ tự mở.' },
  exit: { label: 'CỔNG RA', icon: 'exit-outline', color: '#7C3AED', bg: '#F3E8FF',
    hint: 'Khi ra bãi, quét mã QR trên màn hình tại cổng ra.' },
};

const BLOCK_POLL_MS = 10000;

export default function GateCheckinCard({ resv, onChanged }) {
  const [block, setBlock] = useState(null);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const gateKey = resv.nextGate || 'entry';
  const gate = GATE[gateKey] || GATE.entry;

  // Cong ra: hoi may chu xe da roi o / da tra phi chua (de bao truoc khi den cong)
  const check = useCallback(async () => {
    if (busy.current || gateKey !== 'exit') return;
    busy.current = true;
    try {
      const p = await reservationsApi.pass(resv.id);
      setBlock(p.block || null);
      setError(null);
    } catch (e) {
      setError(e.message);
      if (e.status === 409) onChanged?.(); // dat cho vua doi trang thai (vd da ra bai)
    } finally {
      busy.current = false;
    }
  }, [resv.id, gateKey, onChanged]);

  useEffect(() => {
    const t0 = setTimeout(check, 0);
    if (gateKey !== 'exit') return () => clearTimeout(t0);
    const t = setInterval(check, BLOCK_POLL_MS);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [check, gateKey, resv.enteredAt]);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.gateBadge, { backgroundColor: gate.bg }]}>
          <Ionicons name={gate.icon} size={15} color={gate.color} />
          <Text style={[styles.gateText, { color: gate.color }]}>{gate.label}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: gate.bg }]}>
          <Ionicons name="qr-code-outline" size={34} color={gate.color} />
        </View>
        <Text style={styles.hint}>{gate.hint}</Text>
      </View>

      <Button title={`Quét mã QR ${gateKey === 'exit' ? 'cổng ra' : 'cổng vào'}`}
        onPress={() => navigate('GateCheckin', { reservationId: resv.id })} />

      {error ? <Notice type="error">{error}</Notice> : null}

      {block?.error === 'still_parked' && (
        <Notice type="info">
          Hệ thống chưa ghi nhận xe rời ô #{resv.slotNumber}. Hãy lái xe ra khỏi ô trước, phí sẽ được tính khi xe rời ô.
        </Notice>
      )}

      {block?.error === 'payment_required' && (
        <View style={styles.payBox}>
          <View style={styles.payHead}>
            <Ionicons name="wallet-outline" size={18} color={colors.danger} />
            <Text style={styles.payTitle}>Chưa thanh toán phí gửi xe</Text>
            <Text style={styles.payFee}>{formatVND(block.fee)}</Text>
          </View>
          <Text style={styles.payHint}>Trả tiền mặt cho nhân viên, chuyển khoản hoặc MoMo. Nhân viên xác nhận đã nhận tiền thì barie cổng ra tự mở.</Text>
          <Button title={`Thanh toán ${formatVND(block.fee)}`}
            onPress={() => navigate('Payment', { sessionId: block.sessionId })} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  gateText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  body: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  hint: { flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 18 },

  payBox: { padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft, gap: 10 },
  payHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payTitle: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.danger },
  payFee: { fontSize: 16, fontWeight: '900', color: colors.danger },
  payHint: { fontSize: 12, color: '#7F1D1D' },
});
