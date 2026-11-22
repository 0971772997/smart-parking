// QUAN TRI - DANH GIA: moi danh gia cua moi bai, loc chua phan hoi / so sao, phan hoi nhanh, go danh gia vi pham
// params: { unreplied? }
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import StarRating from '../../components/StarRating';
import { Card, Chips, Empty, Pill, PromptDialog, SmallButton, listStyles as L, usePagedList } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { reviewsApi } from '../../api/feedback';
import { colors } from '../../theme';
import { timeAgo } from '../../utils/session';

const FILTERS = [
  { key: 'unreplied', label: 'Chưa phản hồi' }, { key: '', label: 'Tất cả' },
  { key: '1', label: '1★' }, { key: '2', label: '2★' }, { key: '3', label: '3★' }, { key: '4', label: '4★' }, { key: '5', label: '5★' },
];

export default function AdminReviewsScreen({ navigation, route }) {
  const [filter, setFilter] = useState(route.params?.unreplied ? 'unreplied' : '');
  const [dialog, setDialog] = useState(null); // { kind: 'reply' | 'delete', r }
  const [notice, setNotice] = useState(null);
  const list = usePagedList(({ limit, offset }) => adminApi.reviews({
    limit, offset, unreplied: filter === 'unreplied' ? 1 : undefined, rating: /^\d$/.test(filter) ? filter : undefined,
  }), [filter]);
  const tags = list.extra?.tags || {};

  const D = dialog && {
    reply: { title: dialog.r.reply ? 'Sửa phản hồi' : 'Phản hồi đánh giá', label: 'Gửi phản hồi',
      message: `${dialog.r.author} • ${dialog.r.rating}★ • ${dialog.r.lotName}`, input: { placeholder: 'Nội dung phản hồi (hiển thị công khai)', required: true },
      run: (t) => reviewsApi.reply(dialog.r.id, t), done: 'Đã gửi phản hồi. Tài xế sẽ nhận thông báo.' },
    delete: { title: 'Gỡ đánh giá này?', label: 'Gỡ đánh giá', danger: true, input: { placeholder: 'Lý do gỡ (gửi cho tài xế)' },
      message: 'Dùng cho đánh giá vi phạm (ngôn từ không phù hợp, spam). Không thể hoàn tác.',
      run: (t) => adminApi.deleteReview(dialog.r.id, t), done: 'Đã gỡ đánh giá.' },
  }[dialog.kind];

  return (
    <ScreenShell navigation={navigation} title="Đánh giá" subtitle={list.items ? `${list.total} đánh giá` : null}>
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
              <Chips options={FILTERS} value={filter} onChange={setFilter} />
              {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
              {list.error ? <Notice type="error" actionLabel="Thử lại" onAction={list.reload}>{list.error}</Notice> : null}
            </>
          )}
          ListEmptyComponent={!list.error ? <Empty icon="star-outline" text={filter === 'unreplied' ? 'Đã phản hồi hết các đánh giá 👍' : 'Không có đánh giá.'} /> : null}
          ListFooterComponent={list.more ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item: r }) => (
            <Card>
              <View style={L.row}>
                <StarRating value={r.rating} size={13} />
                <Text style={[L.title, { flexShrink: 1 }]} numberOfLines={1}>{r.lotName}</Text>
              </View>
              <Text style={L.sub}>{r.author} ({r.userEmail}) • {timeAgo(r.updatedAt)}</Text>
              {r.tags.length ? <View style={L.wrap}>{r.tags.map((t) => <Pill key={t} text={tags[t] || t} />)}</View> : null}
              {r.comment ? <Text style={{ fontSize: 13.5, color: colors.text, marginTop: 6, lineHeight: 19 }}>{r.comment}</Text> : null}
              {r.reply ? (
                <View style={{ marginTop: 8, padding: 8, borderRadius: 10, backgroundColor: colors.primarySoft }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.primaryDark }}>Phản hồi của bãi</Text>
                  <Text style={{ fontSize: 13, color: colors.text, marginTop: 2 }}>{r.reply.text}</Text>
                </View>
              ) : null}
              <View style={L.actions}>
                <SmallButton icon="return-down-forward" label={r.reply ? 'Sửa phản hồi' : 'Phản hồi'} onPress={() => setDialog({ kind: 'reply', r })} />
                <SmallButton icon="trash-outline" label="Gỡ" tone="danger" onPress={() => setDialog({ kind: 'delete', r })} />
                <SmallButton icon="person-outline" label="Tài xế" tone="muted" onPress={() => navigation.navigate('AdminUserDetail', { id: r.userId })} />
              </View>
            </Card>
          )}
        />
      )}
      <PromptDialog visible={!!D} title={D?.title} message={D?.message} input={D?.input} confirmLabel={D?.label} danger={D?.danger}
        onCancel={() => setDialog(null)}
        onConfirm={async (t) => { await D.run(t); setNotice({ type: 'success', text: D.done }); setDialog(null); list.refresh(); }} />
    </ScreenShell>
  );
}
