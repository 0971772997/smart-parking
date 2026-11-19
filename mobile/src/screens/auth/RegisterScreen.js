// UI-002 DANG KY: ten dang nhap, email, so dien thoai, mat khau, nhap lai mat khau
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AuthLayout from '../../components/AuthLayout';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import TextField from '../../components/TextField';
import { authApi } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { storage } from '../../storage';
import { colors } from '../../theme';
import { isEmail, isUsername, normalizePhone } from '../../utils/validate';

// Loi tu server -> hien ngay duoi o tuong ung
const FIELD_ERRORS = {
  username_taken: ['username', 'Tên đăng nhập đã có người dùng'],
  email_taken: ['email', 'Email đã được đăng ký'],
  password_mismatch: ['confirm', 'Mật khẩu nhập lại không khớp'],
};

export default function RegisterScreen({ navigation }) {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', phone: '', password: '', confirm: '' });
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refs = { email: useRef(null), phone: useRef(null), password: useRef(null), confirm: useRef(null) };

  const set = (key) => (t) => {
    setForm((f) => ({ ...f, [key]: t }));
    if (errs[key]) setErrs((e) => ({ ...e, [key]: undefined }));
  };

  function validate() {
    const e = {};
    if (!isUsername(form.username)) e.username = '4–30 ký tự: chữ không dấu, số, dấu _ hoặc .';
    if (!isEmail(form.email)) e.email = 'Email không hợp lệ';
    if (!normalizePhone(form.phone)) e.phone = 'Số điện thoại không hợp lệ (vd: 0901234567)';
    if (form.password.length < 6) e.password = 'Mật khẩu tối thiểu 6 ký tự';
    if (!form.confirm) e.confirm = 'Vui lòng nhập lại mật khẩu';
    else if (form.confirm !== form.password) e.confirm = 'Mật khẩu nhập lại không khớp';
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function onRegister() {
    if (!validate()) return;
    setError(''); setBusy(true);
    const email = form.email.trim().toLowerCase();
    try {
      const res = await authApi.register({
        username: form.username.trim(),
        email,
        phone: normalizePhone(form.phone),
        password: form.password,
        confirmPassword: form.confirm,
      });
      await storage.setLoginPrefs({ saveId: true, autoLogin: false, email });
      await signIn(res, { remember: false });
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      const field = FIELD_ERRORS[e.code];
      if (field) setErrs((x) => ({ ...x, [field[0]]: field[1] }));
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      onBack={() => navigation.goBack()}
      title="Tạo tài khoản"
      subtitle="Đăng ký để tìm chỗ trống và đặt chỗ đỗ xe trước."
      footer={
        <View style={styles.row}>
          <Text style={styles.muted}>Đã có tài khoản?</Text>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Đăng nhập</Text>
          </Pressable>
        </View>
      }
    >
      <Notice type="error">{error}</Notice>
      <TextField
        label="Tên đăng nhập" icon="person-outline" placeholder="vd: minhvo01"
        autoComplete="username-new" textContentType="username"
        value={form.username} onChangeText={set('username')} error={errs.username}
        returnKeyType="next" onSubmitEditing={() => refs.email.current?.focus()}
        testID="reg-username"
      />
      <TextField
        ref={refs.email} label="Email" icon="mail-outline" placeholder="ban@email.com"
        keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
        value={form.email} onChangeText={set('email')} error={errs.email}
        returnKeyType="next" onSubmitEditing={() => refs.phone.current?.focus()}
        testID="reg-email"
      />
      <TextField
        ref={refs.phone} label="Số điện thoại" icon="call-outline" placeholder="0901234567"
        keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
        value={form.phone} onChangeText={set('phone')} error={errs.phone}
        returnKeyType="next" onSubmitEditing={() => refs.password.current?.focus()}
        testID="reg-phone"
      />
      <TextField
        ref={refs.password} label="Mật khẩu" icon="lock-closed-outline" placeholder="Tối thiểu 6 ký tự" secure
        autoComplete="new-password" textContentType="newPassword"
        value={form.password} onChangeText={set('password')} error={errs.password}
        returnKeyType="next" onSubmitEditing={() => refs.confirm.current?.focus()}
        testID="reg-password"
      />
      <TextField
        ref={refs.confirm} label="Nhập lại mật khẩu" icon="lock-closed-outline" placeholder="Nhập lại mật khẩu" secure
        autoComplete="new-password" textContentType="newPassword"
        value={form.confirm} onChangeText={set('confirm')} error={errs.confirm}
        returnKeyType="go" onSubmitEditing={onRegister}
        testID="reg-confirm"
      />
      <Button title="Đăng ký" onPress={onRegister} loading={busy} style={styles.submit} testID="reg-submit" />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  submit: { marginTop: 8 },
  row: { flexDirection: 'row', gap: 6 },
  muted: { fontSize: 14, color: colors.textMuted },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
});
