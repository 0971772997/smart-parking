// UI-005 CREATE / EDIT ROUTE: Them / Sua lo trinh
// params: { editing?: route } - co editing = che do sua
// - Ten (goi y nhanh), diem xuat phat (goi y), bai do dich (kem so o trong / online)
// - Gio khoi hanh (go tay "0730" / nut ±15 phut / gio goi y), ngay lap lai (T2..CN + nhom nhanh)
// - Xe su dung (them xe moi ngay tai day), thoi gian giu cho khi dat nhanh (uoc tinh phi), ghi chu, bat/tat
// - Xem truoc lo trinh, chan thoat khi chua luu, xoa lo trinh (che do sua)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Notice from '../../components/Notice';
import TextField from '../../components/TextField';
import { routesApi } from '../../api/routes';
import { lotsApi } from '../../api/lots';
import { vehiclesApi } from '../../api/vehicles';
import { colors, radius } from '../../theme';
import { daysLabel, DAY_PRESETS, formatDuration, formatVND, nextDeparture, normalizeTime, WEEKDAYS } from '../../utils/routes';

const TIME_PRESETS = ['06:30', '07:00', '07:30', '08:00', '12:00', '17:00', '17:30', '18:00'];
const MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120];
const NAME_SUGGESTIONS = ['Nhà → Công ty', 'Công ty → Nhà', 'Đi học', 'Đi siêu thị', 'Đón con'];
const ORIGIN_SUGGESTIONS = ['Nhà', 'Công ty', 'Trường học'];
const NOTE_MAX = 255;

// Loi tu server -> hien duoi o tuong ung
const FIELD_ERRORS = {
  lot_not_found: 'lotId',
  vehicle_not_found: 'vehicleId',
  route_limit: 'form',
};

const initialForm = (r) => ({
  name: r?.name || '',
  origin: r?.origin || '',
  lotId: r?.lotId || null,
  vehicleId: r?.vehicleId || null,
  departTime: r?.departTime || '07:30',
  days: r?.days || [1, 2, 3, 4, 5],
  minutes: r?.minutes || 15,
  note: r?.note || '',
  active: r ? r.active : true,
});

