import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme';

// tabs: [{ key, label }]
export default function SegmentedTabs({ tabs, value, onChange }) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.tab, on && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.text, on && styles.textOn]} numberOfLines={1}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: '#EEF2F7', borderRadius: radius.md, padding: 4, marginBottom: 20 },
  tab: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: {
    backgroundColor: colors.surface,
    shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  text: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  textOn: { color: colors.primary },
});
