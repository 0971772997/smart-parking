// GUI YEU CAU HO TRO / BAO CAO SU CO: chon loai -> danh muc -> bai do (+ o, luot gui xe lien quan) -> tieu de, mo ta.
// params: { kind?: 'support'|'incident', category?, lotId?, sessionId?, reservationId?, slotNumber? }
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import Button from '../../components/Button';
import { supportApi } from '../../api/feedback';
import { lotsApi } from '../../api/lots';
import { sessionsApi } from '../../api/sessions';
import { colors, radius } from '../../theme';
import { CATEGORY_ICON, DEFAULT_CATEGORIES } from '../../utils/support';
import { formatDateTime } from '../../utils/booking';

export default function SupportTicketFormScreen({ navigation, route }) {
  const p = route.params || {};
  const [kind, setKind] = useState(p.kind === 'incident' ? 'incident' : 'support');
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [category, setCategory] = useState(p.category || null);
  const [lots, setLots] = useState([]);
  const [lotId, setLotId] = useState(p.lotId || null);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(p.sessionId || null);
  const [slot, setSlot] = useState(p.slotNumber ? String(p.slotNumber) : '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supportApi.info().then((i) => i?.categories && setCategories(i.categories)).catch(() => {});
    lotsApi.list().then((l) => setLots(l || [])).catch(() => {});
    sessionsApi.mine().then((s) => setSessions((s || []).slice(0, 5))).catch(() => {});
  }, []);

  const cats = categories[kind] || {};
  const session = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);

  const switchKind = (k) => { setKind(k); setCategory(null); setError(null); };
  const pickSession = (s) => {
    if (sessionId === s.id) { setSessionId(null); return; }
    setSessionId(s.id);
    setLotId(s.lotId);
    if (!slot) setSlot(String(s.slotNumber));
  };
  const pickCategory = (k) => {
    setCategory(k);
    if (!subject.trim()) setSubject(cats[k] && k !== 'other' ? cats[k] : '');
  };

  async function submit() {
    setError(null);
    if (!category) return setError('Vui lòng chọn danh mục.');
    if (kind === 'incident' && !lotId) return setError('Vui lòng chọn bãi đỗ xảy ra sự cố.');
    if (subject.trim().length < 3) return setError('Tiêu đề tối thiểu 3 ký tự.');
    if (description.trim().length < 10) return setError('Mô tả tối thiểu 10 ký tự để chúng tôi hiểu rõ vấn đề.');
    const n = slot.trim() ? Number(slot) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1)) return setError('Số ô không hợp lệ.');
    setSaving(true);
    try {
      const t = await supportApi.create({
        kind, category, subject: subject.trim(), description: description.trim(),
        lotId: lotId || undefined, sessionId: sessionId || undefined, reservationId: p.reservationId || undefined,
        slotNumber: n || undefined,
      });
      navigation.replace('SupportTicket', { id: t.id, created: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  const incident = kind === 'incident';
  return (
    <ScreenShell navigation={navigation} title={incident ? 'Báo cáo sự cố' : 'Gửi yêu cầu hỗ trợ'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.kindRow}>
          <KindBtn on={!incident} icon="help-buoy" label="Yêu cầu hỗ trợ" color={colors.primary} onPress={() => switchKind('support')} />
          <KindBtn on={incident} icon="warning" label="Báo cáo sự cố" color={colors.danger} onPress={() => switchKind('incident')} />
        </View>
        {incident ? (
          <Notice type="info">Sự cố khẩn cấp (tai nạn, mất cắp, kẹt xe trong bãi)? Hãy gọi hotline 1900 6868 để được xử lý ngay.</Notice>
        ) : null}

        <Text style={styles.label}>Danh mục *</Text>
        <View style={styles.grid}>
          {Object.entries(cats).map(([k, label]) => (
            <Pressable key={k} onPress={() => pickCategory(k)} style={[styles.cat, category === k && styles.catOn]}
              accessibilityRole="radio" accessibilityState={{ selected: category === k }}>
              <Ionicons name={CATEGORY_ICON[k] || 'ellipse-outline'} size={18} color={category === k ? colors.primary : colors.textMuted} />
              <Text style={[styles.catText, category === k && { color: colors.primary }]} numberOfLines={2}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {sessions.length ? (
          <>
            <Text style={styles.label}>Lượt gửi xe liên quan (không bắt buộc)</Text>
            <View style={{ gap: 6 }}>
              {sessions.map((s) => (
                <Pressable key={s.id} onPress={() => pickSession(s)} style={[styles.ses, sessionId === s.id && styles.sesOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: sessionId === s.id }}>
                  <Ionicons name={sessionId === s.id ? 'radio-button-on' : 'radio-button-off'} size={18} color={sessionId === s.id ? colors.primary : '#CBD5E1'} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sesTitle} numberOfLines={1}>{s.lotName} • Ô #{s.slotNumber}</Text>
                    <Text style={styles.sesSub}>{formatDateTime(s.startedAt)}{s.reservationCode ? ` • ${s.reservationCode}` : ''}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Bãi đỗ {incident ? '*' : '(không bắt buộc)'}</Text>
        <View style={styles.lots}>
          {lots.map((l) => (
            <Pressable key={l.id} onPress={() => { setLotId(lotId === l.id && !session ? null : l.id); }} disabled={!!session}
              style={[styles.lot, lotId === l.id && styles.lotOn, session && lotId !== l.id && { opacity: 0.4 }]}>
              <Text style={[styles.lotText, lotId === l.id && { color: colors.primary }]} numberOfLines={1}>{l.name}</Text>
            </Pressable>
          ))}
          {!lots.length ? <Text style={styles.muted}>Đang tải danh sách bãi...</Text> : null}
        </View>

        {incident ? (
          <>
            <Text style={styles.label}>Số ô (nếu có)</Text>
            <TextInput value={slot} onChangeText={(t) => setSlot(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad"
              placeholder="VD: 3" placeholderTextColor={colors.placeholder} style={[styles.input, { width: 120 }]} />
          </>
        ) : null}

        <Text style={styles.label}>Tiêu đề *</Text>
        <TextInput value={subject} onChangeText={setSubject} maxLength={120} placeholder="Tóm tắt vấn đề"
          placeholderTextColor={colors.placeholder} style={styles.input} />
        <Text style={styles.label}>Mô tả chi tiết *</Text>
        <TextInput value={description} onChangeText={setDescription} maxLength={2000} multiline
          placeholder={incident ? 'Mô tả sự cố: xảy ra lúc nào, ở đâu, hiện trạng ra sao...' : 'Mô tả vấn đề bạn gặp, mã đơn/mã đặt chỗ nếu có...'}
          placeholderTextColor={colors.placeholder} style={[styles.input, styles.area]} />
        <Text style={styles.counter}>{description.length}/2000</Text>

        {error ? <Notice type="error">{error}</Notice> : null}
        <Button title={incident ? 'Gửi báo cáo sự cố' : 'Gửi yêu cầu'} onPress={submit} loading={saving}
          style={incident ? { backgroundColor: colors.danger } : null} />
      </ScrollView>
    </ScreenShell>
  );
}

function KindBtn({ on, icon, label, color, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.kind, on && { borderColor: color, backgroundColor: `${color}10` }]}
      accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Ionicons name={icon} size={18} color={on ? color : colors.textMuted} />
      <Text style={[styles.kindText, on && { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  kindRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  kind: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  kindText: { fontSize: 13.5, fontWeight: '800', color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 14, marginBottom: 8 },
  muted: { fontSize: 12.5, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: { width: '31.5%', minHeight: 70, padding: 8, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 4 },
  catOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  catText: { fontSize: 11.5, fontWeight: '700', color: colors.textMuted, textAlign: 'center' },
  ses: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  sesOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  sesTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  sesSub: { fontSize: 11.5, color: colors.textMuted, marginTop: 1 },
  lots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lot: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff', maxWidth: '100%' },
  lotOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  lotText: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: '#fff' },
  area: { minHeight: 120, textAlignVertical: 'top' },
  counter: { fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 4, marginBottom: 12 },
});
