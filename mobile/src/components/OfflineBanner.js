// Bao mat ket noi may chu (tu LiveContext). Ket noi lai -> tu an, du lieu tu dong bo lai.
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLive } from '../context/LiveContext';
import { formatClock } from '../utils/booking';

export default function OfflineBanner({ style }) {
  const { online, lastSyncAt } = useLive();
  if (online) return null;
  return (
    <View style={[styles.box, style]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={16} color="#92400E" />
      <Text style={styles.text}>
        Mất kết nối máy chủ – đang thử kết nối lại…
        {lastSyncAt ? ` Dữ liệu cập nhật lúc ${formatClock(lastSyncAt)}.` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FEF3C7' },
  text: { flex: 1, fontSize: 12.5, color: '#92400E', fontWeight: '600' },
});
