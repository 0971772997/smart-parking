// Trang chu tam thoi - de kiem tra luong dang nhap / tu dong dang nhap / dang xuat
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Button from '../../components/Button';
import Logo from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import { colors, radius, shadow } from '../../theme';

export default function HomeScreen({ navigation }) {
  const { user, signOut } = useAuth();

  async function onLogout() {
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.inner}>
        <Logo size={64} />
        <Text style={styles.hello}>Xin chào, {user?.username || user?.fullName || user?.email}!</Text>
        <View style={styles.card}>
          <Row k="ID (Email)" v={user?.email} />
          <Row k="Tên đăng nhập" v={user?.username || '—'} />
          <Row k="Số điện thoại" v={user?.phone || '—'} />
          <Row k="Vai trò" v={user?.role === 'admin' ? 'Quản trị viên' : 'Người dùng'} />
        </View>
        <Text style={styles.note}>Trang chủ (bản đồ bãi đỗ, đặt chỗ) sẽ được làm ở các bước sau.</Text>
        <Button title="Đăng xuất" variant="outline" onPress={onLogout} style={{ alignSelf: 'stretch' }} testID="logout" />
      </View>
    </SafeAreaView>
  );
}

function Row({ k, v }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, padding: 24, alignItems: 'center', width: '100%', maxWidth: 440, alignSelf: 'center', paddingTop: 48 },
  hello: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 20, marginBottom: 20 },
  card: { alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, ...shadow.card },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.bg },
  k: { color: colors.textMuted, fontSize: 14 },
  v: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  note: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginVertical: 24 },
});
