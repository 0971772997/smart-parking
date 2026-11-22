// QUAN TRI - DAT CHO: moi luot dat cho (loc trang thai, khoang ngay, tim ma / bien so / email), huy kem ly do
// params: { status? }
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import ScreenShell, { HeaderButton } from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import DateRangeModal from '../../components/DateRangeModal';
import { Card, Chips, Empty, Pill, PromptDialog, SearchBar, SmallButton, listStyles as L, usePagedList } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { useDebounced } from '../../hooks/useDebounced';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors } from '../../theme';
import { FAIL_REASONS, RESV_STATUS, formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { presetRange, ymdLabel } from '../../utils/dates';

const STATUS = [
  { key: '', label: 'Tất cả' },
  { key: 'active,pending', label: 'Đang giữ' },
  { key: 'fulfilled', label: 'Đã dùng' },
  { key: 'cancelled', label: 'Đã huỷ' },
  { key: 'expired', label: 'Không đến' },
  { key: 'failed', label: 'Lỗi' },
];
const REASONS = { ...FAIL_REASONS, admin_cancelled: 'Quản trị viên huỷ' };

export default function AdminReservationsScreen({ navigation, route }) {
  const [status, setStatus] = useState(route.params?.status || '');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(() => presetRange('30d'));
  const [picker, setPicker] = useState(false);
  const [cancel, setCancel] = useState(null);
  const [notice, setNotice] = useState(null);
  const query = useDebounced(q, 350);
  const list = usePagedList(({ limit, offset }) => adminApi.reservations({ status, q: query, ...range, limit, offset }), [status, query, range]);
  useOnLiveChange(list.refresh);

  return (
    <ScreenShell navigation={navigation} title="Đặt chỗ" subtitle={`${ymdLabel(range.from)} – ${ymdLabel(range.to)}${list.items ? ` • ${list.total} lượt` : ''}`}
      right={<HeaderButton icon="calendar-outline" label="Chọn khoảng ngày" onPress={() => setPicker(true)} />}>
      {list.loading ? <View style={L.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={list.items || []}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={L.content}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.refreshing} tintColor={colors.primary} onRefresh={list.refresh} />}
          ListHeaderComponent={(
            <>
              <SearchBar value={q} onChange={setQ} placeholder="Mã đặt chỗ, biển số, email, tên..." />
              <Chips options={STATUS} value={status} onChange={setStatus} />
              {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
              {list.error ? <Notice type="error" actionLabel="Thử lại" onAction={list.reload}>{list.error}</Notice> : null}
            </>
          )}
          ListEmptyComponent={!list.error ? <Empty icon="ticket-outline" text="Không có lượt đặt chỗ phù hợp." /> : null}
          ListFooterComponent={list.more ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item: r }) => {
            const c = RESV_STATUS[r.status] || RESV_STATUS.pending;
            return (
              <Card onPress={() => navigation.navigate('ReservationDetail', { id: r.id, initial: r })}>
                <View style={L.row}>
                  <Text style={[L.title, { flexShrink: 1 }]} numberOfLines={1}>{r.code || `#${r.id}`} • {r.lotName} • Ô #{r.slotNumber}</Text>
                  <Pill text={c.short || c.label} color={c.color} bg={c.bg} />
                </View>
                <Text style={L.sub} numberOfLines={1}>
                  {r.user.name} ({r.user.email}){r.vehiclePlate ? ` • ${r.vehiclePlate}` : ''}
                </Text>
                <Text style={L.sub}>
                  Đặt {formatDateTime(r.createdAt)} • giữ {r.holdMinutes} phút • dự kiến {formatVND(r.estimatedFee)}
                  {r.enteredAt ? ` • vào ${formatDateTime(r.enteredAt)}` : ''}
                </Text>
                {r.error ? <Text style={[L.sub, { color: colors.danger }]}>{REASONS[r.error] || r.error}</Text> : null}
                {r.status === 'active' || r.status === 'pending' ? (
                  <View style={L.actions}>
                    <SmallButton icon="close-circle-outline" label="Huỷ đặt chỗ" tone="danger" onPress={() => setCancel(r)} />
                    <SmallButton icon="person-outline" label="Tài xế" onPress={() => navigation.navigate('AdminUserDetail', { id: r.user.id })} />
                  </View>
                ) : null}
              </Card>
            );
          }}
        />
      )}
      <DateRangeModal visible={picker} from={range.from} to={range.to} onClose={() => setPicker(false)}
        onApply={(x) => { setPicker(false); setRange(x); }} />
      <PromptDialog visible={!!cancel} title={`Huỷ đặt chỗ ${cancel?.code || ''}?`} danger confirmLabel="Huỷ đặt chỗ"
        message="Ô được trả về trạng thái trống, tài xế nhận thông báo và không bị tính lần không đến."
        input={{ placeholder: 'Lý do (gửi cho tài xế)' }}
        onCancel={() => setCancel(null)}
        onConfirm={async (reason) => {
          const res = await adminApi.cancelReservation(cancel.id, reason);
          setNotice({ type: 'success', text: `Đã huỷ ${cancel.code}.${res.deviceConfirmed ? '' : ' (Thiết bị không xác nhận – đã huỷ trên hệ thống.)'}` });
          setCancel(null);
          list.refresh();
        }} />
    </ScreenShell>
  );
}
