// Hop thoai thong bao / xac nhan chay duoc tren MOI nen tang.
// Alert.alert cua react-native-web la ham rong -> tren web cac nut "Xoa" / thong bao loi khong bao gio hien.
//  - Dien thoai: Alert.alert goc
//  - Web: window.alert (1 nut) / window.confirm (co nut huy) -> goi onPress tuong ung
import { Alert, Platform } from 'react-native';

export function appAlert(title, message, buttons) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);
  const w = globalThis.window || globalThis;
  const text = [title, message].filter(Boolean).join('\n\n');
  if (!buttons || buttons.length <= 1) {
    w.alert?.(text);
    buttons?.[0]?.onPress?.();
    return undefined;
  }
  const cancel = buttons.find((b) => b.style === 'cancel');
  const action = buttons.find((b) => b !== cancel);
  if (w.confirm?.(text)) action?.onPress?.();
  else cancel?.onPress?.();
  return undefined;
}
