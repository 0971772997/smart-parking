// HO TRO: goi hotline / email / Zalo, cau hoi thuong gap, gui yeu cau ho tro hoac bao cao su co, theo doi cac yeu cau.
// Quan tri: xem va xu ly yeu cau cua moi tai xe (loc theo trang thai).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import { supportApi } from '../../api/feedback';
import { useAuth } from '../../context/AuthContext';
import { useOnLiveChange } from '../../context/LiveContext';
import { colors, radius } from '../../theme';
import { TICKET_STATUS } from '../../utils/support';
import { timeAgo } from '../../utils/session';

// Dung khi chua tai duoc tu may chu
const FALLBACK_CONTACT = { hotline: '1900 6868', hotlineHours: '24/7', email: 'hotro@smartpark.vn', zalo: '0901234567' };
const ADMIN_FILTERS = [
  { key: 'open,in_progress', label: 'Cần xử lý' },
  { key: 'resolved,closed', label: 'Đã xong' },
  { key: '', label: 'Tất cả' },
];

export default function SupportScreen({ navigation }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [info, setInfo] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [filter, setFilter] = useState(ADMIN_FILTERS[0].key);
  const [openFaq, setOpenFaq] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, t] = await Promise.all([
        supportApi.info().catch(() => null),
        supportApi.list(isAdmin ? { all: true, status: filter || undefined } : {}),
      ]);
      if (i) setInfo(i);
      setTickets(t);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin, filter]);
  useFocusEffect(useCallback(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]));
  useOnLiveChange(load);

  const c = info?.contact || FALLBACK_CONTACT;
  const open = (url) => {
    if (Platform.OS === 'web' && url.startsWith('http')) globalThis.open?.(url, '_blank');
    else Linking.openURL(url).catch(() => setError(`Không mở được ${url}`));
  };
  const active = (tickets || []).filter((t) => t.status === 'open' || t.status === 'in_progress').length;

  return (
    <ScreenShell navigation={navigation} title={isAdmin ? 'Hỗ trợ & sự cố (quản trị)' : 'Hỗ trợ khách hàng'}
      subtitle={active ? `${active} yêu cầu đang xử lý` : null}>
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {error ? <Notice type="error" actionLabel="Thử lại" onAction={load}>{error}</Notice> : null}

        {!isAdmin ? (
          <>
            {/* LIEN HE NHANH */}
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Chúng tôi có thể giúp gì cho bạn?</Text>
              <Text style={styles.heroSub}>{info?.contact?.responseTime || 'Phản hồi yêu cầu trong vòng 2 giờ.'}</Text>
              <View style={styles.contactRow}>
                <Contact icon="call" label="Hotline" value={c.hotline} sub={c.hotlineHours} onPress={() => open(`tel:${c.hotline.replace(/\s/g, '')}`)} />
                <Contact icon="mail" label="Email" value={c.email} onPress={() => open(`mailto:${c.email}?subject=${encodeURIComponent('Hỗ trợ SmartPark')}`)} />
                <Contact icon="chatbubble-ellipses" label="Zalo" value={c.zalo} onPress={() => open(`https://zalo.me/${c.zalo}`)} />
              </View>
            </View>

            {/* GUI YEU CAU / BAO CAO SU CO */}
            <View style={styles.bigRow}>
              <BigAction icon="help-buoy" color={colors.primary} title="Gửi yêu cầu hỗ trợ" sub="Tài khoản, đặt chỗ, thanh toán..."
                onPress={() => navigation.navigate('SupportTicketForm', { kind: 'support' })} />
              <BigAction icon="warning" color={colors.danger} title="Báo cáo sự cố" sub="Barie, cảm biến, ô bị chiếm..."
                onPress={() => navigation.navigate('SupportTicketForm', { kind: 'incident' })} />
            </View>
          </>
        ) : (
          <View style={styles.filters}>
            {ADMIN_FILTERS.map((f) => (
              <Pressable key={f.key || 'all'} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]}>
                <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* YEU CAU CUA TOI / TAT CA */}
        <Text style={styles.section}>{isAdmin ? 'Yêu cầu & báo cáo' : 'Yêu cầu của tôi'}</Text>
        {tickets === null && !error ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null}
        {tickets && tickets.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={34} color="#CBD5E1" />
            <Text style={styles.emptyText}>{isAdmin ? 'Không có yêu cầu nào.' : 'Bạn chưa gửi yêu cầu nào.'}</Text>
          </View>
        ) : null}
        {(tickets || []).map((t) => <TicketRow key={t.id} t={t} admin={isAdmin} onPress={() => navigation.navigate('SupportTicket', { id: t.id })} />)}

        {/* CAU HOI THUONG GAP */}
        {!isAdmin && info?.faq?.length ? (
          <>
            <Text style={styles.section}>Câu hỏi thường gặp</Text>
            <View style={styles.faqCard}>
              {info.faq.map((f, i) => (
                <Pressable key={f.q} onPress={() => setOpenFaq(openFaq === i ? null : i)}
                  style={[styles.faq, i > 0 && styles.faqBorder]} accessibilityRole="button" accessibilityState={{ expanded: openFaq === i }}>
                  <View style={styles.faqHead}>
                    <Text style={styles.faqQ}>{f.q}</Text>
                    <Ionicons name={openFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </View>
                  {openFaq === i ? <Text style={styles.faqA}>{f.a}</Text> : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

export function TicketRow({ t, admin, onPress }) {
  const st = TICKET_STATUS[t.status] || TICKET_STATUS.open;
  const incident = t.kind === 'incident';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ticket, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={[styles.tIcon, { backgroundColor: incident ? colors.dangerSoft : colors.primarySoft }]}>
        <Ionicons name={incident ? 'warning' : 'help-buoy'} size={17} color={incident ? colors.danger : colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tSubject} numberOfLines={1}>{t.subject}</Text>
        <Text style={styles.tMeta} numberOfLines={1}>
          {t.code} • {t.categoryLabel}{t.lotName ? ` • ${t.lotName}` : ''}
        </Text>
        <View style={styles.tRow}>
          <Text style={[styles.tBadge, { color: st.color, backgroundColor: st.bg }]}>{st.label}</Text>
          {t.priority === 'high' ? <Text style={[styles.tBadge, { color: colors.danger, backgroundColor: colors.dangerSoft }]}>Khẩn</Text> : null}
          {admin && t.reporter ? <Text style={styles.tWhen} numberOfLines={1}>{t.reporter.name}</Text> : null}
          <Text style={styles.tWhen}>{timeAgo(t.lastMessageAt || t.updatedAt)}</Text>
        </View>
      </View>
      {(admin ? t.awaitingReply : !t.awaitingReply && t.messageCount > 0 && t.status !== 'closed')
        ? <View style={styles.dot} accessibilityLabel={admin ? 'Chờ phản hồi' : 'Có phản hồi mới'} /> : null}
      <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
    </Pressable>
  );
}

function Contact({ icon, label, value, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.contact, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
      <View style={styles.contactIcon}><Ionicons name={icon} size={18} color="#fff" /></View>
      <Text style={styles.contactLabel}>{label}</Text>
      <Text style={styles.contactValue} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.contactSub}>{sub}</Text> : null}
    </Pressable>
  );
}

function BigAction({ icon, color, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.big, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <View style={[styles.bigIcon, { backgroundColor: `${color}14` }]}><Ionicons name={icon} size={22} color={color} /></View>
      <Text style={styles.bigTitle}>{title}</Text>
      <Text style={styles.bigSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  hero: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  heroTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, marginTop: 4 },
  contactRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  contact: { flex: 1, alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.08)' },
  contactIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  contactLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '700' },
  contactValue: { color: '#fff', fontSize: 12, fontWeight: '800', marginTop: 1 },
  contactSub: { color: '#86EFAC', fontSize: 10.5, fontWeight: '700', marginTop: 1 },
  bigRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  big: { flex: 1, backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: '#EEF2F7' },
  bigIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  bigTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  bigSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  filters: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.primary },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEF2F7' },
  tIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tSubject: { fontSize: 14, fontWeight: '800', color: colors.text },
  tMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  tBadge: { fontSize: 10.5, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  tWhen: { fontSize: 11, color: '#94A3B8', flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
  empty: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  faqCard: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: '#EEF2F7' },
  faq: { padding: 14 },
  faqBorder: { borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  faqQ: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.text },
  faqA: { fontSize: 13, color: colors.textMuted, marginTop: 8, lineHeight: 19 },
});
