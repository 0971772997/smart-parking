import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font } from '../theme';

// Khung chung cho man hinh xac thuc: nut quay lai, tieu de, cuon khi ban phim mo
export default function AuthLayout({ title, subtitle, onBack, header, children, footer }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            {onBack ? (
              <Pressable onPress={onBack} style={styles.back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quay lại">
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ) : null}
            {header}
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {children}
          </View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24 },
  inner: { width: '100%', maxWidth: 440, alignSelf: 'center', paddingTop: 8 },
  back: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, marginBottom: 16, marginLeft: -4,
  },
  title: { ...font.h1, marginBottom: 6 },
  subtitle: { fontSize: 15, color: colors.textMuted, lineHeight: 21, marginBottom: 24 },
  footer: { marginTop: 'auto', paddingTop: 24, alignItems: 'center' },
});
