import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

const PROVIDERS = [
  { key: 'google', label: 'Google', icon: 'logo-google', iconColor: '#EA4335', bg: '#fff', fg: colors.text, border: colors.border },
  { key: 'facebook', label: 'Facebook', icon: 'logo-facebook', iconColor: '#fff', bg: '#1877F2', fg: '#fff', border: '#1877F2' },
];

// Duong ke "hoac" + 2 nut Google / Facebook. onPress(provider) tra ve Promise.
export default function SocialButtons({ title = 'hoặc đăng nhập với', onPress, disabled }) {
  const [loading, setLoading] = useState(null);

  async function handle(key) {
    if (loading || disabled) return;
    setLoading(key);
    try { await onPress(key); } finally { setLoading(null); }
  }

  return (
    <View>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>{title}</Text>
        <View style={styles.line} />
      </View>
      <View style={styles.row}>
        {PROVIDERS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => handle(p.key)}
            accessibilityRole="button"
            accessibilityLabel={`Đăng nhập bằng ${p.label}`}
            testID={`social-${p.key}`}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: p.bg, borderColor: p.border },
              pressed && styles.pressed,
              (disabled || (loading && loading !== p.key)) && styles.dim,
            ]}
          >
            {loading === p.key ? (
              <ActivityIndicator color={p.fg} />
            ) : (
              <>
                <Ionicons name={p.icon} size={20} color={p.iconColor} />
                <Text style={[styles.text, { color: p.fg }]}>{p.label}</Text>
              </>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28, marginBottom: 16 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { fontSize: 13, color: colors.placeholder },
  row: { flexDirection: 'row', gap: 12 },
  btn: {
    flex: 1, height: 50, borderRadius: radius.md, borderWidth: 1.5,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  text: { fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.5 },
});
