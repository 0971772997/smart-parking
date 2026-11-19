// UI-001 LOGIN SCREEN
// - Dang nhap bang ID (email) + mat khau
// - Dang nhap bang ten dang nhap + SDT (OTP)
// - Luu ID, Tu dong dang nhap, Tim ID, Quen mat khau
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AuthLayout from '../../components/AuthLayout';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import Logo from '../../components/Logo';
import Notice from '../../components/Notice';
import OtpStep from '../../components/OtpStep';
import SegmentedTabs from '../../components/SegmentedTabs';
import TextField from '../../components/TextField';
import { authApi } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { useOtp } from '../../hooks/useOtp';
import { storage } from '../../storage';
import { colors } from '../../theme';
import { isEmail, normalizePhone } from '../../utils/validate';

const TABS = [
  { key: 'id', label: 'Email & mật khẩu' },
  { key: 'phone', label: 'Tên & SĐT' },
];
const SLOW_MSG = 'Máy chủ đang khởi động (gói miễn phí), có thể mất tới 50 giây…';

export default function LoginScreen({ navigation, route }) {
  const { signIn } = useAuth();
  const [tab, setTab] = useState('id');
  const [saveId, setSaveId] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [errs, setErrs] = useState({});

  // Tab 1
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passRef = useRef(null);
  // Tab 2
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const otp = useOtp('login_phone');

  // Khoi tao: doc tuy chon "Luu ID" / "Tu dong dang nhap"
  useEffect(() => {
    storage.getLoginPrefs().then((p) => {
      setSaveId(p.saveId);
      setAutoLogin(p.autoLogin);
      if (p.saveId && p.savedEmail) setEmail(p.savedEmail);
    });
  }, []);

  // Quay ve tu "Tim ID" / "Quen mat khau"
  useEffect(() => {
    const p = route.params;
    if (p?.email) { setTab('id'); setEmail(p.email); setPassword(''); }
    if (p?.message) setInfo(p.message);
  }, [route.params]);

  const switchTab = (k) => { setTab(k); setError(''); setErrs({}); };
  // Sua o nao thi xoa loi cua o do
  const edit = (setter, key) => (t) => { setter(t); if (errs[key]) setErrs((e) => ({ ...e, [key]: undefined })); };

  async function finish(res, loginEmail) {
    await storage.setLoginPrefs({ saveId, autoLogin, email: loginEmail || res.user.email });
    await signIn(res, { remember: autoLogin });
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }

  async function run(fn) {
    setError(''); setInfo(''); setBusy(true); setSlow(false);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); setSlow(false); }
  }

  // ---- Dang nhap bang email + mat khau ----
  function onLoginId() {
    const e = {};
    if (!isEmail(email)) e.email = 'Vui lòng nhập email hợp lệ';
    if (!password) e.password = 'Vui lòng nhập mật khẩu';
    setErrs(e);
    if (Object.keys(e).length) return;
    run(async () => {
      const res = await authApi.login(email.trim().toLowerCase(), password, { onSlow: () => setSlow(true) });
      await finish(res, email.trim().toLowerCase());
    });
  }

  // ---- Dang nhap bang ten + SDT ----
  function onSendOtp() {
    const e = {};
    if (username.trim().length < 4) e.username = 'Vui lòng nhập tên đăng nhập';
    if (!normalizePhone(phone)) e.phone = 'Số điện thoại không hợp lệ (vd: 0901234567)';
    setErrs(e);
    if (Object.keys(e).length) return;
    run(async () => {
      setCode('');
      await otp.send({ username: username.trim(), phone: normalizePhone(phone) }, { onSlow: () => setSlow(true) });
    });
  }

  function onLoginPhone() {
    if (code.length !== 6) { setErrs({ code: true }); setError('Vui lòng nhập đủ 6 số của mã OTP'); return; }
    run(async () => {
      const res = await authApi.loginWithPhone(otp.session.otpId, code);
      await finish(res);
    });
  }

  return (
    <AuthLayout
      header={
        <View style={styles.brand}>
          <Logo size={56} />
          <View>
            <Text style={styles.brandName}>SmartPark</Text>
            <Text style={styles.brandSub}>Bãi đỗ xe thông minh</Text>
          </View>
        </View>
      }
      title="Đăng nhập"
      subtitle="Chào mừng bạn quay lại! Đăng nhập để tìm và đặt chỗ đỗ xe."
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.muted}>Chưa có tài khoản?</Text>
          <Pressable onPress={() => navigation.navigate('Register')} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Đăng ký</Text>
          </Pressable>
        </View>
      }
    >
      <StatusBar style="dark" />
      <SegmentedTabs tabs={TABS} value={tab} onChange={switchTab} />

      <Notice type="success">{info}</Notice>
      <Notice type="error">{error}</Notice>
      {busy && slow ? <Notice type="info">{SLOW_MSG}</Notice> : null}

      {tab === 'id' ? (
        <>
          <TextField
            label="ID (Email)"
            icon="mail-outline"
            placeholder="ban@email.com"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            value={email}
            onChangeText={edit(setEmail, 'email')}
            error={errs.email}
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
            testID="login-email"
          />
          <TextField
            ref={passRef}
            label="Mật khẩu"
            icon="lock-closed-outline"
            placeholder="Nhập mật khẩu"
            secure
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={edit(setPassword, 'password')}
            error={errs.password}
            returnKeyType="go"
            onSubmitEditing={onLoginId}
            testID="login-password"
          />
        </>
      ) : (
        <>
          <TextField
            label="Tên đăng nhập"
            icon="person-outline"
            placeholder="vd: minhvo01"
            autoComplete="username"
            value={username}
            onChangeText={(t) => { edit(setUsername, 'username')(t); otp.reset(); }}
            error={errs.username}
            editable={!otp.session}
          />
          <TextField
            label="Số điện thoại"
            icon="call-outline"
            placeholder="0901234567"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={(t) => { edit(setPhone, 'phone')(t); otp.reset(); }}
            error={errs.phone}
            editable={!otp.session}
          />
          {otp.session ? (
            <Pressable onPress={() => { otp.reset(); setCode(''); }} style={styles.changeRow} accessibilityRole="button">
              <Text style={styles.link}>Đổi tên đăng nhập / số điện thoại</Text>
            </Pressable>
          ) : null}
          <OtpStep otp={otp} code={code} setCode={(c) => { setCode(c); setErrs({}); }} error={errs.code} onResend={onSendOtp} />
        </>
      )}

      <View style={styles.options}>
        {tab === 'id' ? <Checkbox label="Lưu ID" checked={saveId} onChange={setSaveId} testID="save-id" /> : <View />}
        <Checkbox label="Tự động đăng nhập" checked={autoLogin} onChange={setAutoLogin} testID="auto-login" />
      </View>

      {tab === 'id' ? (
        <Button title="Đăng nhập" onPress={onLoginId} loading={busy} testID="login-submit" />
      ) : otp.session ? (
        <Button title="Xác nhận & đăng nhập" onPress={onLoginPhone} loading={busy} disabled={code.length !== 6} />
      ) : (
        <Button title="Gửi mã OTP" onPress={onSendOtp} loading={busy || otp.sending} />
      )}

      <View style={styles.links}>
        <Pressable onPress={() => navigation.navigate('FindId')} hitSlop={8} accessibilityRole="link">
          <Text style={styles.linkMuted}>Tìm ID</Text>
        </Pressable>
        <View style={styles.dot} />
        <Pressable onPress={() => navigation.navigate('FindPassword', { email: isEmail(email) ? email.trim() : '' })} hitSlop={8} accessibilityRole="link">
          <Text style={styles.linkMuted}>Quên mật khẩu</Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginBottom: 32 },
  brandName: { fontSize: 22, fontWeight: '900', color: colors.navy },
  brandSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  options: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, marginBottom: 20 },
  changeRow: { alignSelf: 'flex-end', marginTop: -6, marginBottom: 14 },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 20 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.border },
  linkMuted: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  footerRow: { flexDirection: 'row', gap: 6 },
  muted: { fontSize: 14, color: colors.textMuted },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
});
