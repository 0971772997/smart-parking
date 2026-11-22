// QUAN TRI - THONG BAO CHUNG: gui thong bao (trong app + day toi dien thoai) cho moi tai xe hoac tai xe lien quan 1 bai
// (tung gui xe / dat cho / yeu thich bai). Lich su da gui.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenShell from '../../components/ScreenShell';
import Notice from '../../components/Notice';
import Button from '../../components/Button';
import { Card, Chips, PromptDialog, listStyles as L } from '../../components/admin/ui';
import { adminApi } from '../../api/admin';
import { colors, radius } from '../../theme';
import { formatDateTime } from '../../utils/booking';

export default function AdminBroadcastScreen({ navigation }) {
  const [lots, setLots] = useState([]);
  const [audience, setAudience] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [history, setHistory] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, h] = await Promise.all([adminApi.lots(), adminApi.broadcasts()]);
      setLots(l);
      setHistory(h);
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const audiences = [{ key: 'all', label: 'Mọi tài xế', icon: 'people' }, ...lots.map((l) => ({ key: `lot:${l.id}`, label: l.name, icon: 'business' }))];
  const audienceLabel = (a) => (a === 'all' ? 'Mọi tài xế' : `Tài xế liên quan ${lots.find((l) => `lot:${l.id}` === a)?.name || a.slice(4)}`);
  const ok = title.trim().length >= 3;

  return (
    <ScreenShell navigation={navigation} title="Thông báo chung">
      <ScrollView contentContainerStyle={L.content} keyboardShouldPersistTaps="handled">
        {notice ? <Notice type={notice.type}>{notice.text}</Notice> : null}
        <Card>
          <Text style={styles.label}>Gửi tới</Text>
          <Chips options={audiences} value={audience} onChange={setAudience} />
          {audience !== 'all' ? <Text style={L.sub}>Tài xế từng gửi xe, đặt chỗ hoặc lưu yêu thích bãi này.</Text> : null}
          <Text style={styles.label}>Tiêu đề *</Text>
          <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="vd: Bảo trì hệ thống 23:00 tối nay"
            placeholderTextColor={colors.placeholder} style={styles.input} />
          <Text style={styles.label}>Nội dung</Text>
          <TextInput value={body} onChangeText={setBody} maxLength={500} multiline placeholder="Chi tiết thông báo..."
            placeholderTextColor={colors.placeholder} style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]} />
          <Text style={styles.counter}>{body.length}/500</Text>
          {/* Xem truoc giong thong bao tren dien thoai */}
          {ok ? (
            <View style={styles.preview}>
              <Text style={styles.pApp}>SMARTPARK • bây giờ</Text>
              <Text style={styles.pTitle}>{title.trim()}</Text>
              {body.trim() ? <Text style={styles.pBody} numberOfLines={3}>{body.trim()}</Text> : null}
            </View>
          ) : null}
          <Button title="Gửi thông báo" disabled={!ok} onPress={() => setConfirm(true)} style={{ marginTop: 12 }} />
        </Card>

        <Text style={styles.section}>Đã gửi</Text>
        {history === null ? <ActivityIndicator color={colors.primary} /> : null}
        {history && !history.length ? <Text style={L.sub}>Chưa gửi thông báo chung nào.</Text> : null}
        {(history || []).map((b) => (
          <Card key={b.id}>
            <Text style={L.title}>{b.title}</Text>
            {b.body ? <Text style={[L.sub, { color: colors.text }]}>{b.body}</Text> : null}
            <Text style={L.sub}>{audienceLabel(b.audience)} • {b.recipients} người nhận • {formatDateTime(b.createdAt)} • {b.createdBy}</Text>
          </Card>
        ))}
      </ScrollView>
      <PromptDialog visible={confirm} title="Gửi thông báo?" confirmLabel="Gửi"
        message={`“${title.trim()}” sẽ được gửi tới ${audienceLabel(audience).toLowerCase()} (trong app và thông báo đẩy). Không thể thu hồi.`}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          const r = await adminApi.broadcast({ title: title.trim(), body: body.trim() || undefined, audience });
          setConfirm(false);
          setTitle('');
          setBody('');
          setNotice({ type: 'success', text: `Đã gửi tới ${r.recipients} tài xế.` });
          load();
        }} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text },
  counter: { fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 4 },
  preview: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: '#F1F5F9' },
  pApp: { fontSize: 10.5, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  pTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 4 },
  pBody: { fontSize: 13, color: colors.text, marginTop: 2 },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
});
