// QUAN TRI - NGUOI DUNG: tim theo ten / email / SDT / bien so, loc quyen + trang thai; bam -> chi tiet
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { Card, Chips, Empty, Pill, SearchBar, listStyles as L, usePagedList } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { useDebounced } from '../../hooks/useDebounced';
import { colors } from '../../theme';
import { formatVND } from '../../utils/schedules';
import { timeAgo } from '../../utils/session';

const FILTERS = [
  { key: '', label: 'Tất cả' },
  { key: 'user', label: 'Tài xế' },
  { key: 'admin', label: 'Quản trị' },
  { key: 'locked', label: 'Bị khoá', icon: 'lock-closed' },
];

export default function AdminUsersScreen({ navigation }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const query = useDebounced(q, 350);
  const list = usePagedList(({ limit, offset }) => adminApi.users({
    q: query, limit, offset, role: filter === 'locked' ? undefined : filter, status: filter === 'locked' ? 'locked' : undefined,
  }), [query, filter]);

  return (
    <ScreenShell navigation={navigation} title="Người dùng" subtitle={list.items ? `${list.total} tài khoản` : null}>
      {list.loading ? <View style={L.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={list.items || []}
          keyExtractor={(u) => String(u.id)}
          contentContainerStyle={L.content}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.refreshing} tintColor={colors.primary} onRefresh={list.refresh} />}
          ListHeaderComponent={(
            <>
              <SearchBar value={q} onChange={setQ} placeholder="Tên, email, SĐT, biển số xe..." />
              <Chips options={FILTERS} value={filter} onChange={setFilter} />
              {list.error ? <Notice type="error" actionLabel="Thử lại" onAction={list.reload}>{list.error}</Notice> : null}
            </>
          )}
          ListEmptyComponent={!list.error ? <Empty icon="people-outline" text="Không có tài khoản phù hợp." /> : null}
          ListFooterComponent={list.more ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item: u }) => (
            <Card onPress={() => navigation.navigate('AdminUserDetail', { id: u.id })}>
              <View style={L.row}>
                <Text style={[L.title, { flexShrink: 1 }]} numberOfLines={1}>{u.fullName || u.username || u.email}</Text>
                {u.role === 'admin' ? <Pill text="Quản trị" color={colors.primary} bg={colors.primarySoft} icon="shield" /> : null}
                {u.locked ? <Pill text="Bị khoá" color={colors.danger} bg={colors.dangerSoft} icon="lock-closed" /> : null}
              </View>
              <Text style={L.sub} numberOfLines={1}>{u.email}{u.phone ? ` • ${u.phone}` : ''}</Text>
              <Text style={L.sub}>
                {u.stats.sessions} lượt gửi • {u.stats.reservations} đặt chỗ • {u.stats.vehicles} xe • đã trả {formatVND(u.stats.totalPaid)}
              </Text>
              <Text style={[L.sub, { color: '#94A3B8' }]}>
                Tạo {timeAgo(u.createdAt)}{u.stats.lastActiveAt ? ` • hoạt động ${timeAgo(u.stats.lastActiveAt)}` : ''}
              </Text>
            </Card>
          )}
        />
      )}
    </ScreenShell>
  );
}
