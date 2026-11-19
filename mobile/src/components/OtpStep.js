import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import Notice from './Notice';
import OtpInput from './OtpInput';

// Buoc nhap OTP dung chung: thong bao da gui, o nhap ma, ma demo, gui lai
export default function OtpStep({ otp, code, setCode, error, onResend }) {
  const { session, cooldown, sending } = otp;
  if (!session) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.sent}>
        Mã xác minh 6 số đã được gửi tới{' '}
        <Text style={styles.bold}>{session.sentTo === 'email' ? 'email của bạn' : session.sentTo}</Text>
        . Mã có hiệu lực trong 5 phút.
      </Text>
      {session.devCode ? (
        <Notice type="info" actionLabel="Điền mã" onAction={() => setCode(session.devCode)}>
          Chế độ demo (chưa gửi SMS thật). Mã của bạn: {session.devCode}
        </Notice>
      ) : null}
      <OtpInput value={code} onChange={setCode} error={error} autoFocus />
      <View style={styles.resendRow}>
        <Text style={styles.muted}>Không nhận được mã?</Text>
        <Pressable onPress={cooldown > 0 || sending ? undefined : onResend} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.resend, (cooldown > 0 || sending) && styles.resendOff]}>
            {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : 'Gửi lại mã'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  sent: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: 12 },
  bold: { fontWeight: '700', color: colors.text },
  resendRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 },
  muted: { fontSize: 13.5, color: colors.textMuted },
  resend: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  resendOff: { color: colors.placeholder },
});
