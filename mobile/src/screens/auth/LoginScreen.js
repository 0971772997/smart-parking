// UI-001 LOGIN SCREEN
// Form chinh: ID (email) + mat khau, Luu ID, Tu dong dang nhap
// Lien ket: Tim ID, Quen mat khau, Dang ky
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AuthLayout from '../../components/AuthLayout';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import Logo from '../../components/Logo';
import Notice from '../../components/Notice';
import TextField from '../../components/TextField';
import { authApi } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { storage } from '../../storage';
import { colors } from '../../theme';
import { isEmail } from '../../utils/validate';

const SLOW_MSG = 'Máy chủ đang khởi động, có thể mất tới 50 giây…';

export default function LoginScreen({ navigation, route }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saveId, setSaveId] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [errs, setErrs] = useState({});
  const passRef = useRef(null);

  // Doc tuy chon "Luu ID" / "Tu dong dang nhap"
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
    if (p?.email) { setEmail(p.email); setPassword(''); }
    if (p?.message) setInfo(p.message);
  }, [route.params]);

  const edit = (setter, key) => (t) => { setter(t); if (errs[key]) setErrs((e) => ({ ...e, [key]: undefined })); };

  async function onLogin() {
    const e = {};
    if (!isEmail(email)) e.email = 'Vui lòng nhập email hợp lệ';
    if (!password) e.password = 'Vui lòng nhập mật khẩu';
    setErrs(e);
    if (Object.keys(e).length) return;

    const id = email.trim().toLowerCase();
    setError(''); setInfo(''); setBusy(true); setSlow(false);
    try {
      const res = await authApi.login(id, password, { onSlow: () => setSlow(true) });
      await storage.setLoginPrefs({ saveId, autoLogin, email: id });
      await signIn(res, { remember: autoLogin });
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false); setSlow(false);
    }
  }

  return (
    <AuthLayout
      footer={
        <View style={styles.row}>
          <Text style={styles.muted}>Chưa có tài khoản?</Text>
          <Pressable onPress={() => navigation.navigate('Register')} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Đăng ký</Text>
          </Pressable>
        </View>
      }
    >
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Logo size={80} />
        <Text style={styles.appName}>SmartPark</Text>
        <Text style={styles.welcome}>Đăng nhập để tìm và đặt chỗ đỗ xe</Text>
      </View>

      <Notice type="success">{info}</Notice>
      <Notice type="error">{error}</Notice>
      {busy && slow ? <Notice type="info">{SLOW_MSG}</Notice> : null}

      <TextField
        label="ID (Email)"
        icon="mail-outline"
        placeholder="Nhập email"
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
        onSubmitEditing={onLogin}
        testID="login-password"
      />

      <View style={styles.options}>
        <Checkbox label="Lưu ID" checked={saveId} onChange={setSaveId} testID="save-id" />
        <Checkbox label="Tự động đăng nhập" checked={autoLogin} onChange={setAutoLogin} testID="auto-login" />
      </View>

      <Button title="Đăng nhập" onPress={onLogin} loading={busy} testID="login-submit" />

      <View style={[styles.row, styles.links]}>
        <Pressable onPress={() => navigation.navigate('FindId')} hitSlop={8} accessibilityRole="link">
          <Text style={styles.linkMuted}>Tìm ID</Text>
        </Pressable>
        <View style={styles.sep} />
        <Pressable
          onPress={() => navigation.navigate('FindPassword', { email: isEmail(email) ? email.trim() : '' })}
          hitSlop={8}
          accessibilityRole="link"
        >
          <Text style={styles.linkMuted}>Quên mật khẩu</Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: 32, marginBottom: 32 },
  appName: { fontSize: 28, fontWeight: '900', color: colors.navy, marginTop: 16 },
  welcome: { fontSize: 15, color: colors.textMuted, marginTop: 6 },
  options: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  links: { gap: 16, marginTop: 20 },
  sep: { width: 1, height: 14, backgroundColor: colors.border },
  linkMuted: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  muted: { fontSize: 14, color: colors.textMuted },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
});
