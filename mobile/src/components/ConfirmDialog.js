import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Button from './Button';
import { colors, radius } from '../theme';

// Hop thoai xac nhan dung chung (Alert.alert khong chay tren web)
export default function ConfirmDialog({
  visible, title, message, confirmLabel = 'Đồng ý', cancelLabel = 'Huỷ', danger, loading, onConfirm, onCancel,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={[styles.icon, danger && styles.iconDanger]}>
            <Ionicons name={danger ? 'trash-outline' : 'help-circle-outline'} size={24} color={danger ? colors.danger : colors.primary} />
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.row}>
            <Button title={cancelLabel} variant="outline" onPress={onCancel} disabled={loading} style={styles.btn} />
            <Button
              title={confirmLabel}
              onPress={onConfirm}
              loading={loading}
              style={[styles.btn, danger && { backgroundColor: colors.danger }]}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, alignItems: 'center' },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  iconDanger: { backgroundColor: colors.dangerSoft },
  title: { fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' },
  message: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18, alignSelf: 'stretch' },
  btn: { flex: 1, height: 46 },
});
