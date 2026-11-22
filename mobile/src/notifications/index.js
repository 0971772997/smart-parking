// THONG BAO DAY + NHAC GIO CUC BO (expo-notifications, SDK 58)
// 3 trang thai deu nhan duoc thong bao he thong:
//   - Dang dung app      : setNotificationHandler -> hien banner + am thanh ngay ca khi app dang mo
//   - Thoat ra man hinh chinh / tat man hinh:
//       * su kien tuc thoi (dat cho, xe den, het han, thanh toan): may chu day qua Expo Push -> FCM/APNs
//         (can ban development build - Expo Go tren Android khong nhan duoc thong bao tu xa tu SDK 53)
//       * nhac theo gio (sap het gio giu cho / gui xe, qua gio): hen thong bao CUC BO tren may
//         -> van no khi tat app, tat man hinh, mat mang, may chu dang ngu; chay duoc ca tren Expo Go
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from '../api/client';

export const supported = Platform.OS !== 'web';
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? null;

const TOKEN_KEY = 'sp_push_token';
const PREFS_KEY = 'sp_notify_prefs';
const REMINDER_PREFIX = 'sp-';

// Kenh Android (phai tao TRUOC khi xin quyen / lay token - Android 13+). May chu gui kem channelId tuong ung.
const CHANNELS = [
  { id: 'parking', name: 'Đặt chỗ & gửi xe', description: 'Đặt chỗ thành công, xe đến cổng, xe vào ô, đặt chỗ hết hạn' },
  { id: 'payment', name: 'Thanh toán', description: 'Phí gửi xe, kết quả thanh toán' },
  { id: 'reminders', name: 'Nhắc giờ', description: 'Sắp hết giờ giữ chỗ, sắp hết / quá giờ gửi xe' },
];

let ready = false;

/** Goi 1 lan khi app khoi dong: cach hien thong bao khi app dang mo + tao kenh Android */
export async function setupNotifications() {
  if (!supported || ready) return;
  ready = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
    }),
  });
  if (Platform.OS === 'android') {
    await Promise.all(CHANNELS.map((c) => Notifications.setNotificationChannelAsync(c.id, {
      name: c.name, description: c.description,
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250], lightColor: '#1D4ED8', sound: 'default',
      lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    }))).catch(() => {});
  }
}

/** Trang thai quyen: 'granted' | 'denied' | 'undetermined' (ask = true -> hoi nguoi dung neu chua hoi) */
export async function permissionStatus({ ask = false } = {}) {
  if (!supported) return 'unsupported';
  await setupNotifications();
  let p = await Notifications.getPermissionsAsync();
  if (p.status !== 'granted' && ask && p.canAskAgain !== false) p = await Notifications.requestPermissionsAsync();
  return p.status;
}

/**
 * Dang ky nhan thong bao day voi may chu.
 * -> { mode: 'push' | 'local_only', reason?, token? }
 *    local_only: van co thong bao khi dang dung app + nhac gio cuc bo, nhung khong nhan su kien khi tat app
 */
export async function registerForPush({ ask = true } = {}) {
  if (!supported) return { mode: 'local_only', reason: 'web' };
  const status = await permissionStatus({ ask });
  if (status !== 'granted') return { mode: 'local_only', reason: 'permission_denied' };
  if (!Device.isDevice) return { mode: 'local_only', reason: 'simulator' };
  if (isExpoGo && Platform.OS === 'android') return { mode: 'local_only', reason: 'expo_go' };
  if (!projectId) return { mode: 'local_only', reason: 'no_project' };
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await request('/push/tokens', {
      method: 'POST', body: { token, platform: Platform.OS, deviceName: Device.modelName || Device.deviceName || undefined },
    });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return { mode: 'push', token };
  } catch (e) {
    return { mode: 'local_only', reason: e.code || 'token_error', message: e.message };
  }
}

/** Dang xuat: go token khoi tai khoan (khong nhan thong bao cua tai khoan cu nua) + huy nhac gio */
export async function unregisterPush() {
  if (!supported) return;
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (token) {
    await request('/push/tokens', { method: 'DELETE', body: { token }, timeoutMs: 8000 }).catch(() => {});
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  }
  await cancelReminders();
  await setBadge(0);
}

