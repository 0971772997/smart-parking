// Quen mat khau: email -> OTP -> dat mat khau moi
import { useState } from 'react';
import AuthLayout from '../../components/AuthLayout';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import OtpStep from '../../components/OtpStep';
import TextField from '../../components/TextField';
import { authApi } from '../../api/auth';
import { useOtp } from '../../hooks/useOtp';
import { isEmail } from '../../utils/validate';

export default function FindPasswordScreen({ navigation, route }) {
  const [email, setEmail] = useState(route.params?.email || '');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const otp = useOtp('reset_password');

  async function run(fn) {
    setError(''); setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function onSend() {
    if (!isEmail(email)) { setErrs({ email: 'Vui lòng nhập email hợp lệ' }); return; }
    setErrs({});
    run(async () => { setCode(''); await otp.send({ email: email.trim().toLowerCase() }); });
  }

  function onReset() {
    const e = {};
    if (code.length !== 6) e.code = true;
    if (pw.length < 6) e.pw = 'Mật khẩu tối thiểu 6 ký tự';
    if (pw2 !== pw) e.pw2 = 'Mật khẩu xác nhận không khớp';
    setErrs(e);
    if (e.code) setError('Vui lòng nhập đủ 6 số của mã OTP');
    if (Object.keys(e).length) return;
    run(async () => {
      await authApi.resetPassword(otp.session.otpId, code, pw, pw2);
      navigation.navigate('Login', {
        email: email.trim().toLowerCase(),
        message: 'Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.',
      });
    });
  }

  return (
    <AuthLayout
      onBack={() => navigation.goBack()}
      title="Quên mật khẩu"
      subtitle={otp.session
        ? 'Nhập mã xác minh và đặt mật khẩu mới cho tài khoản của bạn.'
        : 'Nhập ID (email) của bạn. Chúng tôi sẽ gửi mã xác minh để đặt lại mật khẩu.'}
    >
      <Notice type="error">{error}</Notice>
      <TextField
        label="ID (Email)" icon="mail-outline" placeholder="ban@email.com" keyboardType="email-address"
        value={email} onChangeText={(t) => { setEmail(t); setErrs({}); otp.reset(); }} error={errs.email}
        editable={!otp.session}
      />
      <OtpStep otp={otp} code={code} setCode={setCode} error={errs.code} onResend={onSend} />
      {otp.session ? (
        <>
          <TextField
            label="Mật khẩu mới" icon="lock-closed-outline" placeholder="Tối thiểu 6 ký tự" secure
            autoComplete="new-password" textContentType="newPassword"
            value={pw} onChangeText={(t) => { setPw(t); setErrs({}); }} error={errs.pw}
          />
          <TextField
            label="Xác nhận mật khẩu mới" icon="lock-closed-outline" placeholder="Nhập lại mật khẩu" secure
            autoComplete="new-password" textContentType="newPassword"
            value={pw2} onChangeText={(t) => { setPw2(t); setErrs({}); }} error={errs.pw2}
          />
          <Button title="Đặt lại mật khẩu" onPress={onReset} loading={busy} />
        </>
      ) : (
        <Button title="Gửi mã xác minh" onPress={onSend} loading={busy} />
      )}
    </AuthLayout>
  );
}
