// QUAN TRI - DIEU CHINH GIA: tang / giam gia gui xe theo % hoac so tien, hoac dat gia moi cho 1 / nhieu / tat ca bai.
// Xem truoc gia moi tung bai, ly do, tuy chon bao cho tai xe lien quan, lich su doi gia.
// Xe dang gui + dat cho da tao giu nguyen gia cu (backend chot gia).
// params: { lotId? } -> chon san 1 bai (tu man hinh Bai do)
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import Button from '../../components/Button';
import { Card, Chips, Empty, PromptDialog, listStyles as L } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { colors, radius } from '../../theme';
import { formatVND } from '../../utils/schedules';
import { formatDateTime } from '../../utils/booking';
import { QUICK, buildAdjustment, describeAdjustment, previewChanges } from '../../utils/pricing';

const DIRECTIONS = [
  { key: 'up', label: 'Tăng giá', icon: 'trending-up' },
  { key: 'down', label: 'Giảm giá', icon: 'trending-down' },
  { key: 'set', label: 'Đặt giá mới', icon: 'pricetag' },
];
const UNITS = [{ key: 'percent', label: 'Theo %' }, { key: 'amount', label: 'Theo số tiền' }];
const quickLabel = (unit, n) => (unit === 'percent' ? `${n}%` : `${n.toLocaleString('vi-VN')}đ`);

// Chenh lech gia: mui ten + dau +/- (khong chi dua vao mau)
function Diff({ diff, oldPrice }) {
  const up = diff > 0;
  const pct = oldPrice > 0 ? ` (${up ? '+' : '−'}${Math.round((Math.abs(diff) / oldPrice) * 1000) / 10}%)` : '';
  return (
    <View style={L.row}>
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={13} color={up ? colors.danger : colors.success} />
      <Text style={[styles.diff, { color: up ? colors.danger : colors.success }]}>
        {up ? '+' : '−'}{formatVND(Math.abs(diff))}{pct}
      </Text>
    </View>
  );
}