export async function setBadge(n) {
  if (!supported) return;
  await Notifications.setBadgeCountAsync(Math.max(0, n || 0)).catch(() => {});
}

// ---------- Tuy chon (dong bo voi may chu, luu tren may de nhac gio cuc bo biet nhom "nhac gio" co bat khong) ----------
export async function cachedPrefs() {
  const raw = await AsyncStorage.getItem(PREFS_KEY).catch(() => null);
  return raw ? JSON.parse(raw) : { reservation: true, arrival: true, reminder: true, payment: true };
}
export const cachePrefs = (p) => AsyncStorage.setItem(PREFS_KEY, JSON.stringify(p)).catch(() => {});

// ---------- Nhac gio cuc bo ----------
const fmt = (d) => { const x = new Date(d); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };

/** Cac nhac gio can co tu dat cho dang giu + phien gui xe dang mo */
export function plannedReminders({ reservations = [], session = null } = {}) {
  const now = Date.now();
  const out = [];
  for (const r of reservations) {
    if (r.status !== 'active' || r.enteredAt || !r.expiresAt) continue;
    const at = new Date(r.expiresAt).getTime() - 5 * 60 * 1000;
    if (at > now + 5000) {
      out.push({ id: `${REMINDER_PREFIX}resv-${r.id}-near`, at,
        title: 'Sắp hết giờ giữ chỗ', body: `Còn 5 phút giữ ô #${r.slotNumber} (${r.code}) đến ${fmt(r.expiresAt)}. Gia hạn trong app hoặc đến cổng ngay.`,
        data: { type: 'reservation_expiring', reservationId: r.id } });
    }
  }
  if (session && !session.cost?.final && session.plannedEndAt) {
    const end = new Date(session.plannedEndAt).getTime();
    if (end - 15 * 60 * 1000 > now + 5000) {
      out.push({ id: `${REMINDER_PREFIX}sess-${session.id}-near-${end}`, at: end - 15 * 60 * 1000,
        title: 'Sắp hết giờ gửi xe', body: `Còn 15 phút đến giờ dự kiến ${fmt(end)} (ô #${session.slotNumber}). Gia hạn để không bị phụ phí.`,
        data: { type: 'near_end', sessionId: session.id } });
    }
    if (end + 5 * 60 * 1000 > now + 5000) {
      out.push({ id: `${REMINDER_PREFIX}sess-${session.id}-over-${end}`, at: end + 5 * 60 * 1000,
        title: 'Đã quá giờ gửi xe', body: `Đã quá giờ dự kiến ${fmt(end)}. Phụ phí quá giờ bắt đầu được tính – gia hạn hoặc lấy xe.`,
        data: { type: 'overtime', sessionId: session.id } });
    }
  }
  return out;
}

/** Hen lai nhac gio cho khop trang thai hien tai (huy nhac cu khong con dung) */
export async function syncReminders(state) {
  if (!supported) return [];
  const prefs = await cachedPrefs();
  const want = prefs.reminder === false ? [] : plannedReminders(state);
  if ((await permissionStatus()) !== 'granted') return [];
  const existing = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const keep = new Set(want.map((w) => w.id));
  await Promise.all(existing
    .filter((n) => n.identifier.startsWith(REMINDER_PREFIX) && !keep.has(n.identifier))
    .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
  const have = new Set(existing.map((n) => n.identifier));
  for (const w of want) {
    if (have.has(w.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: w.id,
      content: { title: w.title, body: w.body, data: { ...w.data, local: true }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: w.at, channelId: 'reminders' },
    }).catch(() => {});
  }
  return want;
}

export async function cancelReminders() {
  if (!supported) return;
  const existing = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(existing.filter((n) => n.identifier.startsWith(REMINDER_PREFIX))
    .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})));
}

/** Thu nhac cuc bo sau `seconds` giay (de kiem tra khi thoat app / tat man hinh) */
export async function scheduleTestReminder(seconds = 10) {
  if ((await permissionStatus({ ask: true })) !== 'granted') return false;
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Nhắc giờ thử từ SmartPark', body: `Thông báo cục bộ được hẹn ${seconds} giây trước – hoạt động cả khi tắt app / tắt màn hình.`, sound: 'default', data: { type: 'test', local: true } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: 'reminders' },
  });
  return true;
}
