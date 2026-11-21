// THONG BAO: phien gui xe (bat dau, vao o, roi o, ra bai), thay doi chi phi, sap het gio / qua gio, dat cho het han...
// Mo man hinh -> danh dau da doc tat ca. Bam 1 thong bao -> mo phien gui xe / dat cho lien quan.
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
  const { markAllRead } = useLive();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await notificationsApi.list({ limit: 50 });
      setItems(r.items);
      setError(null);
      if (r.unread) markAllRead();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [markAllRead]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useOnLiveChange(load);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.webContainer}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Thông báo</Text>
        </View>
        <OfflineBanner />
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
                <Ionicons name="notifications-off-outline" size={40} color="#CBD5E1" />
                <Text style={styles.emptyText}>Chưa có thông báo nào.</Text>
                <Text style={styles.emptySub}>Thông báo về phiên gửi xe và chi phí sẽ hiện ở đây.</Text>
              </View>
            ) : null}
            renderItem={({ item: n }) => {
              const t = NOTE_TYPE[n.type] || { icon: 'notifications', color: colors.primary };
              const link = n.sessionId || n.reservationId;
              return (
                <Pressable onPress={link ? () => openNotification(n) : undefined}
                  style={({ pressed }) => [styles.item, !n.read && styles.itemUnread, pressed && link && { opacity: 0.85 }]}
                  accessibilityRole={link ? 'button' : 'text'}>
                  <View style={[styles.icon, { backgroundColor: `${t.color}1A` }]}>
                    <Ionicons name={t.icon} size={18} color={t.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.title} numberOfLines={1}>{n.title}</Text>
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
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  item: { flexDirection: 'row', gap: 10, padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  itemUnread: { borderColor: '#BFDBFE', backgroundColor: '#F8FBFF' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  time: { fontSize: 11.5, color: '#94A3B8' },
  body: { fontSize: 12.5, color: colors.textMuted, marginTop: 3, lineHeight: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 6 },
  emptyText: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
