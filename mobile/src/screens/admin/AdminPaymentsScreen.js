// QUAN TRI - DOANH THU & GIAO DICH: khoang ngay, loc phuong thuc, tong tien + co cau theo phuong thuc, xem bien nhan
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import DateRangeModal from '../../components/DateRangeModal';
import { Card, Chips, Empty, SearchBar, listStyles as L, usePagedList } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { useDebounced } from '../../hooks/useDebounced';
import { colors, radius } from '../../theme';
import { formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { PRESETS, presetRange, ymdLabel } from '../../utils/dates';

const METHODS = [
  { key: '', label: 'Mọi phương thức' }, { key: 'momo', label: 'Ví MoMo' }, { key: 'atm', label: 'Thẻ ATM' },
  { key: 'card', label: 'Visa/Master' }, { key: 'cash', label: 'Tiền mặt' },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));

export default function AdminPaymentsScreen({ navigation }) {
  const [preset, setPreset] = useState('30d');
  const [range, setRange] = useState(() => presetRange('30d'));
  const [picker, setPicker] = useState(false);
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const query = useDebounced(q, 350);
  const list = usePagedList(({ limit, offset }) => adminApi.payments({ ...range, method, q: query, limit, offset }), [range, method, query]);
  const sum = list.extra?.summary;

  return (
    <ScreenShell navigation={navigation} title="Doanh thu & giao dịch" subtitle={`${ymdLabel(range.from)} – ${ymdLabel(range.to)}`}>
      {list.loading ? <View style={L.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={list.items || []}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={L.content}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.refreshing} tintColor={colors.primary} onRefresh={list.refresh} />}
          ListHeaderComponent={(
            <>
              <Chips options={[...PRESETS, { key: 'custom', label: preset === 'custom' ? `${ymdLabel(range.from, true)}–${ymdLabel(range.to, true)}` : 'Tuỳ chọn', icon: 'calendar-outline' }]}
                value={preset} onChange={(k) => { if (k === 'custom') setPicker(true); else { setPreset(k); setRange(presetRange(k)); } }} />
              <Chips options={METHODS} value={method} onChange={setMethod} />
              <SearchBar value={q} onChange={setQ} placeholder="Số biên nhận, mã GD, email, biển số..." />
              {list.error ? <Notice type="error" actionLabel="Thử lại" onAction={list.reload}>{list.error}</Notice> : null}
              {sum ? (
                <View style={styles.summary}>
                  <Text style={styles.sumLabel}>Tổng doanh thu{method ? ` (${METHOD_LABEL[method]})` : ''}</Text>
                  <Text style={styles.sum}>{formatVND(sum.amount)}</Text>
                  <Text style={styles.sumLabel}>{sum.count} giao dịch</Text>
                  {sum.byMethod.length > 1 ? (
                    <View style={styles.methods}>
                      {sum.byMethod.map((m) => (
                        <View key={m.method} style={styles.method}>
                          <Text style={styles.mName}>{METHOD_LABEL[m.method] || m.method}</Text>
                          <View style={styles.mBar}><View style={[styles.mFill, { width: `${sum.amount ? (m.total / sum.amount) * 100 : 0}%` }]} /></View>
                          <Text style={styles.mVal}>{formatVND(m.total)} • {m.count}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
          ListEmptyComponent={!list.error ? <Empty icon="receipt-outline" text="Không có giao dịch trong khoảng này." /> : null}
          ListFooterComponent={list.more ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item: p }) => (
            <Card onPress={() => navigation.navigate('Receipt', { paymentId: p.id })} style={styles.item}>
              <Ionicons name={p.method === 'cash' ? 'cash' : 'card'} size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={L.title} numberOfLines={1}>{p.lotName} • Ô #{p.slotNumber}{p.vehiclePlate ? ` • ${p.vehiclePlate}` : ''}</Text>
                <Text style={L.sub} numberOfLines={1}>{p.methodLabel} • {formatDateTime(p.createdAt)}{p.collectorName ? ` • thu bởi ${p.collectorName}` : ''}</Text>
                <Text style={[L.sub, { color: '#94A3B8' }]} numberOfLines={1}>{p.receiptNo}{p.userEmail ? ` • ${p.userEmail}` : ' • khách vãng lai'}</Text>
              </View>
              <Text style={L.amount}>{formatVND(p.amount)}</Text>
            </Card>
          )}
        />
      )}
      <DateRangeModal visible={picker} from={range.from} to={range.to} onClose={() => setPicker(false)}
        onApply={(x) => { setPicker(false); setPreset('custom'); setRange(x); }} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summary: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16, marginBottom: 10 },
  sumLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  sum: { color: '#fff', fontSize: 26, fontWeight: '900', marginVertical: 2 },
  methods: { marginTop: 12, gap: 8 },
  method: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mName: { width: 80, color: '#fff', fontSize: 12, fontWeight: '700' },
  mBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  mFill: { height: '100%', backgroundColor: '#93C5FD', borderRadius: 3 },
  mVal: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, minWidth: 90, textAlign: 'right' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
