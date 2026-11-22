// QUAN TRI - CHI TIET NGUOI DUNG: thong tin, khoa / mo khoa, cap / go quyen quan tri, go khoa dat cho (khong den),
// xe, dat cho / phien / giao dich / yeu cau ho tro gan day.
// params: { id }
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { Card, Pill, PromptDialog, SmallButton, listStyles as L } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { useAuth } from '../../context/AuthContext';
import { colors, radius } from '../../theme';
import { formatDateTime, RESV_STATUS } from '../../utils/booking';
import { formatVND } from '../../utils/schedules';
import { PHASE } from '../../utils/session';
import { TICKET_STATUS } from '../../utils/support';

export default function AdminUserDetailScreen({ navigation, route }) {
  const { id } = route.params || {};
  const { user: me } = useAuth();
  const [u, setU] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null); // 'lock' | 'unlock' | 'promote' | 'demote' | 'noshow'

  const load = useCallback(async () => {
    try {
      setU(await adminApi.user(id));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const self = me?.id === id;
  const DIALOGS = {
    lock: { title: 'Khoá tài khoản?', message: 'Người dùng bị đăng xuất ngay và không đăng nhập lại được cho đến khi mở khoá.',
      input: { placeholder: 'Lý do khoá (hiển thị cho người dùng khi đăng nhập)' }, label: 'Khoá', danger: true,
      run: (t) => adminApi.updateUser(id, { locked: true, lockedReason: t || undefined }), done: 'Đã khoá tài khoản.' },
    unlock: { title: 'Mở khoá tài khoản?', label: 'Mở khoá', run: () => adminApi.updateUser(id, { locked: false }), done: 'Đã mở khoá tài khoản.' },
    promote: { title: 'Cấp quyền quản trị?', message: 'Tài khoản này sẽ truy cập được toàn bộ trang quản trị.', label: 'Cấp quyền',
      run: () => adminApi.updateUser(id, { role: 'admin' }), done: 'Đã cấp quyền quản trị.' },
    demote: { title: 'Gỡ quyền quản trị?', label: 'Gỡ quyền', danger: true, run: () => adminApi.updateUser(id, { role: 'user' }), done: 'Đã chuyển về tài xế.' },
    noshow: { title: 'Gỡ khoá đặt chỗ?', message: 'Xoá các lần "không đến" gần đây để tài xế đặt chỗ lại ngay. Tài xế sẽ nhận thông báo.',
      label: 'Gỡ khoá', run: () => adminApi.updateUser(id, { resetNoShows: true }), done: 'Đã gỡ khoá đặt chỗ.' },
  };
  const cur = dialog ? DIALOGS[dialog] : null;

  if (!u) {
    return (
      <ScreenShell navigation={navigation} title="Người dùng">
        <View style={L.center}>{error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : <ActivityIndicator color={colors.primary} />}</View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell navigation={navigation} title={u.fullName || u.username || u.email} subtitle={`#${u.id} • ${u.email}`}>
      <ScrollView contentContainerStyle={L.content}>
        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
        {u.locked ? (
          <Notice type="error">Tài khoản bị khoá từ {formatDateTime(u.lockedAt)}{u.lockedReason ? ` – ${u.lockedReason}` : ''}.</Notice>
        ) : null}

        <Card>
          <View style={[L.row, { flexWrap: 'wrap' }]}>
            <Pill text={u.role === 'admin' ? 'Quản trị viên' : 'Tài xế'} color={u.role === 'admin' ? colors.primary : colors.textMuted}
              bg={u.role === 'admin' ? colors.primarySoft : '#F1F5F9'} icon={u.role === 'admin' ? 'shield' : 'person'} />
            {u.linked.google ? <Pill text="Google" icon="logo-google" /> : null}
            {u.linked.facebook ? <Pill text="Facebook" icon="logo-facebook" /> : null}
            {u.noShows7d >= 3 ? <Pill text={`Khoá đặt chỗ (${u.noShows7d} lần không đến)`} color={colors.danger} bg={colors.dangerSoft} /> : null}
          </View>
          <Field label="Họ tên" value={u.fullName || '—'} />
          <Field label="Tên đăng nhập" value={u.username || '—'} />
          <Field label="Email" value={u.email} />
          <Field label="Số điện thoại" value={u.phone || '—'} />
          <Field label="Ngày tạo" value={formatDateTime(u.createdAt)} />
          <Field label="Không đến (7 ngày)" value={`${u.noShows7d} lần`} />
          <View style={styles.stats}>
            <Stat value={u.stats.sessions} label="Lượt gửi" />
            <Stat value={u.stats.reservations} label="Đặt chỗ" />
            <Stat value={formatVND(u.stats.totalPaid)} label="Đã thanh toán" />
          </View>
          {!self ? (
            <View style={L.actions}>
              {u.locked
                ? <SmallButton icon="lock-open" label="Mở khoá" tone="success" onPress={() => setDialog('unlock')} />
                : <SmallButton icon="lock-closed" label="Khoá tài khoản" tone="danger" onPress={() => setDialog('lock')} />}
              {u.role === 'admin'
                ? <SmallButton icon="shield-outline" label="Gỡ quyền quản trị" tone="muted" onPress={() => setDialog('demote')} />
                : <SmallButton icon="shield-checkmark" label="Cấp quyền quản trị" onPress={() => setDialog('promote')} />}
              {u.noShows7d > 0 ? <SmallButton icon="refresh" label="Gỡ khoá đặt chỗ" onPress={() => setDialog('noshow')} /> : null}
            </View>
          ) : <Text style={[L.sub, { marginTop: 10 }]}>Đây là tài khoản của bạn.</Text>}
        </Card>

        <Section title={`Xe (${u.vehicles.length})`}>
          {u.vehicles.length ? (
            <View style={L.wrap}>{u.vehicles.map((v) => <Pill key={v.id} text={`${v.plateNumber}${v.brand ? ` • ${v.brand}` : ''}`} icon="car" color={colors.text} />)}</View>
          ) : <Text style={L.sub}>Chưa đăng ký xe.</Text>}
        </Section>

        <Section title="Phiên gửi xe gần đây">
          {u.sessions.length ? u.sessions.map((s) => {
            const p = PHASE[s.phase] || PHASE.parked;
            return (
              <Line key={s.id} onPress={() => navigation.navigate('SessionDetail', { id: s.id })}
                title={`${s.lotName} • Ô #${s.slotNumber}`} sub={formatDateTime(s.startedAt)}
                pill={<Pill text={p.short} color={p.color} bg={p.bg} />}
                right={`${formatVND(s.cost.total)}${s.paid ? '' : s.cost.final && s.cost.total ? ' • nợ' : ''}`} />
            );
          }) : <Text style={L.sub}>Chưa có.</Text>}
        </Section>

        <Section title="Đặt chỗ gần đây">
          {u.reservations.length ? u.reservations.map((r) => {
            const c = RESV_STATUS[r.status] || RESV_STATUS.pending;
            return (
              <Line key={r.id} onPress={() => navigation.navigate('ReservationDetail', { id: r.id, initial: r })}
                title={`${r.code || `#${r.id}`} • ${r.lotName} • Ô #${r.slotNumber}`} sub={formatDateTime(r.createdAt)}
                pill={<Pill text={c.short || c.label} color={c.color} bg={c.bg} />} />
            );
          }) : <Text style={L.sub}>Chưa có.</Text>}
        </Section>

        <Section title="Giao dịch gần đây">
          {u.payments.length ? u.payments.map((p) => (
            <Line key={p.id} onPress={() => navigation.navigate('Receipt', { paymentId: p.id })}
              title={p.receiptNo} sub={`${p.methodLabel} • ${formatDateTime(p.createdAt)}`} right={formatVND(p.amount)} />
          )) : <Text style={L.sub}>Chưa có.</Text>}
        </Section>

        <Section title="Yêu cầu hỗ trợ">
          {u.tickets.length ? u.tickets.map((t) => {
            const st = TICKET_STATUS[t.status] || TICKET_STATUS.open;
            return (
              <Line key={t.id} onPress={() => navigation.navigate('SupportTicket', { id: t.id })}
                title={`${t.code} • ${t.subject}`} sub={formatDateTime(t.createdAt)} pill={<Pill text={st.label} color={st.color} bg={st.bg} />} />
            );
          }) : <Text style={L.sub}>Chưa có.</Text>}
        </Section>
      </ScrollView>

      <PromptDialog visible={!!cur} title={cur?.title} message={cur?.message} input={cur?.input} confirmLabel={cur?.label} danger={cur?.danger}
        onCancel={() => setDialog(null)}
        onConfirm={async (text) => {
          await cur.run(text);
          setDialog(null);
          setNotice({ type: 'success', text: cur.done });
          load();
        }} />
    </ScreenShell>
  );
}

function Field({ label, value }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fLabel}>{label}</Text>
      <Text style={styles.fValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}
function Stat({ value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.sValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.sLabel}>{label}</Text>
    </View>
  );
}
function Section({ title, children }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.box}>{children}</View>
    </View>
  );
}
function Line({ title, sub, pill, right, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.line, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={styles.lTitle} numberOfLines={1}>{title}</Text>
        <View style={[L.row, { marginTop: 2 }]}>{pill}<Text style={styles.lSub}>{sub}</Text></View>
      </View>
      {right ? <Text style={styles.lRight}>{right}</Text> : null}
      <Ionicons name="chevron-forward" size={14} color="#CBD5E1" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  fLabel: { fontSize: 13, color: colors.textMuted },
  fValue: { fontSize: 13, fontWeight: '700', color: colors.text, flexShrink: 1, textAlign: 'right' },
  stats: { flexDirection: 'row', marginTop: 10, paddingVertical: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  sValue: { fontSize: 15, fontWeight: '900', color: colors.text },
  sLabel: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  section: { fontSize: 12.5, fontWeight: '800', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  box: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 10, borderWidth: 1, borderColor: '#EEF2F7' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  lTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  lSub: { fontSize: 11.5, color: colors.textMuted },
  lRight: { fontSize: 13, fontWeight: '800', color: colors.text },
});
