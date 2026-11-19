import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../theme';

// 6 o hien thi ma OTP, dung 1 TextInput an de nhap (ho tro dan ma / autofill SMS)
export default function OtpInput({ value, onChange, error, autoFocus }) {
  const ref = useRef(null);
  const digits = value.padEnd(6, ' ').split('');
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Nhập mã OTP 6 số">
      <View style={styles.row}>
        {digits.map((d, i) => {
          const active = i === Math.min(value.length, 5);
          return (
            <View key={i} style={[styles.cell, active && styles.cellActive, !!error && styles.cellError]}>
              <Text style={styles.digit}>{d.trim()}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus={autoFocus}
        style={styles.hidden}
        caretHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cell: {
    flex: 1, height: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  cellActive: { borderColor: colors.primary },
  cellError: { borderColor: colors.danger },
  digit: { fontSize: 22, fontWeight: '700', color: colors.text },
  hidden: { position: 'absolute', opacity: 0, width: '100%', height: '100%' },
});
