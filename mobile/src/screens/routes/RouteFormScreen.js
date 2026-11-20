// UI-ROUTE-FORM: Them / Sua lo trinh
// params: { editing?: route } - co editing = che do sua
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import TextField from '../../components/TextField';
import { routesApi } from '../../api/routes';
import { lotsApi } from '../../api/lots';
import { vehiclesApi } from '../../api/vehicles';
import { colors, radius } from '../../theme';
import { DAY_PRESETS, formatVND, normalizeTime, WEEKDAYS } from '../../utils/routes';

const TIME_PRESETS = ['06:30', '07:00', '07:30', '08:00', '12:00', '17:00', '17:30', '18:00'];
const MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120];

// Loi tu server -> hien duoi o tuong ung
const FIELD_ERRORS = {
  lot_not_found: 'lotId',
  vehicle_not_found: 'vehicleId',
};

export default function RouteFormScreen({ navigation, route }) {
  const editing = route.params?.editing || null;
  const [form, setForm] = useState(() => ({
    name: editing?.name || '',
    origin: editing?.origin || '',
    lotId: editing?.lotId || null,
    vehicleId: editing?.vehicleId || null,
    departTime: editing?.departTime || '07:30',
    days: editing?.days || [1, 2, 3, 4, 5],
    minutes: editing?.minutes || 15,
    note: editing?.note || '',
    active: editing ? editing.active : true,
  }));
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lots, setLots] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  useEffect(() => {
    (async () => {
      const [l, v] = await Promise.allSettled([lotsApi.list(), vehiclesApi.list()]);
      if (l.status === 'fulfilled') {
        setLots(l.value || []);
        // Lo trinh moi + chi co 1 bai -> chon san
        if (!editing && l.value?.length === 1) setForm((f) => ({ ...f, lotId: f.lotId || l.value[0].id }));
      } else setError(l.reason?.message || 'Không tải được danh sách bãi đỗ.');
      if (v.status === 'fulfilled') setVehicles(v.value || []);
      setLoadingRefs(false);
    })();
  }, [editing]);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errs[key]) setErrs((e) => ({ ...e, [key]: undefined }));
  };

  const toggleDay = (d) => set('days')(form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort((a, b) => a - b));

  const selectedLot = useMemo(() => lots.find((l) => l.id === form.lotId), [lots, form.lotId]);

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Vui lòng đặt tên lộ trình (vd: Nhà → Công ty)';
    else if (form.name.trim().length > 60) e.name = 'Tối đa 60 ký tự';
    if (form.origin.trim().length > 120) e.origin = 'Tối đa 120 ký tự';
    if (!form.lotId) e.lotId = 'Chọn bãi đỗ đích';
    if (!normalizeTime(form.departTime)) e.departTime = 'Giờ không hợp lệ (vd: 07:30)';
    if (form.days.length === 0) e.days = 'Chọn ít nhất 1 ngày';
    if (form.note.trim().length > 255) e.note = 'Tối đa 255 ký tự';
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function onSave() {
    if (!validate()) return;
    setError(''); setBusy(true);
    const body = {
      name: form.name.trim(),
      origin: form.origin.trim() || null,
      lotId: form.lotId,
      vehicleId: form.vehicleId,
      departTime: normalizeTime(form.departTime),
      days: form.days,
      minutes: form.minutes,
      note: form.note.trim() || null,
      active: form.active,
    };
    try {
      const saved = editing ? await routesApi.update(editing.id, body) : await routesApi.create(body);
      navigation.popTo('Routes', {
        saved: { id: saved.id, text: editing ? `Đã cập nhật "${saved.name}".` : `Đã thêm lộ trình "${saved.name}".` },
      });
    } catch (e) {
      const field = FIELD_ERRORS[e.code];
      if (field) setErrs((x) => ({ ...x, [field]: e.message }));
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{editing ? 'Sửa lộ trình' : 'Thêm lộ trình'}</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Notice type="error">{error}</Notice> : null}

          <Section title="Thông tin chuyến đi">
            <TextField label="Tên lộ trình" icon="bookmark-outline" placeholder="Vd: Nhà → Công ty"
              value={form.name} onChangeText={set('name')} error={errs.name} autoCapitalize="sentences" maxLength={60} />
            <TextField label="Điểm xuất phát (không bắt buộc)" icon="location-outline" placeholder="Vd: 12 Nguyễn Văn Linh, Hải Châu"
              value={form.origin} onChangeText={set('origin')} error={errs.origin} autoCapitalize="sentences" maxLength={120} />
          </Section>

          <Section title="Bãi đỗ đích" error={errs.lotId}>
            {loadingRefs ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : lots.length === 0 ? (
              <Text style={styles.muted}>Chưa có bãi đỗ nào trong hệ thống.</Text>
            ) : (
              lots.map((l) => {
                const on = form.lotId === l.id;
                return (
                  <Pressable key={l.id} onPress={() => set('lotId')(l.id)} style={[styles.option, on && styles.optionOn]}
                    accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.placeholder} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{l.name}</Text>
                      <Text style={styles.optionSub} numberOfLines={1}>
                        {[l.address, `${formatVND(l.pricePerHour)}/giờ`].filter(Boolean).join(' • ')}
                      </Text>
                    </View>
                    <View style={[styles.freeTag, { backgroundColor: l.online ? colors.successSoft : '#F1F5F9' }]}>
                      <Text style={[styles.freeText, { color: l.online ? colors.success : colors.textMuted }]}>
                        {l.online ? `${l.freeSlots ?? 0}/${l.totalSlots} trống` : 'Offline'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </Section>

          <Section title="Giờ khởi hành" error={errs.departTime}>
            <TextField icon="time-outline" placeholder="HH:MM" value={form.departTime} keyboardType="numbers-and-punctuation"
              onChangeText={set('departTime')}
              maxLength={5} style={{ marginBottom: 10 }} />
            <View style={styles.wrapRow}>
              {TIME_PRESETS.map((t) => (
                <Pill key={t} label={t} on={normalizeTime(form.departTime) === t} onPress={() => set('departTime')(t)} />
              ))}
            </View>
          </Section>

          <Section title="Lặp lại vào" error={errs.days}>
            <View style={styles.weekRow}>
              {WEEKDAYS.map((w) => {
                const on = form.days.includes(w.day);
                return (
                  <Pressable key={w.day} onPress={() => toggleDay(w.day)} style={[styles.day, on && styles.dayOn]}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={w.short}>
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{w.short}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.wrapRow, { marginTop: 10 }]}>
              {DAY_PRESETS.map((p) => (
                <Pill key={p.key} label={p.label}
                  on={p.days.length === form.days.length && p.days.every((d) => form.days.includes(d))}
                  onPress={() => set('days')(p.days)} />
              ))}
            </View>
          </Section>

          <Section title="Xe sử dụng">
            <View style={styles.wrapRow}>
              <Pill label="Không chọn" on={!form.vehicleId} onPress={() => set('vehicleId')(null)} />
              {vehicles.map((v) => (
                <Pill key={v.id} icon="car-sport-outline" label={v.plateNumber} on={form.vehicleId === v.id}
                  onPress={() => set('vehicleId')(v.id)} />
              ))}
            </View>
            {errs.vehicleId ? <Text style={styles.err}>{errs.vehicleId}</Text> : null}
            {!loadingRefs && vehicles.length === 0 ? (
              <Text style={styles.muted}>Bạn chưa đăng ký xe nào. Có thể thêm xe sau.</Text>
            ) : null}
          </Section>

          <Section title="Thời gian giữ chỗ khi đặt nhanh">
            <View style={styles.wrapRow}>
              {MINUTE_OPTIONS.map((m) => (
                <Pill key={m} label={`${m} phút`} on={form.minutes === m} onPress={() => set('minutes')(m)} />
              ))}
            </View>
            {selectedLot ? (
              <Text style={styles.muted}>
                Ước tính phí theo giá bãi: {formatVND(Math.ceil((selectedLot.pricePerHour * form.minutes) / 60 / 1000) * 1000)}
              </Text>
            ) : null}
          </Section>

          <Section title="Khác">
            <TextField label="Ghi chú" icon="document-text-outline" placeholder="Vd: Ưu tiên ô gần cổng ra"
              value={form.note} onChangeText={set('note')} error={errs.note} autoCapitalize="sentences" maxLength={255} />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Kích hoạt lộ trình</Text>
                <Text style={styles.muted}>Tắt khi tạm thời không đi tuyến này.</Text>
              </View>
              <Switch value={form.active} onValueChange={set('active')}
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }} thumbColor={form.active ? colors.primary : '#F8FAFC'} />
            </View>
          </Section>
        </ScrollView>

        <View style={styles.footer}>
          <Button title={editing ? 'Lưu thay đổi' : 'Thêm lộ trình'} onPress={onSave} loading={busy} disabled={loadingRefs} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, error, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

function Pill({ label, on, onPress, icon }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, on && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {icon ? <Ionicons name={icon} size={14} color={on ? '#fff' : colors.textMuted} /> : null}
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  content: { padding: 16, paddingBottom: 24, backgroundColor: '#F8FAFC', gap: 12, flexGrow: 1 },

  section: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  err: { color: colors.danger, fontSize: 12.5, marginTop: 6 },

  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, marginBottom: 8 },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  optionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  freeTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  freeText: { fontSize: 11, fontWeight: '700' },

  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  pillTextOn: { color: '#fff' },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
  dayOn: { backgroundColor: colors.primary },
  dayText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  dayTextOn: { color: '#fff' },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#F1F5F9', backgroundColor: '#fff' },
});
