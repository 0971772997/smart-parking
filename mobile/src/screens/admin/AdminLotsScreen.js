// QUAN TRI - BAI DO & THIET BI: tinh trang (online, o trong / co xe, doanh thu hom nay), them / sua (ten, dia chi,
// gia, so o), tam ngung nhan dat cho, mo / dong barie tu xa, xoa bai chua co lich su, xem so do.
// params: { focus?: lotId }
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import ScreenShell, { HeaderButton } from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import Button from '../../components/Button';
import TextField from '../../components/TextField';
import { Card, Empty, Pill, PromptDialog, SmallButton, listStyles as L } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatVND } from '../../utils/schedules';
import { timeAgo } from '../../utils/session';

const EMPTY_FORM = { id: '', name: '', address: '', pricePerHour: '10000', totalSlots: '4' };

export default function AdminLotsScreen({ navigation, route }) {
  const focus = route.params?.focus;
  const [lots, setLots] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState(null); // { mode: 'create' | 'edit', ...fields }
  const [confirm, setConfirm] = useState(null); // { title, message, label, danger, run, done }
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setLots(await adminApi.lots());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]));
  useOnLiveChange(load);

  async function gate(lot, g, action) {
    const key = `${lot.id}:${g}:${action}`;
    setBusy(key);
    try {
      await adminApi.gate(lot.id, g, action);
      setNotice({ type: 'success', text: `Đã ${action === 'open' ? 'mở' : 'đóng'} barie cổng ${g === 'entry' ? 'vào' : 'ra'} – ${lot.name}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function toggleBooking(lot) {
    setBusy(`${lot.id}:booking`);
    try {
      await adminApi.updateLot(lot.id, { bookingEnabled: !lot.bookingEnabled });
      setNotice({ type: 'success', text: lot.bookingEnabled ? `Đã tạm ngưng nhận đặt chỗ ở ${lot.name}.` : `${lot.name} nhận đặt chỗ trở lại.` });
      load();
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const sorted = (lots || []).slice().sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0));

  return (
    <ScreenShell navigation={navigation} title="Bãi đỗ & thiết bị" subtitle={lots ? `${lots.length} bãi` : null}
      right={<HeaderButton icon="add" label="Thêm bãi đỗ" color={colors.primary} onPress={() => setForm({ mode: 'create', ...EMPTY_FORM })} />}>
      {!lots && !error ? <View style={L.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={sorted}
          keyExtractor={(l) => l.id}
          contentContainerStyle={L.content}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={(
            <>
              {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
              {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
            </>
          )}
          ListEmptyComponent={!error ? <Empty icon="business-outline" text="Chưa có bãi đỗ. Bấm + để thêm." /> : null}
          renderItem={({ item: l }) => (
            <Card style={l.id === focus && { borderColor: colors.primary }}>
              <View style={L.row}>
                <Text style={[L.title, { flexShrink: 1 }]} numberOfLines={1}>{l.name}</Text>
                <Pill text={l.online ? 'Online' : 'Offline'} color={l.online ? colors.success : colors.danger}
                  bg={l.online ? colors.successSoft : colors.dangerSoft} icon={l.online ? 'wifi' : 'cloud-offline'} />
                {!l.bookingEnabled ? <Pill text="Ngưng đặt chỗ" color="#B45309" bg="#FEF3C7" /> : null}
              </View>
              <Text style={L.sub} numberOfLines={1}>Mã {l.id}{l.address ? ` • ${l.address}` : ''}</Text>
              <View style={styles.stats}>
                <Stat value={`${l.freeSlots}/${l.totalSlots}`} label="Ô trống" />
                <Stat value={l.occupied} label="Có xe" />
                <Stat value={l.reserved} label="Giữ chỗ" />
                <Stat value={l.carsInLot} label="Xe trong bãi" />
                <Stat value={formatVND(l.revenueToday)} label="Hôm nay" />
              </View>
              <Text style={L.sub}>
                {formatVND(l.pricePerHour)}/giờ • {l.rating?.count ? `★ ${l.rating.average} (${l.rating.count})` : 'chưa có đánh giá'}
                {' • '}{l.fwVersion ? `FW ${l.fwVersion}` : 'chưa rõ firmware'}{l.lastSeenAt ? ` • tín hiệu ${timeAgo(l.lastSeenAt)}` : ''}
              </Text>
              <Text style={styles.group}>Barie</Text>
              <View style={L.actions}>
                {['entry', 'exit'].map((g) => (
                  <View key={g} style={styles.gate}>
                    <Text style={styles.gateLabel}>{g === 'entry' ? 'Cổng vào' : 'Cổng ra'}: {l.gates?.[g] === 'open' ? 'mở' : 'đóng'}</Text>
                    <View style={L.row}>
                      <SmallButton icon="arrow-up" label="Mở" disabled={!l.online} loading={busy === `${l.id}:${g}:open`} onPress={() => gate(l, g, 'open')} />
                      <SmallButton icon="arrow-down" label="Đóng" tone="muted" disabled={!l.online} loading={busy === `${l.id}:${g}:close`} onPress={() => gate(l, g, 'close')} />
                    </View>
                  </View>
                ))}
              </View>
              <View style={L.actions}>
                <SmallButton icon="create-outline" label="Sửa" onPress={() => setForm({
                  mode: 'edit', id: l.id, name: l.name, address: l.address || '', pricePerHour: String(l.pricePerHour), totalSlots: String(l.totalSlots),
                })} />
                <SmallButton icon={l.bookingEnabled ? 'pause' : 'play'} label={l.bookingEnabled ? 'Ngưng đặt chỗ' : 'Mở đặt chỗ'}
                  tone={l.bookingEnabled ? 'muted' : 'success'} loading={busy === `${l.id}:booking`} onPress={() => toggleBooking(l)} />
                <SmallButton icon="grid-outline" label="Sơ đồ" onPress={() => navigation.navigate('SetupParkingLot', { lotId: l.id })} />
                <SmallButton icon="trash-outline" label="Xoá" tone="danger" onPress={() => setConfirm({
                  title: `Xoá bãi “${l.name}”?`, label: 'Xoá', danger: true,
                  message: 'Chỉ xoá được bãi chưa có lịch sử đặt chỗ / gửi xe. Bãi đã hoạt động: hãy dùng “Ngưng đặt chỗ”.',
                  run: () => adminApi.deleteLot(l.id), done: `Đã xoá bãi ${l.name}.`,
                })} />
              </View>
            </Card>
          )}
        />
      )}

      {form ? (
        <LotForm form={form} onClose={() => setForm(null)} onSaved={(msg) => { setForm(null); setNotice({ type: 'success', text: msg }); load(); }} />
      ) : null}
      <PromptDialog visible={!!confirm} title={confirm?.title} message={confirm?.message} confirmLabel={confirm?.label} danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => { await confirm.run(); setNotice({ type: 'success', text: confirm.done }); setConfirm(null); load(); }} />
    </ScreenShell>
  );
}

function LotForm({ form: initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (t) => setF((x) => ({ ...x, [k]: t }));
  const create = f.mode === 'create';

  async function save() {
    setErr(null);
    const price = Number(f.pricePerHour);
    const slots = Number(f.totalSlots);
    if (create && !/^[a-zA-Z0-9_-]{3,50}$/.test(f.id.trim())) return setErr('Mã bãi 3-50 ký tự: chữ, số, - hoặc _ (trùng PARKING_ID trong firmware ESP32).');
    if (!f.name.trim()) return setErr('Vui lòng nhập tên bãi.');
    if (!Number.isInteger(price) || price < 0) return setErr('Giá/giờ không hợp lệ.');
    if (!Number.isInteger(slots) || slots < 1 || slots > 100) return setErr('Số ô từ 1 đến 100.');
    setSaving(true);
    try {
      const body = { name: f.name.trim(), address: f.address.trim(), pricePerHour: price, totalSlots: slots };
      if (create) await adminApi.createLot({ id: f.id.trim(), ...body, address: body.address || undefined });
      else await adminApi.updateLot(f.id, body);
      onSaved(create ? `Đã thêm bãi ${body.name}.` : `Đã lưu thay đổi cho ${body.name}.`);
    } catch (e) {
      setErr(e.code === 'slots_in_use' && e.details?.slots
        ? `Không giảm được: ô ${e.details.slots.join(', ')} đã có lịch sử đặt chỗ / gửi xe.` : e.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{create ? 'Thêm bãi đỗ' : `Sửa bãi ${f.id}`}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {create ? <TextField label="Mã bãi (PARKING_ID)" value={f.id} onChangeText={set('id')} placeholder="vd sp-hai-chau-02" /> : null}
            <TextField label="Tên bãi" value={f.name} onChangeText={set('name')} autoCapitalize="sentences" />
            <TextField label="Địa chỉ" value={f.address} onChangeText={set('address')} autoCapitalize="sentences" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextField label="Giá / giờ (đ)" value={f.pricePerHour} onChangeText={(t) => set('pricePerHour')(t.replace(/\D/g, ''))} keyboardType="number-pad" style={{ flex: 1 }} />
              <TextField label="Số ô" value={f.totalSlots} onChangeText={(t) => set('totalSlots')(t.replace(/\D/g, ''))} keyboardType="number-pad" style={{ flex: 1 }}
                hint={create ? 'Chia khu A/B tự động' : 'Giảm: chỉ bỏ ô chưa dùng'} />
            </View>
            {err ? <Notice type="error">{err}</Notice> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Huỷ" variant="outline" onPress={onClose} disabled={saving} style={{ flex: 1, height: 46 }} />
            <Button title={create ? 'Thêm bãi' : 'Lưu'} onPress={save} loading={saving} style={{ flex: 1, height: 46 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Stat({ value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.sValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.sLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', marginVertical: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  sValue: { fontSize: 13.5, fontWeight: '900', color: colors.text },
  sLabel: { fontSize: 10.5, color: colors.textMuted, marginTop: 1 },
  group: { fontSize: 11.5, fontWeight: '800', color: colors.textMuted, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  gate: { gap: 4 },
  gateLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, gap: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 4 },
});
