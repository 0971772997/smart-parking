// LICH SU GIAO DICH: tong chi tieu, loc theo thang, moi giao dich -> bien nhan dien tu
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Notice from '../../components/Notice';
import OfflineBanner from '../../components/OfflineBanner';
import { paymentsApi } from '../../api/payments';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';

const METHOD_ICON = { momo: ['wallet', '#A50064'], atm: ['card', '#0E7490'], card: ['card-outline', '#1D4ED8'], cash: ['cash', colors.success] };
const monthKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (k) => { const [y, m] = k.split('-'); return `Tháng ${Number(m)}/${y}`; };

export default function TransactionsScreen({ navigation }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await paymentsApi.list(200));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load);

  const months = useMemo(() => [...new Set((items || []).map((p) => monthKey(p.createdAt)))], [items]);
  const shown = useMemo(() => (items || []).filter((p) => month === 'all' || monthKey(p.createdAt) === month), [items, month]);
  const total = shown.reduce((a, p) => a + (p.amount || 0), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.web}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Lịch sử giao dịch</Text>
        </View>
        <OfflineBanner />
        {items === null && !error ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(p) => String(p.id)}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListHeaderComponent={(
              <>
                {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
                <View style={styles.summary}>
                  <Text style={styles.sumLabel}>{month === 'all' ? 'Tổng đã thanh toán' : `Tổng ${monthLabel(month).toLowerCase()}`}</Text>
                  <Text style={styles.sum}>{formatVND(total)}</Text>
                  <Text style={styles.sumSub}>{shown.length} giao dịch</Text>
                </View>
                {months.length > 1 ? (
                  <View style={styles.chips}>
                    {['all', ...months].map((k) => (
                      <Pressable key={k} onPress={() => setMonth(k)} style={[styles.chip, month === k && styles.chipOn]}>
                        <Text style={[styles.chipText, month === k && styles.chipTextOn]}>{k === 'all' ? 'Tất cả' : monthLabel(k)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </>
            )}
            ListEmptyComponent={!error ? (
              <View style={styles.empty}>
                <Ionicons name="receipt-outline" size={40} color="#CBD5E1" />
                <Text style={styles.emptyText}>Chưa có giao dịch nào.</Text>
              </View>
            ) : null}
            renderItem={({ item: p }) => {
              const [icon, color] = METHOD_ICON[p.method] || ['cash-outline', colors.textMuted];
              return (
                <Pressable onPress={() => navigation.navigate('Receipt', { paymentId: p.id })}
                  style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                  <View style={[styles.icon, { backgroundColor: `${color}14` }]}><Ionicons name={icon} size={18} color={color} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{p.lotName} • Ô #{p.slotNumber}</Text>
                    <Text style={styles.sub}>{p.methodLabel} • {formatDateTime(p.createdAt)}</Text>
                    <Text style={styles.no}>{p.receiptNo}</Text>
                  </View>
                  <Text style={styles.amount}>{formatVND(p.amount)}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  summary: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  sumLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '700' },
  sum: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 2 },
  sumSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.primary },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  no: { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  amount: { fontSize: 14.5, fontWeight: '900', color: colors.text },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
});
