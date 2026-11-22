// BAI DO YEU THICH: cho trong hien tai, diem danh gia, dat cho nhanh / xem so do / danh gia; bo khoi yeu thich
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import StarRating from '../../components/StarRating';
import { favoritesApi } from '../../api/feedback';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { formatVND } from '../../utils/schedules';

export default function FavoritesScreen({ navigation }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await favoritesApi.list());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load);

  async function remove(lot) {
    setRemoving(lot.id);
    try {
      await favoritesApi.remove(lot.id);
      setItems((cur) => cur.filter((l) => l.id !== lot.id));
      setNotice({ type: 'success', text: `Đã xoá “${lot.name}” khỏi danh sách yêu thích.`, lot });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setRemoving(null);
    }
  }

  async function undo() {
    const lot = notice?.lot;
    setNotice(null);
    if (!lot) return;
    try {
      await favoritesApi.add(lot.id);
      load();
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    }
  }

  return (
    <ScreenShell navigation={navigation} title="Bãi đỗ yêu thích" subtitle={items ? `${items.length} bãi đã lưu` : null}>
      {items === null && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={items || []}
          keyExtractor={(l) => l.id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={(
            <>
              {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
              {notice ? (
                <Notice type={notice.type} actionLabel={notice.lot ? 'Hoàn tác' : undefined} onAction={undo}>{notice.text}</Notice>
              ) : null}
            </>
          )}
          ListEmptyComponent={!error ? (
            <View style={styles.empty}>
              <Ionicons name="heart-outline" size={44} color="#CBD5E1" />
              <Text style={styles.emptyTitle}>Chưa có bãi yêu thích</Text>
              <Text style={styles.emptySub}>Bấm biểu tượng ♡ trên thẻ bãi đỗ ở trang chủ để lưu lại bãi bạn hay gửi xe.</Text>
            </View>
          ) : null}
          renderItem={({ item: l }) => {
            const full = (l.freeSlots ?? 0) === 0;
            return (
              <View style={styles.card}>
                <View style={styles.top}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{l.name}</Text>
                    {l.address ? <Text style={styles.addr} numberOfLines={1}>{l.address}</Text> : null}
                    <Pressable onPress={() => navigation.navigate('LotReviews', { lotId: l.id, lotName: l.name })} style={styles.ratingRow} hitSlop={6}>
                      <StarRating value={l.rating?.average || 0} size={13} />
                      <Text style={styles.ratingText}>
                        {l.rating?.count ? `${l.rating.average.toFixed(1)} (${l.rating.count} đánh giá)` : 'Chưa có đánh giá'}
                      </Text>
                    </Pressable>
                  </View>
                  <Pressable onPress={() => remove(l)} disabled={removing === l.id} style={styles.heart} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel={`Bỏ yêu thích ${l.name}`}>
                    {removing === l.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Ionicons name="heart" size={20} color="#E11D48" />}
                  </Pressable>
                </View>
                <View style={styles.stats}>
                  <Text style={[styles.free, { color: !l.online ? colors.textMuted : full ? colors.danger : colors.success }]}>
                    {!l.online ? 'Tạm ngưng' : full ? 'Hết chỗ' : `${l.freeSlots}/${l.totalSlots} chỗ trống`}
                  </Text>
                  <Text style={styles.price}>{formatVND(l.pricePerHour)}/giờ</Text>
                </View>
                <View style={styles.actions}>
                  <Action icon="grid-outline" label="Sơ đồ" onPress={() => navigation.navigate('SetupParkingLot', { lotId: l.id })} />
                  <Action icon="star-outline" label="Đánh giá" onPress={() => navigation.navigate('LotReviews', { lotId: l.id, lotName: l.name })} />
                  <Action icon="calendar" label="Đặt chỗ" primary disabled={full || !l.online}
                    onPress={() => navigation.navigate('Booking', { lotId: l.id })} />
                </View>
              </View>
            );
          }}
        />
      )}
    </ScreenShell>
  );
}

function Action({ icon, label, onPress, primary, disabled }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.btn, primary && styles.btnPrimary, disabled && { opacity: 0.4 }]}
      accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
      <Ionicons name={icon} size={14} color={primary ? '#fff' : colors.primary} />
      <Text style={[styles.btnText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EEF2F7' },
  top: { flexDirection: 'row', gap: 10 },
  name: { fontSize: 15, fontWeight: '800', color: colors.text },
  addr: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, alignSelf: 'flex-start' },
  ratingText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  heart: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFF1F2', alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  free: { fontSize: 13, fontWeight: '800' },
  price: { fontSize: 13, fontWeight: '800', color: colors.text },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: 12.5, fontWeight: '800', color: colors.primary },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.textMuted },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 19 },
});
