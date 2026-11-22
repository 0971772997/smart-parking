// Chon khoang ngay tren lich thang (khong can thu vien native): bam ngay bat dau -> bam ngay ket thuc -> Ap dung
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from './Button';
import { colors, radius } from '../theme';
import { fromYmd, toYmd, ymdLabel } from '../utils/dates';

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MAX_DAYS = 366;

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Thu 2 dau tuan
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(toYmd(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export default function DateRangeModal({ visible, from, to, onApply, onClose }) {
  return visible ? <Picker from={from} to={to} onApply={onApply} onClose={onClose} /> : null;
}

function Picker({ from, to, onApply, onClose }) {
  const today = toYmd();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [view, setView] = useState(() => { const d = fromYmd(to || today); return { y: d.getFullYear(), m: d.getMonth() }; });

  const pick = (s) => {
    if (s > today) return;
    if (!start || end) { setStart(s); setEnd(null); return; }
    if (s < start) { setStart(s); return; }
    setEnd(s);
  };
  const shift = (n) => setView(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const span = start && end ? Math.round((fromYmd(end) - fromYmd(start)) / 86400000) + 1 : 0;
  const tooLong = span > MAX_DAYS;
  const canNext = new Date(view.y, view.m + 1, 1) <= fromYmd(today);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.top}>
            <Text style={styles.title}>Chọn khoảng ngày</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Đóng"><Ionicons name="close" size={22} color={colors.textMuted} /></Pressable>
          </View>
          <View style={styles.rangeRow}>
            <RangeBox label="Từ ngày" value={start} active={!end} />
            <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
            <RangeBox label="Đến ngày" value={end} active={!!start && !end} />
          </View>

          <View style={styles.monthRow}>
            <Pressable onPress={() => shift(-1)} hitSlop={8} style={styles.nav} accessibilityLabel="Tháng trước">
              <Ionicons name="chevron-back" size={18} color={colors.text} />
            </Pressable>
            <Text style={styles.month}>Tháng {view.m + 1}/{view.y}</Text>
            <Pressable onPress={() => canNext && shift(1)} hitSlop={8} style={[styles.nav, !canNext && { opacity: 0.3 }]} accessibilityLabel="Tháng sau">
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {DOW.map((d) => <Text key={d} style={styles.dow}>{d}</Text>)}
            {monthCells(view.y, view.m).map((s, i) => {
              if (!s) return <View key={`e${i}`} style={styles.cell} />;
              const edge = s === start || s === end;
              const inside = start && end && s > start && s < end;
              const future = s > today;
              return (
                <Pressable key={s} onPress={() => pick(s)} disabled={future} style={styles.cell} accessibilityLabel={ymdLabel(s)}>
                  <View style={[styles.day, inside && styles.dayIn, edge && styles.dayEdge]}>
                    <Text style={[styles.dayText, future && { color: '#CBD5E1' }, inside && { color: colors.primaryDark },
                      edge && { color: '#fff' }, s === today && !edge && { color: colors.primary, fontWeight: '900' }]}>
                      {Number(s.slice(8))}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, tooLong && { color: colors.danger }]}>
            {tooLong ? 'Tối đa 366 ngày mỗi lần xem.' : start && end ? `${span} ngày` : end === null && start ? 'Chọn ngày kết thúc' : 'Chọn ngày bắt đầu'}
          </Text>
          <View style={styles.actions}>
            <Button title="Huỷ" variant="outline" onPress={onClose} style={{ flex: 1, height: 46 }} />
            <Button title="Áp dụng" disabled={!start || tooLong} onPress={() => onApply({ from: start, to: end || start })} style={{ flex: 1, height: 46 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RangeBox({ label, value, active }) {
  return (
    <View style={[styles.box, active && styles.boxActive]}>
      <Text style={styles.boxLabel}>{label}</Text>
      <Text style={styles.boxValue}>{value ? ymdLabel(value) : '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: radius.lg, padding: 16 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  box: { flex: 1, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0' },
  boxActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  boxLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  boxValue: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 2 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  nav: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dow: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, fontWeight: '800', color: colors.textMuted, paddingVertical: 6 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  day: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dayIn: { backgroundColor: colors.primarySoft, borderRadius: 4 },
  dayEdge: { backgroundColor: colors.primary },
  dayText: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  hint: { textAlign: 'center', fontSize: 12.5, color: colors.textMuted, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
