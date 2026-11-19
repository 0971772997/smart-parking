// Tim ID (email) bang ten dang nhap + SDT, xac minh OTP
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AuthLayout from '../../components/AuthLayout';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import OtpStep from '../../components/OtpStep';
import TextField from '../../components/TextField';
import { authApi } from '../../api/auth';
import { useOtp } from '../../hooks/useOtp';
import { colors, radius, shadow } from '../../theme';
import { normalizePhone } from '../../utils/validate';

export default function FindIdScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const otp = useOtp('find_id');

  async function run(fn) {
    setError(''); setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function onSend() {
    const e = {};
    if (username.trim().length < 4) e.username = 'Vui lòng nhập tên đăng nhập';
    if (!normalizePhone(phone)) e.phone = 'Số điện thoại không hợp lệ (vd: 0901234567)';
    setErrs(e);
    if (Object.keys(e).length) return;
    run(async () => { setCode(''); await otp.send({ username: username.trim(), phone: normalizePhone(phone) }); });
  }

  function onVerify() {
    run(async () => setResult(await authApi.findId(otp.session.otpId, code)));
  }

  if (result) {
    const joined = new Date(result.createdAt).toLocaleDateString('vi-VN');
    return (
      <AuthLayout onBack={() => navigation.goBack()} title="Đã tìm thấy ID" subtitle="Đây là ID (email) đăng nhập của bạn.">
        <View style={styles.card}>
          <View style={styles.icon}><Ionicons name="mail" size={22} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.email} selectable>{result.email}</Text>
            <Text style={styles.meta}>Tên đăng nhập: {result.username} · Tham gia {joined}</Text>
          </View>
        </View>
        <Button title="Đăng nhập với ID này" onPress={() => navigation.navigate('Login', { email: result.email })} />
        <Button
          title="Quên mật khẩu?"
          variant="ghost"
          style={{ marginTop: 8 }}
          onPress={() => navigation.replace('FindPassword', { email: result.email })}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      onBack={() => navigation.goBack()}
      title="Tìm ID"
      subtitle="Nhập tên đăng nhập và số điện thoại đã đăng ký. Chúng tôi sẽ gửi mã xác minh tới số điện thoại đó."
    >
      <Notice type="error">{error}</Notice>
      <TextField
        label="Tên đăng nhập" icon="person-outline" placeholder="vd: minhvo01"
        value={username} onChangeText={(t) => { setUsername(t); setErrs({}); otp.reset(); }} error={errs.username}
        editable={!otp.session}
      />
      <TextField
        label="Số điện thoại" icon="call-outline" placeholder="0901234567" keyboardType="phone-pad"
        value={phone} onChangeText={(t) => { setPhone(t); setErrs({}); otp.reset(); }} error={errs.phone}
        editable={!otp.session}
      />
      <OtpStep otp={otp} code={code} setCode={setCode} onResend={onSend} />
      {otp.session ? (
        <Button title="Xác nhận" onPress={onVerify} loading={busy} disabled={code.length !== 6} />
      ) : (
        <Button title="Gửi mã xác minh" onPress={onSend} loading={busy} />
      )}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, marginBottom: 24,
    backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.card,
  },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  email: { fontSize: 17, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
});
