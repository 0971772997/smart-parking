// DANH GIA BAI DO: diem trung binh, phan bo sao (bam de loc), the noi bat, danh sach danh gia + phan hoi cua quan ly.
// Tai xe da gui xe o bai -> Viet / sua danh gia. Quan tri -> phan hoi danh gia.
// params: { lotId, lotName? }
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import StarRating from '../../components/StarRating';
import { reviewsApi } from '../../api/feedback';
import { useAuth } from '../../context/AuthContext';
import { colors, radius } from '../../theme';
import { timeAgo } from '../../utils/session';

const PAGE = 20;

export default function LotReviewsScreen({ navigation, route }) {
  const { lotId, lotName } = route.params || {};
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await reviewsApi.list(lotId, { limit: PAGE, rating: filter || undefined });
      setData(d);
      setItems(d.items);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [lotId, filter]);
  // Mo man / quay lai tu man viet danh gia / doi bo loc -> tai lai
  useFocusEffect(useCallback(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]));

  async function more() {
    if (!data?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await reviewsApi.list(lotId, { limit: PAGE, offset: items.length, rating: filter || undefined });
      setItems((cur) => [...cur, ...d.items.filter((x) => !cur.some((c) => c.id === x.id))]);
      setData((cur) => ({ ...cur, hasMore: d.hasMore }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const s = data?.summary;
  const title = data?.lotName || lotName || 'Bãi đỗ';

  return (
    <ScreenShell navigation={navigation} title="Đánh giá & phản hồi" subtitle={title}>
      {!data && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={styles.content}
          onEndReached={more}
          onEndReachedThreshold={0.3}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={(
            <>
              {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
              {s ? (
                <View style={styles.summary}>
                  <View style={styles.avgBox}>
                    <Text style={styles.avg}>{s.average != null ? s.average.toFixed(1) : '–'}</Text>
                    <StarRating value={s.average || 0} size={15} />
                    <Text style={styles.count}>{s.count} đánh giá</Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    {[5, 4, 3, 2, 1].map((n) => {
                      const c = s.distribution[n] || 0;
                      const on = filter === n;
                      return (
                        <Pressable key={n} onPress={() => setFilter(on ? null : n)} style={[styles.distRow, on && styles.distOn]}
                          accessibilityRole="button" accessibilityLabel={`Lọc ${n} sao`}>
                          <Text style={styles.distN}>{n}</Text>
                          <Ionicons name="star" size={11} color="#F59E0B" />
                          <View style={styles.bar}><View style={[styles.barFill, { width: `${s.count ? (c / s.count) * 100 : 0}%` }]} /></View>
                          <Text style={styles.distC}>{c}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              {s?.topTags?.length ? (
                <View style={styles.tags}>
                  {s.topTags.map((t) => (
                    <View key={t.tag} style={styles.tag}><Text style={styles.tagText}>{t.label} · {t.count}</Text></View>
                  ))}
                </View>
              ) : null}
              {!isAdmin ? (
                <Pressable onPress={() => navigation.navigate('ReviewForm', { lotId, lotName: title })} style={styles.writeBtn} accessibilityRole="button">
                  <Ionicons name={data?.mine ? 'create-outline' : 'star'} size={17} color="#fff" />
                  <Text style={styles.writeText}>{data?.mine ? 'Sửa đánh giá của bạn' : 'Viết đánh giá'}</Text>
                </Pressable>
              ) : null}
              {filter ? (
                <Pressable onPress={() => setFilter(null)} style={styles.filterPill}>
                  <Text style={styles.filterText}>Đang lọc: {filter} sao</Text>
                  <Ionicons name="close-circle" size={15} color={colors.primary} />
                </Pressable>
              ) : null}
            </>
          )}
          ListEmptyComponent={data && !error ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={40} color="#CBD5E1" />
              <Text style={styles.emptyText}>{filter ? 'Không có đánh giá phù hợp.' : 'Chưa có đánh giá nào cho bãi này.'}</Text>
            </View>
          ) : null}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} /> : null}
          renderItem={({ item }) => (
            <ReviewCard r={item} tags={data?.tags || {}} isAdmin={isAdmin}
              onReplied={(upd) => setItems((cur) => cur.map((x) => (x.id === upd.id ? { ...x, reply: upd.reply } : x)))} />
          )}
        />
      )}
    </ScreenShell>
  );
}

function ReviewCard({ r, tags, isAdmin, onReplied }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState(r.reply?.text || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function send() {
    setSaving(true);
    setErr(null);
    try {
      onReplied(await reviewsApi.reply(r.id, text.trim() || null));
      setReplying(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.card, r.mine && styles.cardMine]}>
      <View style={styles.cardTop}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(r.author || '?')[0].toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>{r.author}{r.mine ? ' (bạn)' : ''}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StarRating value={r.rating} size={12} />
            <Text style={styles.when}>{timeAgo(r.updatedAt)}{r.edited ? ' • đã sửa' : ''}</Text>
          </View>
        </View>
      </View>
      {r.tags.length ? (
        <View style={styles.cardTags}>
          {r.tags.map((t) => <Text key={t} style={styles.cardTag}>{tags[t] || t}</Text>)}
        </View>
      ) : null}
      {r.comment ? <Text style={styles.comment}>{r.comment}</Text> : null}
      {r.reply && !replying ? (
        <View style={styles.reply}>
          <Text style={styles.replyHead}><Ionicons name="business" size={12} color={colors.primaryDark} />  Phản hồi từ quản lý bãi</Text>
          <Text style={styles.replyText}>{r.reply.text}</Text>
        </View>
      ) : null}
      {isAdmin ? (
        replying ? (
          <View style={{ marginTop: 8 }}>
            <TextInput value={text} onChangeText={setText} placeholder="Nhập phản hồi cho tài xế..." multiline maxLength={1000}
              style={styles.replyInput} placeholderTextColor={colors.placeholder} />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <Pressable onPress={() => setReplying(false)} style={styles.smallBtn}><Text style={styles.smallBtnText}>Huỷ</Text></Pressable>
              <Pressable onPress={send} disabled={saving} style={[styles.smallBtn, styles.smallBtnPrimary]}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.smallBtnText, { color: '#fff' }]}>Gửi phản hồi</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setReplying(true)} style={styles.replyLink}>
            <Ionicons name="return-down-forward" size={14} color={colors.primary} />
            <Text style={styles.replyLinkText}>{r.reply ? 'Sửa phản hồi' : 'Phản hồi'}</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  summary: { flexDirection: 'row', gap: 16, backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: '#EEF2F7', marginBottom: 10 },
  avgBox: { alignItems: 'center', justifyContent: 'center', minWidth: 90 },
  avg: { fontSize: 38, fontWeight: '900', color: colors.text },
  count: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
  distOn: { backgroundColor: colors.primarySoft },
  distN: { fontSize: 12, fontWeight: '700', color: colors.text, width: 10 },
  bar: { flex: 1, height: 7, borderRadius: 4, backgroundColor: '#EEF2F7', overflow: 'hidden', marginHorizontal: 4 },
  barFill: { height: '100%', backgroundColor: '#F59E0B', borderRadius: 4 },
  distC: { fontSize: 11.5, color: colors.textMuted, width: 22, textAlign: 'right' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: '#FEF3C7' },
  tagText: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  writeBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: radius.md, backgroundColor: colors.primary, marginBottom: 12 },
  writeText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  filterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft, marginBottom: 10 },
  filterText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EEF2F7' },
  cardMine: { borderColor: '#C7D2FE' },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '900', color: colors.primary },
  author: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  when: { fontSize: 11.5, color: '#94A3B8' },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  cardTag: { fontSize: 11.5, fontWeight: '700', color: colors.textMuted, backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  comment: { fontSize: 13.5, color: colors.text, marginTop: 8, lineHeight: 19 },
  reply: { marginTop: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  replyHead: { fontSize: 12, fontWeight: '800', color: colors.primaryDark },
  replyText: { fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 18 },
  replyLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  replyLinkText: { fontSize: 12.5, fontWeight: '800', color: colors.primary },
  replyInput: { minHeight: 70, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, padding: 10, fontSize: 13.5, color: colors.text, textAlignVertical: 'top' },
  err: { color: colors.danger, fontSize: 12, marginTop: 4 },
  smallBtn: { flex: 1, height: 38, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  smallBtnPrimary: { backgroundColor: colors.primary },
  smallBtnText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyText: { fontSize: 13.5, fontWeight: '700', color: colors.textMuted },
});
