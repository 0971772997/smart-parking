// CAI DAT THONG BAO: trang thai (quyen, che do day / chi trong app), bat-tat tung nhom, gui thu
//   - "Gui thong bao day thu": may chu day qua Expo Push -> kiem tra khi thoat app / tat man hinh
//   - "Thu nhac gio (10 giay)": hen thong bao cuc bo -> bam roi tat man hinh de kiem tra (chay ca tren Expo Go)
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import { notificationsApi } from '../../api/sessions';
import { colors, radius } from '../../theme';
import { cachePrefs, registerForPush, scheduleTestReminder, supported } from '../../notifications';

const GROUPS = [
  { key: 'reservation', icon: 'ticket-outline', label: 'Đặt chỗ', sub: 'Đặt chỗ thành công, đổi ô, đặt chỗ hết hạn' },
  { key: 'arrival', icon: 'car-sport-outline', label: 'Xe đến & ra bãi', sub: 'Xe qua cổng vào, xe vào ô, đỗ nhầm ô, ra bãi' },
  { key: 'reminder', icon: 'alarm-outline', label: 'Nhắc giờ', sub: 'Sắp hết giờ giữ chỗ, sắp hết / quá giờ gửi xe' },
  { key: 'payment', icon: 'wallet-outline', label: 'Thanh toán', sub: 'Phí cần trả khi xe rời ô, kết quả thanh toán' },
  { key: 'support', icon: 'help-buoy-outline', label: 'Hỗ trợ & đánh giá', sub: 'Phản hồi yêu cầu hỗ trợ / sự cố, bãi đỗ trả lời đánh giá' },
];

const REASON = {
  permission_denied: 'Bạn chưa cho phép SmartPark gửi thông báo.',
  expo_go: 'Đang chạy trên Expo Go: Android không nhận thông báo đẩy từ máy chủ khi thoát app. Cài bản development build để nhận đầy đủ. Nhắc giờ và thông báo khi đang dùng app vẫn hoạt động.',
  simulator: 'Máy ảo không nhận được thông báo đẩy.',
  no_project: 'Ứng dụng chưa được cấu hình dự án Expo (EAS projectId).',
  web: 'Trình duyệt web chỉ hiển thị thông báo khi đang mở app.',
};

export default function NotificationSettingsScreen({ navigation }) {
  const [status, setStatus] = useState(null); // ket qua registerForPush
  const [prefs, setPrefs] = useState(null);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [reg, p] = await Promise.all([
      registerForPush({ ask: false }),
      notificationsApi.prefs().catch((e) => { setNotice({ type: 'error', text: e.message }); return null; }),
    ]);
    setStatus(reg);
    if (p) { setPrefs(p.prefs); setDevices(p.devices); cachePrefs(p.prefs); }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function enable() {
    setBusy('enable');
    const reg = await registerForPush({ ask: true });
    if (reg.reason === 'permission_denied') Linking.openSettings().catch(() => {});
    setStatus(reg);
    await load();
    setBusy(null);
  }

  async function toggle(key, value) {
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const r = await notificationsApi.setPrefs({ [key]: value });
      setPrefs(r.prefs);
      cachePrefs(r.prefs);
    } catch (e) {
      setPrefs(prev);
      setNotice({ type: 'error', text: e.message });
    }
  }

  async function testPush() {
    setBusy('push');
    setNotice(null);
    try {
      const r = await notificationsApi.testPush();
      setNotice(r.sent > 0
        ? { type: 'success', text: `Đã gửi tới ${r.sent} thiết bị. Thoát ra màn hình chính hoặc tắt màn hình để kiểm tra.` }
        : { type: 'info', text: 'Chưa có thiết bị nào nhận được thông báo đẩy. Thông báo vẫn có trong danh sách trong app.' });
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function testLocal() {
    const ok = await scheduleTestReminder(10);
    setNotice(ok
      ? { type: 'success', text: 'Đã hẹn nhắc thử sau 10 giây – hãy thoát app hoặc tắt màn hình ngay.' }
      : { type: 'error', text: 'Chưa có quyền gửi thông báo.' });
  }

  const push = status?.mode === 'push';
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.web}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Quay lại">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Cài đặt thông báo</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}

          {/* TRANG THAI */}
          <View style={styles.card}>
            {!status ? <ActivityIndicator color={colors.primary} /> : (
              <>
                <View style={styles.statusRow}>
                  <View style={[styles.statusIcon, { backgroundColor: push ? colors.successSoft : '#FEF3C7' }]}>
                    <Ionicons name={push ? 'notifications' : 'notifications-off-outline'} size={22} color={push ? colors.success : '#B45309'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statusTitle}>{push ? 'Thông báo đẩy đang bật' : 'Chỉ thông báo khi đang dùng app'}</Text>
                    <Text style={styles.statusSub}>
                      {push ? `Nhận cả khi thoát app và khi tắt màn hình • ${devices.length} thiết bị` : REASON[status.reason] || status.message || 'Không lấy được mã thiết bị.'}
                    </Text>
                  </View>
                </View>
                <View style={styles.states}>
                  <State ok label="Đang dùng app" />
                  <State ok={push} partial={!push && supported} label="Thoát ra màn hình chính" />
                  <State ok={push} partial={!push && supported} label="Tắt màn hình" />
                </View>
                {!push && supported ? <Text style={styles.hint}>Nhắc giờ (sắp hết giờ giữ chỗ / gửi xe) luôn được hẹn trên máy nên vẫn hiện khi thoát app hoặc tắt màn hình.</Text> : null}
                {status.reason === 'permission_denied' ? (
                  <Button title="Cho phép thông báo" onPress={enable} loading={busy === 'enable'} style={{ marginTop: 12 }} />
                ) : null}
              </>
            )}
          </View>

          {/* NHOM THONG BAO */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nhận thông báo đẩy về</Text>
            {!prefs ? <ActivityIndicator color={colors.primary} /> : GROUPS.map((g) => (
              <View key={g.key} style={styles.group}>
                <Ionicons name={g.icon} size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupLabel}>{g.label}</Text>
                  <Text style={styles.groupSub}>{g.sub}</Text>
                </View>
                <Switch value={prefs[g.key]} onValueChange={(v) => toggle(g.key, v)}
                  trackColor={{ true: colors.primary, false: '#CBD5E1' }} thumbColor="#fff" accessibilityLabel={g.label} />
              </View>
            ))}
            <Text style={styles.hint}>Tắt một nhóm chỉ ngừng gửi thông báo ra màn hình; thông báo vẫn được lưu trong danh sách của app.</Text>
          </View>

          {/* GUI THU */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kiểm tra</Text>
            <Button title="Gửi thông báo đẩy thử" onPress={testPush} loading={busy === 'push'} />
            {supported ? <Button title="Thử nhắc giờ sau 10 giây" variant="outline" onPress={testLocal} style={{ marginTop: 8 }} /> : null}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function State({ ok, partial, label }) {
  const icon = ok ? 'checkmark-circle' : partial ? 'remove-circle' : 'close-circle';
  const color = ok ? colors.success : partial ? '#D97706' : colors.danger;
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F5F9' },
  web: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flex: 1, backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.06)', minHeight: '100vh' } : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  content: { padding: 16, paddingBottom: 40, backgroundColor: '#F8FAFC', flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EEF2F7' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  statusSub: { fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  states: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stateText: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  group: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  groupLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  groupSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 10, lineHeight: 17 },
});
