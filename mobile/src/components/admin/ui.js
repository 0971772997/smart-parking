// Bo giao dien dung chung cho cac man quan tri: tim kiem, chip loc, the, nhan trang thai,
// hop thoai nhap ly do, danh sach phan trang (tai them khi cuon het).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from '../Button';
import { colors, radius } from '../../theme';

export function SearchBar({ value, onChange, placeholder }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color={colors.textMuted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.placeholder}
        style={styles.searchInput} autoCapitalize="none" autoCorrect={false} accessibilityLabel={placeholder} />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Xoá tìm kiếm">
          <Ionicons name="close-circle" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** options: [{ key, label }] */
export function Chips({ options, value, onChange, style }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, style]}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key || 'all'} onPress={() => onChange(o.key)} style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="button" accessibilityState={{ selected: on }}>
            {o.icon ? <Ionicons name={o.icon} size={13} color={on ? colors.primary : colors.textMuted} /> : null}
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Pill({ text, color = colors.textMuted, bg = '#F1F5F9', icon }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={color} /> : null}
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

export function Card({ children, style, onPress }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SmallButton({ icon, label, onPress, tone = 'primary', disabled, loading }) {
  const c = { primary: colors.primary, danger: colors.danger, success: colors.success, muted: colors.textMuted }[tone];
  return (
    <Pressable onPress={disabled || loading ? undefined : onPress} style={[styles.sBtn, { borderColor: c }, (disabled || loading) && { opacity: 0.45 }]}
      accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
      {loading ? <ActivityIndicator size="small" color={c} /> : (
        <>
          {icon ? <Ionicons name={icon} size={14} color={c} /> : null}
          <Text style={[styles.sBtnText, { color: c }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Empty({ icon = 'file-tray-outline', text }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color="#CBD5E1" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

/**
 * Hop thoai xac nhan co o nhap (ly do / ghi chu). input: { placeholder, required } | null
 * onConfirm(text) tra ve Promise; loi hien ngay trong hop thoai.
 */
export function PromptDialog({ visible, title, message, input, confirmLabel = 'Xác nhận', danger, onConfirm, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => { setText(''); setErr(null); }, 0);
    return () => clearTimeout(t);
  }, [visible]);

  async function go() {
    if (input?.required && !text.trim()) { setErr('Vui lòng nhập nội dung.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(text.trim());
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel}>
        <Pressable style={styles.dialog} onPress={() => {}}>
          <Text style={styles.dTitle}>{title}</Text>
          {message ? <Text style={styles.dMsg}>{message}</Text> : null}
          {input ? (
            <TextInput value={text} onChangeText={setText} placeholder={input.placeholder} placeholderTextColor={colors.placeholder}
              style={styles.dInput} multiline maxLength={200} />
          ) : null}
          {err ? <Text style={styles.dErr}>{err}</Text> : null}
          <View style={styles.dRow}>
            <Button title="Huỷ" variant="outline" onPress={onCancel} disabled={busy} style={styles.dBtn} />
            <Button title={confirmLabel} onPress={go} loading={busy} style={[styles.dBtn, danger && { backgroundColor: colors.danger }]} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Danh sach phan trang: fetcher({ limit, offset }) -> { items, total, ...extra }.
 * deps doi -> tai lai tu dau. Tra ve { items, extra, total, loading, refreshing, error, reload, refresh, more, setItems }
 */
export function usePagedList(fetcher, deps, pageSize = 30) {
  const [state, setState] = useState({ items: null, extra: null, total: 0, error: null, loading: true, refreshing: false, more: false });
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  const countRef = useRef(0);
  useEffect(() => { fetchRef.current = fetcher; });
  useEffect(() => { countRef.current = state.items?.length || 0; }, [state.items]);

  const load = useCallback(async (mode = 'reset') => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: mode === 'reset' && !s.items, refreshing: mode === 'refresh', more: mode === 'more' }));
    try {
      const offset = mode === 'more' ? countRef.current : 0;
      const d = await fetchRef.current({ limit: pageSize, offset });
      if (my !== seq.current) return;
      const { items, total, ...extra } = d;
      setState((s) => ({
        items: mode === 'more' ? [...(s.items || []), ...items.filter((x) => !(s.items || []).some((y) => y.id === x.id))] : items,
        total: total ?? items.length, extra, error: null, loading: false, refreshing: false, more: false,
      }));
    } catch (e) {
      if (my !== seq.current) return;
      setState((s) => ({ ...s, error: e.message, loading: false, refreshing: false, more: false }));
    }
  }, [pageSize]);

  useEffect(() => {
    const t = setTimeout(() => load('reset'), 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const hasMore = !!state.items && state.items.length < state.total;
  return {
    ...state,
    hasMore,
    reload: () => load('reset'),
    refresh: () => load('refresh'),
    loadMore: () => { if (hasMore && !state.more) load('more'); },
    setItems: (fn) => setState((s) => ({ ...s, items: fn(s.items || []) })),
  };
}

export const listStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  title: { fontSize: 14, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  count: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 8 },
  amount: { fontSize: 14.5, fontWeight: '900', color: colors.text },
});

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff', marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, outlineStyle: 'none' },
  chips: { gap: 8, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.primary },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 10.5, fontWeight: '800' },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#EEF2F7' },
  sBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.5, backgroundColor: '#fff', minWidth: 70, justifyContent: 'center' },
  sBtnText: { fontSize: 12.5, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyText: { fontSize: 13.5, fontWeight: '700', color: colors.textMuted, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: radius.lg, padding: 18 },
  dTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  dMsg: { fontSize: 13.5, color: colors.textMuted, marginTop: 6, lineHeight: 19 },
  dInput: { minHeight: 70, marginTop: 12, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: 10, fontSize: 14, color: colors.text, textAlignVertical: 'top' },
  dErr: { color: colors.danger, fontSize: 12.5, marginTop: 8 },
  dRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dBtn: { flex: 1, height: 44 },
});