export default function AdminPricingScreen({ navigation, route }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(() => (route?.params?.lotId ? [route.params.lotId] : null)); // null = tat ca
  const [direction, setDirection] = useState('up');
  const [unit, setUnit] = useState('percent');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.pricing());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const lots = useMemo(() => data?.lots || [], [data]);
  const chosen = selected === null ? lots : lots.filter((l) => selected.includes(l.id));
  const adj = buildAdjustment({ direction, unit, amount });
  const changes = previewChanges(chosen, adj);
  const affected = chosen.reduce((n, l) => n + l.openSessions + l.openReservations, 0);

  const toggleLot = (id) => {
    const cur = selected === null ? lots.map((l) => l.id) : selected;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setSelected(next.length === lots.length ? null : next);
  };
  const pickDirection = (d) => { setDirection(d); setAmount(''); };
  const pickUnit = (u) => { setUnit(u); setAmount(''); };

  async function apply() {
    const r = await adminApi.adjustPrice({
      lotIds: selected === null ? undefined : selected, mode: adj.mode, value: adj.value,
      reason: reason.trim() || undefined, notify,
    });
    setConfirm(false);
    setAmount('');
    setReason('');
    setNotice({
      type: 'success',
      text: r.changes.length
        ? `Đã cập nhật giá ${r.changes.length} bãi.${r.notified ? ` Đã báo cho ${r.notified} tài xế.` : ''}`
        : 'Giá không thay đổi (đã làm tròn bằng giá hiện tại).',
    });
    load();
  }

  if (!data && !error) {
    return <ScreenShell navigation={navigation} title="Điều chỉnh giá"><View style={L.center}><ActivityIndicator color={colors.primary} /></View></ScreenShell>;
  }

  return (
    <ScreenShell navigation={navigation} title="Điều chỉnh giá" subtitle="Giá gửi xe theo giờ">
      <ScrollView contentContainerStyle={L.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        {error ? <Notice type="error">{error}</Notice> : null}
        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}

        {/* 1. Chon bai */}
        <Card>
          <View style={[L.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.label}>1. Chọn bãi áp dụng</Text>
            <Pressable onPress={() => setSelected(selected === null ? [] : null)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>{selected === null ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</Text>
            </Pressable>
          </View>
          {!lots.length ? <Empty icon="business-outline" text="Chưa có bãi đỗ nào." /> : null}
          {lots.map((l) => {
            const on = selected === null || selected.includes(l.id);
            return (
              <Pressable key={l.id} onPress={() => toggleLot(l.id)} style={[styles.lot, on && styles.lotOn]}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${l.name}, ${formatVND(l.pricePerHour)} một giờ`}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.primary : '#94A3B8'} />
                <View style={{ flex: 1 }}>
                  <Text style={L.title} numberOfLines={1}>{l.name}</Text>
                  <Text style={L.sub} numberOfLines={1}>
                    {l.openSessions + l.openReservations ? `${l.openSessions} xe đang gửi • ${l.openReservations} đặt chỗ` : 'Không có xe đang gửi'}
                    {l.lastChangedAt ? ` • đổi giá ${formatDateTime(l.lastChangedAt)}` : ''}
                  </Text>
                </View>
                <Text style={styles.price}>{formatVND(l.pricePerHour)}<Text style={styles.per}>/giờ</Text></Text>
              </Pressable>
            );
          })}
        </Card>

        {/* 2. Muc dieu chinh */}
        <Card>
          <Text style={styles.label}>2. Mức điều chỉnh</Text>
          <Chips options={DIRECTIONS} value={direction} onChange={pickDirection} />
          {direction !== 'set' ? <Chips options={UNITS} value={unit} onChange={pickUnit} /> : null}
          <View style={styles.inputRow}>
            <Text style={styles.sign}>{direction === 'up' ? '+' : direction === 'down' ? '−' : ''}</Text>
            <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad"
              placeholder={direction === 'set' ? 'vd: 15000' : unit === 'percent' ? 'vd: 10' : 'vd: 2000'} placeholderTextColor={colors.placeholder}
              style={styles.input} accessibilityLabel="Mức điều chỉnh" />
            <Text style={styles.unit}>{direction !== 'set' && unit === 'percent' ? '%' : 'đ'}</Text>
          </View>
          {direction !== 'set' ? (
            <View style={L.wrap}>
              {QUICK[unit].map((n) => (
                <Pressable key={n} onPress={() => setAmount(String(n))} style={[styles.quick, amount === String(n) && styles.quickOn]} accessibilityRole="button">
                  <Text style={[styles.quickText, amount === String(n) && { color: colors.primary }]}>
                    {direction === 'up' ? '+' : '−'}{quickLabel(unit, n)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {adj?.error ? <Text style={styles.err}>{adj.error}</Text> : null}
          <Text style={styles.label}>Lý do (không bắt buộc)</Text>
          <TextInput value={reason} onChangeText={setReason} maxLength={200} placeholder="vd: Giờ cao điểm, khuyến mãi cuối tuần..."
            placeholderTextColor={colors.placeholder} style={[styles.input, styles.reason]} />
          <View style={[L.row, { marginTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={L.title}>Thông báo cho tài xế</Text>
              <Text style={L.sub}>Tài xế yêu thích hoặc từng gửi xe ở bãi được đổi giá.</Text>
            </View>
            <Switch value={notify} onValueChange={setNotify} trackColor={{ true: colors.primary, false: '#CBD5E1' }} thumbColor="#fff"
              accessibilityLabel="Thông báo cho tài xế" />
          </View>
        </Card>

        {/* 3. Xem truoc */}
        <Card>
          <Text style={styles.label}>3. Xem trước</Text>
          {!adj || adj.error ? <Text style={L.sub}>Nhập mức điều chỉnh để xem giá mới.</Text> : null}
          {adj && !adj.error && !changes.length ? <Text style={L.sub}>Không bãi nào đổi giá (giá làm tròn đến 1.000đ).</Text> : null}
          {changes.map((c) => (
            <View key={c.lotId} style={styles.prev}>
              <Text style={[L.title, { flex: 1 }]} numberOfLines={1}>{c.name}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.prevPrice}>
                  <Text style={styles.old}>{formatVND(c.oldPrice)}</Text>{'  →  '}{formatVND(c.newPrice)}
                </Text>
                <Diff diff={c.diff} oldPrice={c.oldPrice} />
              </View>
            </View>
          ))}
          <View style={styles.info}>
            <Ionicons name="information-circle" size={16} color={colors.primary} />
            <Text style={styles.infoText}>
              Giá mới áp dụng cho lượt đặt chỗ và gửi xe mới. Xe đang gửi và đặt chỗ đã tạo giữ nguyên giá cũ
              {affected ? ` (${affected} lượt ở các bãi đã chọn)` : ''}. Giá làm tròn đến 1.000đ.
            </Text>
          </View>
          <Button title={changes.length ? `Áp dụng cho ${changes.length} bãi` : 'Áp dụng giá mới'} disabled={!changes.length}
            onPress={() => setConfirm(true)} style={{ marginTop: 12 }} />
        </Card>

        {/* Lich su */}
        <Text style={styles.section}>Lịch sử thay đổi giá</Text>
        {!data?.history?.length ? <Text style={L.sub}>Chưa có thay đổi giá nào.</Text> : null}
        {(data?.history || []).map((h) => (
          <Card key={h.id}>
            <View style={[L.row, { justifyContent: 'space-between' }]}>
              <Text style={[L.title, { flex: 1 }]} numberOfLines={1}>{h.lotName}</Text>
              <Diff diff={h.diff} oldPrice={h.oldPrice} />
            </View>
            <Text style={[L.sub, { color: colors.text }]}>{formatVND(h.oldPrice)} → {formatVND(h.newPrice)} /giờ</Text>
            {h.reason ? <Text style={L.sub}>Lý do: {h.reason}</Text> : null}
            <Text style={L.sub}>{formatDateTime(h.createdAt)}{h.changedBy ? ` • ${h.changedBy}` : ''}</Text>
          </Card>
        ))}
      </ScrollView>

      <PromptDialog visible={confirm} title={adj && !adj.error ? `${describeAdjustment(adj)}?` : 'Áp dụng giá mới?'} confirmLabel="Áp dụng"
        message={`${changes.map((c) => `• ${c.name}: ${formatVND(c.oldPrice)} → ${formatVND(c.newPrice)}`).join('\n')}\n\n`
          + `Áp dụng ngay cho lượt mới${notify ? ', có gửi thông báo cho tài xế' : ''}.`}
        onCancel={() => setConfirm(false)} onConfirm={apply} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 4, marginBottom: 8 },
  link: { fontSize: 12.5, fontWeight: '800', color: colors.primary },
  lot: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 6 },
  lotOn: { borderColor: colors.primary, backgroundColor: '#F5F8FF' },
  price: { fontSize: 14, fontWeight: '900', color: colors.text },
  per: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, paddingHorizontal: 12 },
  sign: { fontSize: 20, fontWeight: '900', color: colors.text, minWidth: 10 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 18, fontWeight: '800', color: colors.text, outlineStyle: 'none' },
  unit: { fontSize: 16, fontWeight: '800', color: colors.textMuted },
  reason: { flex: 0, fontSize: 14, fontWeight: '400', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, paddingHorizontal: 12 },
  quick: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  quickOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  quickText: { fontSize: 12.5, fontWeight: '800', color: colors.textMuted },
  err: { color: colors.danger, fontSize: 12.5, marginTop: 8 },
  prev: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  prevPrice: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  old: { color: colors.textMuted, fontWeight: '600', textDecorationLine: 'line-through' },
  diff: { fontSize: 12, fontWeight: '800' },
  info: { flexDirection: 'row', gap: 6, marginTop: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  infoText: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 17 },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
});
