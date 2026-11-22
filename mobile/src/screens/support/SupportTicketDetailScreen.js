// CHI TIET YEU CAU HO TRO / SU CO: thong tin, trang thai, trao doi voi nhan vien (cap nhat thoi gian thuc), nhan tin, dong yeu cau.
// Quan tri: tra loi, doi trang thai (dang xu ly / da giai quyet / dong), xem nguoi gui.
// params: { id, created? }
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import ConfirmDialog from '../../components/ConfirmDialog';
import { supportApi } from '../../api/feedback';
import { useAuth } from '../../context/AuthContext';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { TICKET_STATUS } from '../../utils/support';
import { formatDateTime } from '../../utils/booking';

const ADMIN_STATUSES = ['in_progress', 'resolved', 'closed'];

export default function SupportTicketDetailScreen({ navigation, route }) {
  const { id, created } = route.params || {};
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(created ? { type: 'success', text: 'Đã gửi! Nhân viên hỗ trợ sẽ phản hồi tại đây và qua thông báo.' } : null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [busyStatus, setBusyStatus] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setT(await supportApi.detail(id));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => {
    const x = setTimeout(load, 0);
    return () => clearTimeout(x);
  }, [load]);
  useOnLiveChange(load); // nhan vien tra loi / doi trang thai -> cap nhat ngay

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await supportApi.reply(id, body);
      setText('');
      setT((cur) => ({ ...cur, status: r.status, messages: [...cur.messages, r.message] }));
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 50);
      load();
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status) {
    setBusyStatus(status);
    try {
      const d = await supportApi.setStatus(id, status);
      setT((cur) => ({ ...cur, ...d }));
      setNotice({ type: 'success', text: `Đã chuyển sang “${TICKET_STATUS[status].label}”.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setBusyStatus(null);
      setConfirmClose(false);
    }
  }

  if (!t) {
    return (
      <ScreenShell navigation={navigation} title="Yêu cầu hỗ trợ">
        <View style={styles.center}>
          {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : <ActivityIndicator color={colors.primary} />}
        </View>
      </ScreenShell>
    );
  }

  const st = TICKET_STATUS[t.status] || TICKET_STATUS.open;
  const incident = t.kind === 'incident';
  return (
    <ScreenShell navigation={navigation} title={t.code} subtitle={incident ? 'Báo cáo sự cố' : 'Yêu cầu hỗ trợ'}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
          {error ? <Notice type="error">{error}</Notice> : null}

          <View style={styles.card}>
            <View style={styles.badges}>
              <Text style={[styles.badge, { color: st.color, backgroundColor: st.bg }]}>{st.label}</Text>
              <Text style={[styles.badge, incident ? { color: colors.danger, backgroundColor: colors.dangerSoft } : { color: colors.primary, backgroundColor: colors.primarySoft }]}>
                {t.categoryLabel}
              </Text>
              {t.priority === 'high' ? <Text style={[styles.badge, { color: '#fff', backgroundColor: colors.danger }]}>Khẩn</Text> : null}
            </View>
            <Text style={styles.subject}>{t.subject}</Text>
            <Text style={styles.desc}>{t.description}</Text>
            <View style={styles.meta}>
              <Meta icon="time-outline" text={`Gửi lúc ${formatDateTime(t.createdAt)}`} />
              {t.lotName ? <Meta icon="business-outline" text={`${t.lotName}${t.slotNumber ? ` • Ô #${t.slotNumber}` : ''}`} /> : null}
              {t.resolvedAt ? <Meta icon="checkmark-done-outline" text={`Hoàn tất ${formatDateTime(t.resolvedAt)}`} /> : null}
            </View>
            {t.sessionId ? (
              <Pressable onPress={() => navigation.navigate('SessionDetail', { id: t.sessionId })} style={styles.link}>
                <Ionicons name="car-sport-outline" size={15} color={colors.primary} />
                <Text style={styles.linkText}>Xem lượt gửi xe liên quan</Text>
              </Pressable>
            ) : null}
            {isAdmin && t.reporter ? (
              <View style={styles.reporter}>
                <Text style={styles.reporterTitle}>Người gửi: {t.reporter.name}</Text>
                <Text style={styles.reporterSub}>{t.reporter.email}{t.reporter.phone ? ` • ${t.reporter.phone}` : ''}</Text>
                {t.reporter.phone ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${t.reporter.phone}`).catch(() => {})} style={styles.link}>
                    <Ionicons name="call-outline" size={15} color={colors.primary} />
                    <Text style={styles.linkText}>Gọi cho tài xế</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          {isAdmin ? (
            <View style={styles.statusRow}>
              {ADMIN_STATUSES.map((s) => (
                <Pressable key={s} onPress={() => setStatus(s)} disabled={t.status === s || busyStatus != null}
                  style={[styles.statusBtn, t.status === s && { borderColor: TICKET_STATUS[s].color, backgroundColor: TICKET_STATUS[s].bg }]}>
                  {busyStatus === s ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={[styles.statusText, t.status === s && { color: TICKET_STATUS[s].color }]}>{TICKET_STATUS[s].label}</Text>}
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.section}>Trao đổi</Text>
          {t.messages.length === 0 ? (
            <View style={styles.waiting}>
              <Ionicons name="hourglass-outline" size={18} color={colors.textMuted} />
              <Text style={styles.waitingText}>
                {isAdmin ? 'Chưa có phản hồi. Hãy trả lời tài xế bên dưới.' : 'Yêu cầu đã được tiếp nhận. Nhân viên sẽ phản hồi sớm nhất.'}
              </Text>
            </View>
          ) : null}
          {t.messages.map((m) => {
            const mine = isAdmin ? m.staff : !m.staff;
            return (
              <View key={m.id} style={[styles.msgRow, mine && { justifyContent: 'flex-end' }]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  <Text style={[styles.author, mine && { color: 'rgba(255,255,255,0.8)' }]}>{m.staff ? '🎧 Nhân viên hỗ trợ' : m.author}</Text>
                  <Text style={[styles.msg, mine && { color: '#fff' }]}>{m.body}</Text>
                  <Text style={[styles.msgTime, mine && { color: 'rgba(255,255,255,0.7)' }]}>{formatDateTime(m.createdAt)}</Text>
                </View>
              </View>
            );
          })}

          {!isAdmin && t.canClose ? (
            <Pressable onPress={() => setConfirmClose(true)} style={styles.closeLink}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
              <Text style={[styles.linkText, { color: colors.success }]}>Vấn đề đã được giải quyết – đóng yêu cầu</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {t.canReply ? (
          <View style={styles.composer}>
            <TextInput value={text} onChangeText={setText} placeholder={t.status === 'resolved' && !isAdmin ? 'Nhắn tin để mở lại yêu cầu...' : 'Nhập tin nhắn...'}
              placeholderTextColor={colors.placeholder} style={styles.composerInput} multiline maxLength={2000} />
            <Pressable onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
              accessibilityRole="button" accessibilityLabel="Gửi tin nhắn">
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
        ) : (
          <View style={styles.closedBar}>
            <Text style={styles.closedText}>Yêu cầu đã đóng. Cần hỗ trợ thêm?</Text>
            <Pressable onPress={() => navigation.replace('SupportTicketForm', { kind: t.kind, lotId: t.lotId, sessionId: t.sessionId })}>
              <Text style={styles.linkText}>Gửi yêu cầu mới</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
      <ConfirmDialog visible={confirmClose} title="Đóng yêu cầu?" message="Bạn sẽ không nhắn thêm được vào yêu cầu này."
        confirmLabel="Đóng yêu cầu" loading={busyStatus === 'closed'} onConfirm={() => setStatus('closed')} onCancel={() => setConfirmClose(false)} />
    </ScreenShell>
  );
}

function Meta({ icon, text }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={13} color={colors.textMuted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content: { padding: 16, paddingBottom: 24, backgroundColor: '#F8FAFC', flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: '#EEF2F7' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  subject: { fontSize: 16, fontWeight: '900', color: colors.text, marginTop: 10 },
  desc: { fontSize: 13.5, color: colors.text, marginTop: 6, lineHeight: 19 },
  meta: { marginTop: 10, gap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: colors.textMuted },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  linkText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  reporter: { marginTop: 12, padding: 10, borderRadius: radius.md, backgroundColor: '#F8FAFC' },
  reporterTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  reporterSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statusBtn: { flex: 1, height: 40, borderRadius: radius.md, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 12.5, fontWeight: '800', color: colors.textMuted },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  waiting: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: radius.md, backgroundColor: '#F1F5F9' },
  waitingText: { flex: 1, fontSize: 13, color: colors.textMuted },
  msgRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '82%', padding: 10, borderRadius: 14 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7', borderBottomLeftRadius: 4 },
  author: { fontSize: 11, fontWeight: '800', color: colors.textMuted, marginBottom: 2 },
  msg: { fontSize: 13.5, color: colors.text, lineHeight: 19 },
  msgTime: { fontSize: 10.5, color: '#94A3B8', marginTop: 4, textAlign: 'right' },
  closeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: '#EEF2F7', backgroundColor: '#fff' },
  composerInput: { flex: 1, maxHeight: 110, minHeight: 42, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 21, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  closedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: '#EEF2F7', backgroundColor: '#fff' },
  closedText: { fontSize: 13, color: colors.textMuted },
});
