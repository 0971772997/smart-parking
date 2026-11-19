import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

// Logo chu "P" + icon xe. size: chieu rong o vuong
export default function Logo({ size = 72, dark = false }) {
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: size * 0.28 }, dark && styles.boxDark]}>
      <Text style={[styles.p, { fontSize: size * 0.56 }]}>P</Text>
      <View style={[styles.badge, { width: size * 0.42, height: size * 0.42, borderRadius: size * 0.21, right: -size * 0.1, bottom: -size * 0.1 }]}>
        <Ionicons name="car-sport" size={size * 0.24} color="#fff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  boxDark: { backgroundColor: '#fff' },
  p: { color: '#fff', fontWeight: '900', marginTop: -2 },
  badge: {
    position: 'absolute', backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#fff',
  },
});
