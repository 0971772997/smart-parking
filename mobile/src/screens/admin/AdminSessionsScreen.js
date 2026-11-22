// QUAN TRI - PHIEN GUI XE: dang trong bai / chua thanh toan / da xong; ket thuc phien bi treo, mien phi, thu tien mat
// params: { state? }
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
import { formatDateTime } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { FLAG_LABEL, PHASE } from '../../utils/session';
import { formatSeconds, presetRange, ymdLabel } from '../../utils/dates';

const STATES = [
  { key: 'active', label: 'Đang trong bãi' },
  { key: 'unpaid', label: 'Chưa thanh toán' },
  { key: 'completed', label: 'Đã kết thúc' },
  { key: 'all', label: 'Tất cả' },
];

export default function AdminSessionsScreen({ navigation, route }) {
  const [state, setState] = useState(route.params?.state || 'active');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(() => presetRange('30d'));
  const [picker, setPicker] = useState(false);
  const [action, setAction] = useState(null); // { kind: 'close' | 'waive' | 'cash', s }
  const [notice, setNotice] = useState(null);
  const query = useDebounced(q, 350);
  const dated = state === 'completed' || state === 'all';
  const list = usePagedList(({ limit, offset }) => adminApi.sessions({
    state, q: query, limit, offset, ...(dated ? range : {}),
  }), [state, query, range]);
  useOnLiveChange(list.refresh);

  const A = action && {
    close: { title: 'Kết thúc phiên gửi xe?', label: 'Kết thúc', input: { placeholder: 'Ghi chú (vd: cảm biến ô lỗi, xe đã ra bằng nút)' },
      message: `Chốt phí đến thời điểm hiện tại và đánh dấu xe đã ra bãi (ô #${action.s.slotNumber}, ${action.s.lotName}).`,
      run: (t) => adminApi.closeSession(action.s.id, { note: t || undefined }), done: 'Đã kết thúc phiên gửi xe.' },
    waive: { title: 'Miễn phí phiên này?', label: 'Miễn phí', danger: true, input: { placeholder: 'Lý do miễn phí', required: true },
      message: `Xoá khoản phí ${formatVND(action.s.cost.total)} của phiên. Tài xế không phải thanh toán.`,
      run: (t) => adminApi.closeSession(action.s.id, { waive: true, note: t }), done: 'Đã miễn phí phiên gửi xe.' },
    cash: { title: `Thu tiền mặt ${formatVND(action.s.amountDue)}?`, label: 'Đã thu tiền',
      message: 'Ghi nhận tài xế đã trả tiền mặt tại cổng và tạo biên nhận.',
      run: () => adminApi.collectCash(action.s.lotId, action.s.id), done: 'Đã ghi nhận thanh toán tiền mặt.' },
  }[action.kind];

  return (
    <ScreenShell navigation={navigation} title="Phiên gửi xe"
      subtitle={`${list.items ? `${list.total} phiên` : ''}${dated ? ` • ${ymdLabel(range.from)} – ${ymdLabel(range.to)}` : ''}`}
      right={dated ? <HeaderButton icon="calendar-outline" label="Chọn khoảng ngày" onPress={() => setPicker(true)} /> : null}>
      {list.loading ? <View style={L.center}><ActivityIndicator color={colors.primary} /></View> : (
        <FlatList
          data={list.items || []}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={L.content}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={list.refreshing} tintColor={colors.primary} onRefresh={list.refresh} />}
          ListHeaderComponent={(
            <>
              <SearchBar value={q} onChange={setQ} placeholder="Biển số, mã đặt chỗ, email, tên..." />
              <Chips options={STATES} value={state} onChange={setState} />
              {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
              {list.error ? <Notice type="error" actionLabel="Thử lại" onAction={list.reload}>{list.error}</Notice> : null}
              {state === 'unpaid' && list.extra?.unpaidAmount ? (
                <Text style={L.count}>Tổng chưa thu: {formatVND(list.extra.unpaidAmount)}</Text>
              ) : null}
            </>
          )}
          ListEmptyComponent={!list.error ? <Empty icon="car-sport-outline" text="Không có phiên gửi xe phù hợp." /> : null}
          ListFooterComponent={list.more ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item: s }) => {
            const p = PHASE[s.phase] || PHASE.parked;
            const open = s.phase !== 'completed';
            return (
              <Card onPress={() => navigation.navigate('SessionDetail', { id: s.id })}>
                <View style={L.row}>
                  <Text style={[L.title, { flexShrink: 1 }]} numberOfLines={1}>{s.lotName} • Ô #{s.slotNumber}{s.vehiclePlate ? ` • ${s.vehiclePlate}` : ''}</Text>
                  <Pill text={p.short} color={p.color} bg={p.bg} />
                </View>
                <Text style={L.sub} numberOfLines={1}>
                  {s.user ? `${s.user.name} (${s.user.email})` : 'Khách vãng lai'}{s.reservationCode ? ` • ${s.reservationCode}` : ''}
                </Text>
                <Text style={L.sub}>
                  Vào {formatDateTime(s.startedAt)} • {formatSeconds(s.durationSeconds ?? s.elapsedSeconds)}
                  {s.overtime ? ' • quá giờ' : ''}
                </Text>
                <View style={[L.row, { marginTop: 6 }]}>
                  <Text style={L.amount}>{formatVND(s.cost.total)}</Text>
                  {s.paid ? <Pill text={`Đã trả • ${s.payment.method}`} color={colors.success} bg={colors.successSoft} />
                    : s.cost.final ? (s.cost.total ? <Pill text="Chưa thanh toán" color={colors.danger} bg={colors.dangerSoft} /> : <Pill text="Miễn phí" />)
                      : <Pill text="Tạm tính" color="#2563EB" bg="#EFF6FF" />}
                  {s.flags.map((f) => <Pill key={f} text={FLAG_LABEL[f] || f} color="#B45309" bg="#FEF3C7" />)}
                </View>
                {s.adminNote ? <Text style={[L.sub, { fontStyle: 'italic' }]}>Ghi chú QT: {s.adminNote}</Text> : null}
                <View style={L.actions}>
                  {open ? <SmallButton icon="stop-circle-outline" label="Kết thúc phiên" tone="danger" onPress={() => setAction({ kind: 'close', s })} /> : null}
                  {!s.paid && s.cost.final && s.amountDue > 0 ? (
                    <>
                      <SmallButton icon="cash-outline" label="Thu tiền mặt" tone="success" onPress={() => setAction({ kind: 'cash', s })} />
                      <SmallButton icon="gift-outline" label="Miễn phí" tone="muted" onPress={() => setAction({ kind: 'waive', s })} />
                    </>
                  ) : null}
                  {s.user ? <SmallButton icon="person-outline" label="Tài xế" onPress={() => navigation.navigate('AdminUserDetail', { id: s.user.id })} /> : null}
                </View>
              </Card>
            );
          }}
        />
      )}
      <DateRangeModal visible={picker} from={range.from} to={range.to} onClose={() => setPicker(false)}
        onApply={(x) => { setPicker(false); setRange(x); }} />
      <PromptDialog visible={!!A} title={A?.title} message={A?.message} input={A?.input} confirmLabel={A?.label} danger={A?.danger}
        onCancel={() => setAction(null)}
        onConfirm={async (t) => { await A.run(t); setNotice({ type: 'success', text: A.done }); setAction(null); list.refresh(); }} />
    </ScreenShell>
  );
}
