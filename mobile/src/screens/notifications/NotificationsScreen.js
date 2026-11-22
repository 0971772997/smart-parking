// THONG BAO TRONG APP: dat cho, xe den, het han, thanh toan, nhac gio...
//   - Loc Tat ca / Chua doc (kem bo dem), bam 1 thong bao -> danh dau da doc + mo phien gui xe / dat cho / bien nhan
//   - "Doc tat ca"; nut cai dat -> bat/tat tung nhom thong bao day, gui thu
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Notice from '../../components/Notice';
import OfflineBanner from '../../components/OfflineBanner';
import { openNotification } from '../../components/NotificationToast';
import { notificationsApi } from '../../api/sessions';
import { useLive, useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { NOTE_TYPE, timeAgo } from '../../utils/session';

export default function NotificationsScreen({ navigation }) {
  const { unread, setUnread, markAllRead } = useLive();
  const [filter, setFilter] = useState('all'); // all | unread
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await notificationsApi.list({ limit: 100, unread: filter === 'unread' });
      setItems(r.items);
      setUnread(r.unread);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [filter, setUnread]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load);

  async function open(n) {
    if (!n.read) {
      setItems((list) => (filter === 'unread' ? list.filter((x) => x.id !== n.id) : list.map((x) => (x.id === n.id ? { ...x, read: true } : x))));
      notificationsApi.read({ ids: [n.id] }).then((r) => setUnread(r.unread)).catch(() => {});
    }
    if (n.sessionId || n.reservationId || n.data?.paymentId) openNotification(n);
  }

  async function readAll() {
    await markAllRead();
    setItems((list) => (filter === 'unread' ? [] : (list || []).map((x) => ({ ...x, read: true }))));
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.webContainer}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Thông báo</Text>
          {unread > 0 ? (
            <Pressable onPress={readAll} hitSlop={8} style={styles.readAll} accessibilityRole="button">
              <Ionicons name="checkmark-done" size={16} color={colors.primary} />
              <Text style={styles.readAllText}>Đọc tất cả</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => navigation.navigate('NotificationSettings')} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Cài đặt thông báo">
            <Ionicons name="settings-outline" size={19} color={colors.text} />
          </Pressable>
        </View>
        <OfflineBanner />

        <View style={styles.tabs}>
          {[['all', 'Tất cả'], ['unread', 'Chưa đọc']].map(([k, label]) => (
            <Pressable key={k} onPress={() => { setItems(null); setFilter(k); }} style={[styles.tab, filter === k && styles.tabOn]}
              accessibilityRole="tab" accessibilityState={{ selected: filter === k }}>
              <Text style={[styles.tabText, filter === k && styles.tabTextOn]}>{label}</Text>
              {k === 'unread' && unread > 0 ? (
                <View style={styles.count}><Text style={styles.countText}>{unread > 99 ? '99+' : unread}</Text></View>
              ) : null}
            </Pressable>
          ))}
        </View>

        {items === null && !error ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <FlatList
            data={items || []}
            keyExtractor={(n) => String(n.id)}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListHeaderComponent={error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}
            ListEmptyComponent={!error ? (
              <View style={styles.empty}>
                <Ionicons name={filter === 'unread' ? 'checkmark-done-circle-outline' : 'notifications-off-outline'} size={40} color="#CBD5E1" />
                <Text style={styles.emptyText}>{filter === 'unread' ? 'Bạn đã đọc hết thông báo.' : 'Chưa có thông báo nào.'}</Text>
                <Text style={styles.emptySub}>Thông báo đặt chỗ, xe đến, hết hạn và thanh toán sẽ hiện ở đây.</Text>
              </View>
            ) : null}
            renderItem={({ item: n }) => {
              const t = NOTE_TYPE[n.type] || { icon: 'notifications', color: colors.primary };
              return (
                <Pressable onPress={() => open(n)}
                  style={({ pressed }) => [styles.item, !n.read && styles.itemUnread, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button" accessibilityLabel={`${n.read ? '' : 'Chưa đọc. '}${n.title}. ${n.body || ''}`}>
                  <View style={[styles.icon, { backgroundColor: `${t.color}1A` }]}>
                    <Ionicons name={t.icon} size={18} color={t.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.title, n.read && styles.titleRead]} numberOfLines={1}>{n.title}</Text>
                      <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
                    </View>
                    {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
                  </View>
                  {!n.read ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  webContainer: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: '100vh' } : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  readAll: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  readAllText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: '#F1F5F9' },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  tabTextOn: { color: '#fff' },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 10.5, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  item: { flexDirection: 'row', gap: 10, padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  itemUnread: { borderColor: '#BFDBFE', backgroundColor: '#F8FBFF' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  titleRead: { fontWeight: '600', color: '#334155' },
  time: { fontSize: 11.5, color: '#94A3B8' },
  body: { fontSize: 12.5, color: colors.textMuted, marginTop: 3, lineHeight: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 6 },
  emptyText: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
