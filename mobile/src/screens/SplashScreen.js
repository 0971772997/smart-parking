import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as NativeSplash from 'expo-splash-screen';
import Logo from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

const MIN_SHOW_MS = 1600;

export default function SplashScreen({ navigation }) {
  const { restoreSession } = useAuth();
  const [slow, setSlow] = useState(false);
  const scale = useRef(new Animated.Value(0.6)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // An splash goc cua he dieu hanh, chuyen sang splash co animation nay
    NativeSplash.hideAsync().catch(() => {});
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    let alive = true;
    (async () => {
      const [user] = await Promise.all([
        restoreSession({ onSlow: () => alive && setSlow(true) }),
        new Promise((r) => setTimeout(r, MIN_SHOW_MS)),
      ]);
      if (alive) navigation.reset({ index: 0, routes: [{ name: user ? 'Home' : 'Login' }] });
    })();
    return () => { alive = false; };
  }, [navigation, restoreSession, scale, fade]);

  return (
    <LinearGradient colors={[colors.navy, colors.primaryDark]} style={styles.wrap}>
      <StatusBar style="light" />
      <Animated.View style={[styles.center, { opacity: fade, transform: [{ scale }] }]}>
        <Logo size={96} />
        <Text style={styles.name}>SmartPark</Text>
        <Text style={styles.tagline}>Bãi đỗ xe thông minh</Text>
      </Animated.View>
      <View style={styles.bottom}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.status}>{slow ? 'Đang khởi động máy chủ, vui lòng chờ…' : 'Đang tải…'}</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  name: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 28, letterSpacing: 0.5 },
  tagline: { color: 'rgba(255,255,255,0.75)', fontSize: 16, marginTop: 6 },
  bottom: { position: 'absolute', bottom: 64, alignItems: 'center', gap: 10 },
  status: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});
