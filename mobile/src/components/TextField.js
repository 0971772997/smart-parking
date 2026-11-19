import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

// O nhap lieu co nhan, icon, thong bao loi, nut an/hien mat khau
const TextField = forwardRef(function TextField(
  { label, icon, error, secure, hint, style, ...inputProps }, ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.box, focused && styles.boxFocus, !!error && styles.boxError]}>
        {icon ? <Ionicons name={icon} size={20} color={focused ? colors.primary : colors.placeholder} /> : null}
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={secure && hidden}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label || inputProps.placeholder}
          {...inputProps}
        />
        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Hiện mật khẩu' : 'Ẩn mật khẩu'}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

export default TextField;

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 52, paddingHorizontal: 14, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  boxFocus: { borderColor: colors.borderFocus },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, fontSize: 16, color: colors.text, height: '100%', outlineStyle: 'none' },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 5 },
  hint: { color: colors.textMuted, fontSize: 12.5, marginTop: 5 },
});