// Cong / tru phut tren gio "HH:MM" (vong qua nua dem)
function shiftTime(t, delta) {
  const v = normalizeTime(t) || '07:30';
  const [h, m] = v.split(':').map(Number);
  const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const estimateFee = (pricePerHour, minutes) =>
  pricePerHour == null ? null : Math.ceil((pricePerHour * minutes) / 60 / 1000) * 1000;

export default function RouteFormScreen({ navigation, route }) {
  const editing = route.params?.editing || null;
  const [original] = useState(() => initialForm(editing));
  const [form, setForm] = useState(original);
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lots, setLots] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [refsError, setRefsError] = useState('');
  // Them xe nhanh
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [plate, setPlate] = useState('');
  const [plateError, setPlateError] = useState('');
  const [plateBusy, setPlateBusy] = useState(false);
  // Thoat / xoa
  const [exitTo, setExitTo] = useState(null);           // params gui ve man Routes sau khi luu / xoa
  const [pendingLeave, setPendingLeave] = useState(null); // action dang bi chan vi chua luu
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadRefs = useCallback(async () => {
    setLoadingRefs(true); setRefsError('');
    const [l, v] = await Promise.allSettled([lotsApi.list(), vehiclesApi.list()]);
    if (l.status === 'fulfilled') {
      setLots(l.value || []);
      // Lo trinh moi + chi co 1 bai -> chon san
      if (!editing && l.value?.length === 1) setForm((f) => ({ ...f, lotId: f.lotId || l.value[0].id }));
    } else setRefsError(l.reason?.message || 'Không tải được danh sách bãi đỗ.');
    if (v.status === 'fulfilled') setVehicles(v.value || []);
    setLoadingRefs(false);
  }, [editing]);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  // ---------- Chan thoat khi chua luu ----------
  const dirty = useMemo(() => {
    const a = { ...form, departTime: normalizeTime(form.departTime) || form.departTime };
    // Lo trinh moi: bai duoc chon san tu dong khong tinh la "da sua"
    const b = { ...original, lotId: editing ? original.lotId : a.lotId };
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [form, original, editing]);

  usePreventRemove(dirty && !exitTo, ({ data }) => setPendingLeave(data.action));

  useEffect(() => {
    if (exitTo) navigation.popTo('Routes', exitTo);
  }, [exitTo, navigation]);

  // ---------- Form ----------
  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errs[key]) setErrs((e) => ({ ...e, [key]: undefined }));
  };

  // Cap nhat dang ham: bam nhieu ngay lien tiep van dung (khong doc form.days cu)
  const toggleDay = (d) => {
    setForm((f) => ({
      ...f,
      days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b),
    }));
    if (errs.days) setErrs((e) => ({ ...e, days: undefined }));
  };

  const stepTime = (delta) => {
    setForm((f) => ({ ...f, departTime: shiftTime(f.departTime, delta) }));
    if (errs.departTime) setErrs((e) => ({ ...e, departTime: undefined }));
  };

  const selectedLot = useMemo(() => lots.find((l) => l.id === form.lotId), [lots, form.lotId]);
  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === form.vehicleId), [vehicles, form.vehicleId]);
  const validTime = normalizeTime(form.departTime);
  const next = useMemo(
    () => (validTime && form.days.length ? nextDeparture({ departTime: validTime, days: form.days }) : null),
    [validTime, form.days],
  );

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Vui lòng đặt tên lộ trình (vd: Nhà → Công ty)';
    else if (form.name.trim().length > 60) e.name = 'Tối đa 60 ký tự';
    if (form.origin.trim().length > 120) e.origin = 'Tối đa 120 ký tự';
    if (!form.lotId) e.lotId = 'Chọn bãi đỗ đích';
    if (!validTime) e.departTime = 'Giờ không hợp lệ (vd: 07:30 hoặc gõ 0730)';
    if (form.days.length === 0) e.days = 'Chọn ít nhất 1 ngày';
    if (form.note.trim().length > NOTE_MAX) e.note = `Tối đa ${NOTE_MAX} ký tự`;
    setErrs(e);
    if (Object.keys(e).length) setError('Vui lòng kiểm tra lại các mục được đánh dấu.');
    return Object.keys(e).length === 0;
  }

  async function onSave() {
    setError('');
    if (!validate()) return;
    setBusy(true);
    const body = {
      name: form.name.trim(),
      origin: form.origin.trim() || null,
      lotId: form.lotId,
      vehicleId: form.vehicleId,
      departTime: validTime,
      days: form.days,
      minutes: form.minutes,
      note: form.note.trim() || null,
      active: form.active,
    };
    try {
      const saved = editing ? await routesApi.update(editing.id, body) : await routesApi.create(body);
      setExitTo({
        saved: { id: saved.id, text: editing ? `Đã cập nhật "${saved.name}".` : `Đã thêm lộ trình "${saved.name}".` },
      });
    } catch (e) {
      const field = FIELD_ERRORS[e.code];
      if (field && field !== 'form') setErrs((x) => ({ ...x, [field]: e.message }));
      setError(e.message);
      setBusy(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await routesApi.remove(editing.id);
      setConfirmDelete(false);
      setExitTo({ saved: { text: `Đã xoá lộ trình "${editing.name}".` } });
    } catch (e) {
      setConfirmDelete(false);
      if (e.code === 'route_not_found') setExitTo({ saved: { text: e.message } });
      else setError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function onAddVehicle() {
    const p = plate.trim().toUpperCase();
    if (p.length < 4 || p.length > 20) { setPlateError('Biển số 4–20 ký tự (vd: 43A-123.45)'); return; }
    setPlateBusy(true); setPlateError('');
    try {
      const v = await vehiclesApi.create({ plateNumber: p });
      setVehicles((vs) => [...vs, v]);
      set('vehicleId')(v.id);
      setPlate(''); setAddingVehicle(false);
    } catch (e) {
      setPlateError(e.message);
    } finally {
      setPlateBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng">
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>{editing ? 'Sửa lộ trình' : 'Thêm lộ trình'}</Text>
          {dirty ? <Text style={styles.headerSub}>Chưa lưu thay đổi</Text> : null}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Notice type="error">{error}</Notice> : null}

          {/* 1. Thong tin chuyen di */}
          <Section icon="bookmark-outline" title="Thông tin chuyến đi">
            <TextField label="Tên lộ trình *" icon="bookmark-outline" placeholder="Vd: Nhà → Công ty"
              value={form.name} onChangeText={set('name')} error={errs.name} autoCapitalize="sentences" maxLength={60} />
            {!editing && (
              <View style={[styles.wrapRow, styles.suggestRow]}>
                {NAME_SUGGESTIONS.map((s) => (
                  <Pill key={s} label={s} small on={form.name === s} onPress={() => set('name')(s)} />
                ))}
              </View>
            )}
            <TextField label="Điểm xuất phát" icon="location-outline" placeholder="Để trống = vị trí hiện tại"
              value={form.origin} onChangeText={set('origin')} error={errs.origin} autoCapitalize="sentences" maxLength={120} />
            <View style={[styles.wrapRow, styles.suggestRow, { marginBottom: 0 }]}>
              {ORIGIN_SUGGESTIONS.map((s) => (
                <Pill key={s} label={s} small icon="location-outline" on={form.origin === s} onPress={() => set('origin')(s)} />
              ))}
            </View>
          </Section>

          {/* 2. Bai do dich */}
          <Section icon="business-outline" title="Bãi đỗ đích *" error={errs.lotId}>
            {loadingRefs ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : refsError ? (
              <View style={styles.retryBox}>
                <Text style={styles.muted}>{refsError}</Text>
                <Pressable onPress={loadRefs} style={styles.retryBtn} accessibilityRole="button">
                  <Ionicons name="refresh" size={14} color={colors.primary} />
                  <Text style={styles.retryText}>Thử lại</Text>
                </Pressable>
              </View>
            ) : lots.length === 0 ? (
              <Text style={styles.muted}>Chưa có bãi đỗ nào trong hệ thống.</Text>
            ) : (
              lots.map((l) => {
                const on = form.lotId === l.id;
                return (
                  <Pressable key={l.id} onPress={() => set('lotId')(l.id)} style={[styles.option, on && styles.optionOn]}
                    accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={l.name}>
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
            {selectedLot && !selectedLot.online ? (
              <Text style={styles.warn}>Bãi đang offline: vẫn lưu được lộ trình, nhưng chưa đặt chỗ nhanh được.</Text>
            ) : null}
          </Section>

          {/* 3. Gio khoi hanh */}
          <Section icon="time-outline" title="Giờ khởi hành *" error={errs.departTime}>
            <View style={styles.timeRow}>
              <StepBtn icon="remove" label="Lùi 15 phút" onPress={() => stepTime(-15)} />
              <TextField icon="time-outline" placeholder="HH:MM" value={form.departTime} keyboardType="numbers-and-punctuation"
                onChangeText={set('departTime')} maxLength={5} style={styles.timeField} accessibilityLabel="Giờ khởi hành" />
              <StepBtn icon="add" label="Thêm 15 phút" onPress={() => stepTime(15)} />
            </View>
            <View style={styles.wrapRow}>
              {TIME_PRESETS.map((t) => (
                <Pill key={t} label={t} on={validTime === t} onPress={() => set('departTime')(t)} />
              ))}
            </View>
          </Section>

          {/* 4. Ngay lap lai */}
          <Section icon="repeat-outline" title="Lặp lại vào *" error={errs.days}>
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

          {/* 5. Xe */}
          <Section icon="car-sport-outline" title="Xe sử dụng" error={errs.vehicleId}>
            <View style={styles.wrapRow}>
              <Pill label="Không chọn" on={!form.vehicleId} onPress={() => set('vehicleId')(null)} />
              {vehicles.map((v) => (
                <Pill key={v.id} icon="car-sport-outline" label={v.plateNumber} on={form.vehicleId === v.id}
                  onPress={() => set('vehicleId')(v.id)} />
              ))}
              {!addingVehicle && (
                <Pill icon="add" label="Thêm xe" dashed onPress={() => setAddingVehicle(true)} />
              )}
            </View>
            {addingVehicle && (
              <View style={styles.addVehicle}>
                <TextField icon="car-outline" placeholder="Biển số, vd: 43A-123.45" value={plate}
                  onChangeText={(t) => { setPlate(t); setPlateError(''); }} error={plateError}
                  autoCapitalize="characters" maxLength={20} autoFocus style={{ flex: 1, marginBottom: 0 }}
                  onSubmitEditing={onAddVehicle} returnKeyType="done" />
                <View style={styles.addVehicleBtns}>
                  <Button title="Thêm" onPress={onAddVehicle} loading={plateBusy} style={styles.smallBtn} />
                  <Button title="Huỷ" variant="ghost" onPress={() => { setAddingVehicle(false); setPlate(''); setPlateError(''); }}
                    disabled={plateBusy} style={styles.smallBtn} />
                </View>
              </View>
            )}
            {!loadingRefs && vehicles.length === 0 && !addingVehicle ? (
              <Text style={styles.muted}>Bạn chưa đăng ký xe nào. Bấm "Thêm xe" để đăng ký biển số ngay.</Text>
            ) : null}
          </Section>

          {/* 6. Giu cho */}
          <Section icon="hourglass-outline" title="Thời gian giữ chỗ khi đặt nhanh">
            <View style={styles.wrapRow}>
              {MINUTE_OPTIONS.map((m) => (
                <Pill key={m} label={`${m} phút`} on={form.minutes === m} onPress={() => set('minutes')(m)} />
              ))}
            </View>
            {selectedLot ? (
              <Text style={styles.muted}>
                Ước tính phí theo giá bãi ({formatVND(selectedLot.pricePerHour)}/giờ): {formatVND(estimateFee(selectedLot.pricePerHour, form.minutes))}
              </Text>
            ) : null}
          </Section>

          {/* 7. Khac */}
          <Section icon="options-outline" title="Khác">
            <TextField label="Ghi chú" icon="document-text-outline" placeholder="Vd: Ưu tiên ô gần cổng ra"
              value={form.note} onChangeText={set('note')} error={errs.note} autoCapitalize="sentences" maxLength={NOTE_MAX}
              hint={`${form.note.length}/${NOTE_MAX}`} />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Kích hoạt lộ trình</Text>
                <Text style={styles.muted}>Tắt khi tạm thời không đi tuyến này.</Text>
              </View>
              <Switch value={form.active} onValueChange={set('active')} accessibilityLabel="Kích hoạt lộ trình"
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }} thumbColor={form.active ? colors.primary : '#F8FAFC'} />
            </View>
          </Section>

          {/* 8. Xem truoc */}
          <View style={styles.preview}>
            <View style={styles.previewHead}>
              <Ionicons name="eye-outline" size={15} color={colors.primary} />
              <Text style={styles.previewLabel}>Xem trước</Text>
              {!form.active ? <Text style={styles.previewPaused}>Tạm tắt</Text> : null}
            </View>
            <View style={styles.previewMain}>
              <View style={[styles.previewTime, !form.active && { backgroundColor: '#F1F5F9' }]}>
                <Text style={[styles.previewTimeText, !form.active && { color: colors.textMuted }]}>{validTime || '--:--'}</Text>
                <Text style={styles.previewDays} numberOfLines={1}>{form.days.length ? daysLabel(form.days) : 'Chưa chọn ngày'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewName} numberOfLines={1}>{form.name.trim() || 'Tên lộ trình'}</Text>
                <Text style={styles.previewPath} numberOfLines={1}>
                  {form.origin.trim() || 'Vị trí hiện tại'} → {selectedLot?.name || 'Chọn bãi đỗ'}
                </Text>
                <Text style={styles.previewMeta} numberOfLines={2}>
                  {selectedVehicle ? `Xe ${selectedVehicle.plateNumber}` : 'Chưa chọn xe'} • Giữ chỗ {form.minutes} phút
                  {form.active && next ? ` • Chuyến tới: ${next.inMinutes <= 180 ? `sau ${formatDuration(next.inMinutes)}` : next.label}` : ''}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {editing ? (
            <Pressable onPress={() => setConfirmDelete(true)} disabled={busy}
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Xoá lộ trình">
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          ) : null}
          <Button title={editing ? 'Lưu thay đổi' : 'Thêm lộ trình'} onPress={onSave} loading={busy}
            disabled={loadingRefs || (editing && !dirty)} style={{ flex: 1 }} />
        </View>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={!!pendingLeave}
        title="Bỏ thay đổi?"
        message="Những thông tin bạn vừa nhập sẽ không được lưu."
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Ở lại"
        danger
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => { const a = pendingLeave; setPendingLeave(null); navigation.dispatch(a); }}
      />
      <ConfirmDialog
        visible={confirmDelete}
        danger
        title="Xoá lộ trình?"
        message={editing ? `Lộ trình "${editing.name}" sẽ bị xoá vĩnh viễn.` : ''}
        confirmLabel="Xoá"
        loading={deleting}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </SafeAreaView>
  );
}

function Section({ icon, title, error, children }) {
  return (
    <View style={[styles.section, !!error && styles.sectionError]}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

function Pill({ label, on, onPress, icon, small, dashed }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, small && styles.pillSmall, dashed && styles.pillDashed, on && styles.pillOn]}
      accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      {icon ? <Ionicons name={icon} size={small ? 12 : 14} color={on ? '#fff' : dashed ? colors.primary : colors.textMuted} /> : null}
      <Text style={[styles.pillText, small && { fontSize: 12 }, dashed && { color: colors.primary }, on && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

function StepBtn({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.7 }]}
      accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 11, color: colors.warning, fontWeight: '600', marginTop: 1 },
  content: { padding: 16, paddingBottom: 24, backgroundColor: '#F8FAFC', gap: 12, flexGrow: 1 },

  section: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 },
  sectionError: { borderColor: '#FCA5A5' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  warn: { fontSize: 12, color: '#B45309', marginTop: 4 },
  err: { color: colors.danger, fontSize: 12.5, marginTop: 6 },
  suggestRow: { marginTop: -6, marginBottom: 14 },

  retryBox: { alignItems: 'flex-start', gap: 8 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, marginBottom: 8 },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  optionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  freeTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  freeText: { fontSize: 11, fontWeight: '700' },

  timeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  timeField: { flex: 1, marginBottom: 0 },
  stepBtn: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },

  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  pillSmall: { height: 28, paddingHorizontal: 10 },
  pillDashed: { borderStyle: 'dashed', borderColor: colors.primary },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  pillTextOn: { color: '#fff' },

  addVehicle: { marginTop: 12, gap: 8 },
  addVehicleBtns: { flexDirection: 'row', gap: 8 },
  smallBtn: { height: 42, flex: 1 },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
  dayOn: { backgroundColor: colors.primary },
  dayText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  dayTextOn: { color: '#fff' },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { fontSize: 14, fontWeight: '700', color: colors.text },

  preview: { borderRadius: radius.md, borderWidth: 1.5, borderColor: '#BFDBFE', borderStyle: 'dashed', backgroundColor: '#fff', padding: 14 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  previewLabel: { fontSize: 12, fontWeight: '800', color: colors.primary, flex: 1 },
  previewPaused: { fontSize: 11, fontWeight: '700', color: colors.textMuted, backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  previewMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewTime: { width: 70, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center' },
  previewTimeText: { fontSize: 17, fontWeight: '900', color: colors.primary },
  previewDays: { fontSize: 9.5, fontWeight: '600', color: colors.textMuted, marginTop: 2, paddingHorizontal: 4 },
  previewName: { fontSize: 15, fontWeight: '700', color: colors.text },
  previewPath: { fontSize: 12, color: colors.text, marginTop: 2 },
  previewMeta: { fontSize: 11.5, color: colors.textMuted, marginTop: 3 },

  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: '#F1F5F9', backgroundColor: '#fff' },
  deleteBtn: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#FECACA', backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
});
