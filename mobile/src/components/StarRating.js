// Hien thi / chon so sao (1-5)
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GOLD = '#F59E0B';

export default function StarRating({ value = 0, size = 16, onChange, gap = 2 }) {
  return (
    <View style={[styles.row, { gap }]} accessibilityLabel={`${value} trên 5 sao`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const name = value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline';
        const icon = <Ionicons name={name} size={size} color={value >= n - 0.5 ? GOLD : '#CBD5E1'} />;
        return onChange ? (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${n} sao`}>
            {icon}
          </Pressable>
        ) : <View key={n}>{icon}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
