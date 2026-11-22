// VIET / SUA DANH GIA BAI DO: so sao, the nhanh (diem tot / can cai thien), nhan xet. Chi tai xe da gui xe o bai.
// params: { lotId, lotName? }
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell, { HeaderButton } from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import StarRating from '../../components/StarRating';
import { reviewsApi } from '../../api/feedback';
import { colors, radius } from '../../theme';

const GOOD = ['clean', 'safe', 'easy_find', 'staff', 'price', 'gate_fast', 'accurate'];
const BAD = ['dirty', 'narrow', 'hard_find', 'slow_gate', 'wrong_status', 'expensive', 'dark'];
const RATING_TEXT = { 1: 'Rất tệ', 2: 'Chưa tốt', 3: 'Bình thường', 4: 'Tốt', 5: 'Tuyệt vời' };

export default function ReviewFormScreen({ navigation, route }) {
  const { lotId, lotName } = route.params || {};
  const [info, setInfo] = useState(null);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    reviewsApi.mine(lotId).then((d) => {
      if (!alive) return;
      setInfo(d);
      if (d.review) {
        setRating(d.review.rating);
        setTags(d.review.tags);
        setComment(d.review.comment || '');
      }
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [lotId]);

  const toggle = (t) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 8 ? cur : [...cur, t]));

  async function save() {
    if (!rating) { setError('Vui lòng chọn số sao.'); return; }
    setSaving(true);
    setError(null);
    try {
      await reviewsApi.save(lotId, { rating, tags, comment: comment.trim() || undefined });
      navigation.goBack();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await reviewsApi.remove(lotId);
      setConfirmDelete(false);
      navigation.goBack();
    } catch (e) {
      setError(e.message);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const name = info?.lotName || lotName;
  const labels = info?.tags || {};
  return (
    <ScreenShell navigation={navigation} title={info?.review ? 'Sửa đánh giá' : 'Đánh giá bãi đỗ'} subtitle={name}
      right={info?.review ? <HeaderButton icon="trash-outline" color={colors.danger} label="Xoá đánh giá" onPress={() => setConfirmDelete(true)} /> : null}>
      {!info && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Notice type="error">{error}</Notice> : null}
          {info && !info.eligible ? (
            <View style={styles.locked}>
              <Ionicons name="lock-closed-outline" size={34} color="#94A3B8" />
              <Text style={styles.lockedTitle}>Chưa thể đánh giá</Text>
              <Text style={styles.lockedText}>Chỉ tài xế đã gửi xe tại {name || 'bãi này'} mới có thể đánh giá, để đảm bảo đánh giá trung thực.</Text>
              <Button title="Quay lại" variant="outline" onPress={() => navigation.goBack()} style={{ alignSelf: 'stretch', marginTop: 12 }} />
            </View>
          ) : info ? (
            <>
              <View style={styles.card}>
                <Text style={styles.q}>Bạn đánh giá bãi đỗ này thế nào?</Text>
                <View style={{ alignItems: 'center', marginVertical: 8 }}>
                  <StarRating value={rating} size={38} gap={8} onChange={setRating} />
                  <Text style={styles.ratingText}>{RATING_TEXT[rating] || 'Chạm để chọn số sao'}</Text>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.q}>Điểm tốt</Text>
                <View style={styles.tags}>
                  {GOOD.map((t) => <TagChip key={t} label={labels[t] || t} on={tags.includes(t)} onPress={() => toggle(t)} good />)}
                </View>
                <Text style={[styles.q, { marginTop: 12 }]}>Cần cải thiện</Text>
                <View style={styles.tags}>
                  {BAD.map((t) => <TagChip key={t} label={labels[t] || t} on={tags.includes(t)} onPress={() => toggle(t)} />)}
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.q}>Nhận xét / góp ý về cơ sở bãi đỗ</Text>
                <TextInput value={comment} onChangeText={setComment} multiline maxLength={1000} style={styles.input}
                  placeholder="VD: Lối vào rộng, dễ tìm ô; nên thêm đèn ở khu B..." placeholderTextColor={colors.placeholder} />
                <Text style={styles.counter}>{comment.length}/1000</Text>
              </View>
              <Text style={styles.note}>
                Đánh giá hiển thị công khai với tên rút gọn (vd “Nguyễn V.”). Gặp sự cố cần xử lý gấp? Hãy dùng mục Hỗ trợ → Báo cáo sự cố.
              </Text>
              <Button title={info.review ? 'Cập nhật đánh giá' : 'Gửi đánh giá'} onPress={save} loading={saving} disabled={!rating} />
            </>
          ) : null}
        </ScrollView>
      )}
      <ConfirmDialog visible={confirmDelete} danger title="Xoá đánh giá?" message="Đánh giá của bạn sẽ bị gỡ khỏi bãi đỗ này."
        confirmLabel="Xoá" loading={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </ScreenShell>
  );
}

function TagChip({ label, on, onPress, good }) {
  const c = good ? colors.success : '#D97706';
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && { borderColor: c, backgroundColor: good ? colors.successSoft : '#FFFBEB' }]}
      accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      {on ? <Ionicons name="checkmark" size={13} color={c} /> : null}
      <Text style={[styles.chipText, on && { color: c }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  q: { fontSize: 14, fontWeight: '800', color: colors.text },
  ratingText: { fontSize: 14, fontWeight: '700', color: '#B45309', marginTop: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  input: { minHeight: 100, marginTop: 8, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: 10, fontSize: 14, color: colors.text, textAlignVertical: 'top' },
  counter: { fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 4 },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginBottom: 14 },
  locked: { alignItems: 'center', padding: 24, gap: 6 },
  lockedTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  lockedText: { fontSize: 13.5, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
});
