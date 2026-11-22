// Thong bao noi tren cung man hinh khi co thong bao moi (phien gui xe, thay doi chi phi...)
// Bam -> mo phien gui xe / dat cho lien quan. Tu an sau 6 giay.
import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLive } from '../context/LiveContext';
import { navigate } from '../navigation/ref';
import { NOTE_TYPE } from '../utils/session';
import { colors, radius } from '../theme';

const SHOW_MS = 6000;

export function openNotification(n) {
  if (n.data?.ticketId) navigate('SupportTicket', { id: n.data.ticketId });
  else if (n.type === 'review_reply' && n.data?.lotId) navigate('LotReviews', { lotId: n.data.lotId });
  else if (n.type === 'paid' && n.data?.paymentId) navigate('Receipt', { paymentId: n.data.paymentId });
  else if (n.type === 'payment_failed' && n.sessionId) navigate('Payment', { sessionId: n.sessionId });
  else if (n.sessionId) navigate('SessionDetail', { id: n.sessionId });
  else if (n.reservationId) navigate('ReservationDetail', { id: n.reservationId });
}

export default function NotificationToast() {
  const { toast, dismissToast } = useLive();
  const insets = useSafeAreaInsets();
  const [y] = useState(() => new Animated.Value(-140));

  useEffect(() => {
    if (!toast) return undefined;
    Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== 'web', friction: 8 }).start();
    const t = setTimeout(() => {
      Animated.timing(y, { toValue: -140, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(() => dismissToast());
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [toast, y, dismissToast]);

  if (!toast) return null;
  const cfg = NOTE_TYPE[toast.type] || { icon: 'notifications', color: colors.primary };
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}>
      <Pressable
        onPress={() => { dismissToast(); openNotification(toast); }}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
        accessibilityRole="alert"
        accessibilityLabel={`${toast.title}. ${toast.body || ''}`}
      >
        <View style={[styles.icon, { backgroundColor: `${cfg.color}1A` }]}>
          <Ionicons name={cfg.icon} size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{toast.title}</Text>
          {toast.body ? <Text style={styles.body} numberOfLines={2}>{toast.body}</Text> : null}
        </View>
        <Pressable onPress={dismissToast} hitSlop={10} accessibilityLabel="Đóng thông báo">
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1000, elevation: 20 },
  card: {
    width: '100%', maxWidth: 500, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#0F172A', shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '800', color: colors.text },
  body: { fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
});
