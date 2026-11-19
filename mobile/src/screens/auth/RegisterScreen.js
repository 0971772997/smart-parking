// UI-002 Dang ky - se lam o buoc tiep theo (username, email, mat khau, xac nhan mat khau)
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AuthLayout from '../../components/AuthLayout';
import Button from '../../components/Button';
import { colors } from '../../theme';

export default function RegisterScreen({ navigation }) {
  return (
    <AuthLayout onBack={() => navigation.goBack()} title="Đăng ký">
      <View style={styles.box}>
        <Ionicons name="construct-outline" size={40} color={colors.textMuted} />
        <Text style={styles.text}>Màn hình đăng ký sẽ được làm ở bước tiếp theo.</Text>
      </View>
      <Button title="Quay lại đăng nhập" variant="outline" onPress={() => navigation.goBack()} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  text: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
});
