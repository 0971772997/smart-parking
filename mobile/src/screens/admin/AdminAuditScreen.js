// QUAN TRI - NHAT KY: ai da lam gi, luc nao (khoa tai khoan, sua bai, huy dat cho, mien phi, gui thong bao...)
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { Card, Empty, listStyles as L, usePagedList } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { colors } from '../../theme';
import { formatDateTime } from '../../utils/booking';

const ICON = { user: 'person', lot: 'business', reservation: 'ticket', session: 'car-sport', review: 'star', broadcast: 'megaphone', ticket: 'help-buoy' };
const KEY_LABEL = {
  reason: 'Lý do', note: 'Ghi chú', email: 'Email', name: 'Tên', from: 'Từ', to: 'Thành', code: 'Mã', title: 'Tiêu đề',
  recipients: 'Người nhận', waive: 'Miễn phí', fee: 'Phí', gate: 'Cổng', action: 'Lệnh', method: 'Hình thức', amount: 'Số tiền',
  pricePerHour: 'Giá/giờ', totalSlots: 'Số ô', bookingEnabled: 'Nhận đặt chỗ', audience: 'Gửi tới', reply: 'Phản hồi', rating: 'Sao',
};

// Chi tiet -> 1 dong ngan, bo gia tri rong
const describe = (d = {}) => Object.entries(d)
  .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
  .map(([k, v]) => `${KEY_LABEL[k] || k}: ${v === true ? 'có' : v === false ? 'không' : v}`).join(' • ');

export default function AdminAuditScreen({ navigation }) {
  // API nhat ky tra ve mang -> boc thanh { items, total } cho danh sach phan trang
  const list = usePagedList(async ({ limit, offset }) => {
    const items = await adminApi.audit({ limit, offset });
    return { items, total: items.length === limit ? offset + limit + 1 : offset + items.length };
  }, [], 40);

  return (
    <ScreenShell navigation={navigation} title="Nhật ký quản trị" subtitle="Thao tác của các quản trị viên">
      {list.loading ? <View style={L.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={list.items || []}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={L.content}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.refreshing} tintColor={colors.primary} onRefresh={list.refresh} />}
          ListHeaderComponent={list.error ? <Notice type="error" actionLabel="Thử lại" onAction={list.reload}>{list.error}</Notice> : null}
          ListEmptyComponent={!list.error ? <Empty icon="document-text-outline" text="Chưa có thao tác nào." /> : null}
          ListFooterComponent={list.more ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item: a }) => (
            <Card style={{ flexDirection: 'row', gap: 10 }}>
              <Ionicons name={ICON[a.targetType] || 'ellipse'} size={18} color={colors.primary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={L.title}>{a.label}{a.targetId ? ` • ${a.targetType} ${a.targetId}` : ''}</Text>
                {describe(a.detail) ? <Text style={L.sub}>{describe(a.detail)}</Text> : null}
                <Text style={[L.sub, { color: '#94A3B8' }]}>{a.admin} • {formatDateTime(a.createdAt)}</Text>
              </View>
            </Card>
          )}
        />
      )}
    </ScreenShell>
  );
}
