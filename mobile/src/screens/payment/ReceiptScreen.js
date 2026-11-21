// BIEN NHAN DIEN TU: so bien nhan, thong tin gui xe, cac khoan phi, phuong thuc + ma giao dich.
// Chia se (lien ket bien nhan co chu ky - nguoi nhan mo duoc khong can dang nhap) / mo ban in (PDF tu trinh duyet).
// params: { paymentId }
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import { paymentsApi } from '../../api/payments';
import { colors, radius } from '../../theme';
import { formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { formatElapsed } from '../../utils/session';

export default function ReceiptScreen({ navigation, route }) {
  const { paymentId } = route.params || {};
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setP(await paymentsApi.receipt(paymentId));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [paymentId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function share() {
    const text = `Biên nhận gửi xe SmartPark ${p.receiptNo}\n${p.lotName} • Ô #${p.slotNumber}\n`
      + `Số tiền: ${formatVND(p.amount)} (${p.methodLabel})\nThời gian: ${formatDateTime(p.createdAt)}`
      + (p.receiptUrl ? `\nXem biên nhận: ${p.receiptUrl}` : '');
    try {
      if (Platform.OS === 'web' && globalThis.navigator?.clipboard) {
        await globalThis.navigator.clipboard.writeText(text);
        setError(null);
        return;
      }
      await Share.share({ message: text, title: `Biên nhận ${p.receiptNo}` });
    } catch {
      // nguoi dung huy chia se
    }
  }

  function openPrintable() {
    if (!p.receiptUrl) return;
    if (Platform.OS === 'web') globalThis.open?.(p.receiptUrl, '_blank');
    else WebBrowser.openBrowserAsync(p.receiptUrl).catch(() => Linking.openURL(p.receiptUrl));
  }

  const b = p?.breakdown || {};
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.web}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Biên nhận điện tử</Text>
        </View>
        {!p ? (
          <View style={styles.center}>{error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : <ActivityIndicator color={colors.primary} />}</View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.receipt}>
              <View style={styles.brand}>
                <Ionicons name="car-sport" size={18} color={colors.primary} />
                <Text style={styles.brandText}>SmartPark</Text>
              </View>
              <Text style={styles.no}>Số {p.receiptNo}</Text>
              <View style={styles.stamp}><Text style={styles.stampText}>ĐÃ THANH TOÁN</Text></View>
              <Text style={styles.amount}>{formatVND(p.amount)}</Text>
              <Text style={styles.when}>{formatDateTime(p.createdAt)}</Text>

              <View style={styles.dash} />
              <Row label="Bãi đỗ" value={p.lotName} />
              <Row label="Khu / Ô" value={`${b.zone || p.zone || '—'} / #${p.slotNumber}`} />
              <Row label="Biển số" value={p.vehiclePlate || '—'} />
              {b.reservationCode ? <Row label="Mã đặt chỗ" value={b.reservationCode} /> : null}
              <Row label="Vào bãi" value={formatDateTime(b.startedAt || p.startedAt)} />
              <Row label="Rời ô (chốt phí)" value={formatDateTime(b.endedAt || p.endedAt)} />
              <Row label="Thời gian gửi" value={formatElapsed(b.durationSeconds ?? p.durationSeconds ?? 0)} />

              <View style={styles.dash} />
              {(b.lines || [{ label: 'Phí gửi xe', amount: p.amount }]).map((l) => (
                <Row key={l.label} label={l.label} value={formatVND(l.amount)} />
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tổng cộng</Text>
                <Text style={styles.total}>{formatVND(p.amount)}</Text>
              </View>

              <View style={styles.dash} />
              <Row label="Phương thức" value={p.methodLabel} />
              <Row label="Cổng thanh toán" value={p.providerLabel} />
              {p.gatewayTransId ? <Row label="Mã giao dịch MoMo" value={p.gatewayTransId} mono /> : null}
              {p.orderId ? <Row label="Mã đơn" value={p.orderId} mono /> : null}
              <Row label="Mã GD SmartPark" value={p.code} mono />
              {p.collectorName ? <Row label="Thu ngân" value={p.collectorName} /> : null}
              {p.provider === 'momo' ? (
                <Text style={styles.note}>Giao dịch trên môi trường thử nghiệm của MoMo – không trừ tiền thật.</Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button title={Platform.OS === 'web' ? 'Sao chép để chia sẻ' : 'Chia sẻ'} variant="outline" onPress={share} style={{ flex: 1 }} />
              <Button title="Mở bản in / PDF" onPress={openPrintable} disabled={!p.receiptUrl} style={{ flex: 1 }} />
            </View>
            <Pressable onPress={() => navigation.navigate('SessionDetail', { id: p.sessionId })} style={styles.link}>
              <Text style={styles.linkText}>Xem phiên gửi xe</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, mono }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  web: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: '100vh' } : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F1F5F9', flexGrow: 1 },
  receipt: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: '#E2E8F0' },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  brandText: { fontSize: 16, fontWeight: '900', color: colors.navy },
  no: { textAlign: 'center', fontSize: 12.5, color: colors.textMuted, marginTop: 4 },
  stamp: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.success },
  stampText: { fontSize: 11, fontWeight: '900', color: colors.success, letterSpacing: 1.5 },
  amount: { textAlign: 'center', fontSize: 32, fontWeight: '900', color: colors.text, marginTop: 8 },
  when: { textAlign: 'center', fontSize: 12.5, color: colors.textMuted },
  dash: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 13.5, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12.5 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  totalLabel: { fontSize: 14.5, fontWeight: '900', color: colors.text },
  total: { fontSize: 20, fontWeight: '900', color: colors.primary },
  note: { fontSize: 11.5, color: '#92400E', textAlign: 'center', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  link: { alignItems: 'center', paddingVertical: 14 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 13.5 },
});
