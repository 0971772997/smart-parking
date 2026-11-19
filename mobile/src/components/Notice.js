import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

const TYPES = {
  error: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle' },
  success: { bg: colors.successSoft, fg: colors.success, icon: 'checkmark-circle' },
  info: { bg: colors.primarySoft, fg: colors.primaryDark, icon: 'information-circle' },
};

// Hop thong bao trong man hinh (thay cho Alert de khong chan thao tac)
export default function Notice({ type = 'error', children, actionLabel, onAction }) {
  if (!children) return null;
  const t = TYPES[type];
  return (
    <View style={[styles.box, { backgroundColor: t.bg }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Ionicons name={t.icon} size={18} color={t.fg} />
      <Text style={[styles.text, { color: t.fg }]}>{children}</Text>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.action, { color: t.fg }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, marginBottom: 14 },
  text: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  action: { fontSize: 13.5, fontWeight: '700', textDecorationLine: 'underline' },
});
