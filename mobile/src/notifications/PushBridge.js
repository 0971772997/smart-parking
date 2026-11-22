// CAU NOI THONG BAO HE THONG <-> APP (khong hien giao dien):
//   - Dang nhap -> xin quyen + dang ky token voi may chu (thong bao day khi tat app / tat man hinh)
//   - Bam vao thong bao (ca khi app dang tat han - cold start) -> mo dung man hinh + danh dau da doc
//   - Nhan thong bao khi dang mo app -> lam moi danh sach / bo dem (khong hien them toast trung)
//   - So chua doc -> so tren icon app (badge)
//   - Dat cho / phien gui xe thay doi -> hen lai nhac gio cuc bo
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../context/AuthContext';
import { useLive, useOnLiveChange } from '../context/LiveContext';
import { openNotification } from '../components/NotificationToast';
import { navigationRef } from '../navigation/ref';
import { notificationsApi, sessionsApi } from '../api/sessions';
import { reservationsApi } from '../api/reservations';
import { registerForPush, setBadge, setupNotifications, supported, syncReminders } from './index';

// Du lieu trong thong bao (tu may chu hoac nhac cuc bo) -> dang chung voi thong bao trong app
const toNote = (data = {}) => ({
  id: data.notificationId, type: data.type, sessionId: data.sessionId, reservationId: data.reservationId,
  data: { paymentId: data.paymentId, ticketId: data.ticketId, lotId: data.lotId },
});

export default function PushBridge() {
  const { user } = useAuth();
  const { unread, refreshNotifications, markPushed } = useLive();
  const handledResponse = useRef(null);

  useEffect(() => { setupNotifications(); }, []);

  // Dang nhap -> dang ky nhan thong bao day
  useEffect(() => {
    if (!supported || !user) return;
    registerForPush({ ask: true }).then((r) => {
      if (r.mode !== 'push') console.log('[PUSH] Chi thong bao trong app + nhac gio cuc bo:', r.reason, r.message || '');
    });
  }, [user]);

  const openFromData = useCallback((data, actionId) => {
    if (!data) return;
    const key = `${data.notificationId || data.type}-${actionId}`;
    if (handledResponse.current === key) return;
    handledResponse.current = key;
    if (data.notificationId) notificationsApi.read({ ids: [data.notificationId] }).then(() => refreshNotifications()).catch(() => {});
    const go = () => openNotification(toNote(data));
    if (navigationRef.isReady()) go();
    else setTimeout(go, 800);
  }, [refreshNotifications]);

  // Bam vao thong bao
  useEffect(() => {
    if (!supported || !user) return undefined;
    const sub = Notifications.addNotificationResponseReceivedListener((resp) =>
      openFromData(resp.notification.request.content.data, resp.actionIdentifier));
    // Mo app tu thong bao khi app dang tat han
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) {
        openFromData(resp.notification.request.content.data, resp.actionIdentifier);
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    }).catch(() => {});
    return () => sub.remove();
  }, [user, openFromData]);

  // Thong bao den khi dang mo app: he thong da hien banner -> khong hien toast trung, chi lam moi bo dem
  useEffect(() => {
    if (!supported) return undefined;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const id = n.request.content.data?.notificationId;
      if (id) markPushed(id);
      refreshNotifications();
    });
    return () => sub.remove();
  }, [markPushed, refreshNotifications]);

  // So chua doc -> icon app
  useEffect(() => { setBadge(user ? unread : 0); }, [user, unread]);

  // Hen lai nhac gio theo dat cho / phien hien tai
  const resync = useCallback(async () => {
    if (!supported || !user) return;
    try {
      const [reservations, active] = await Promise.all([
        reservationsApi.list({ status: 'active' }), sessionsApi.active(),
      ]);
      await syncReminders({ reservations, session: active.session });
    } catch {
      // mat mang -> giu nhac gio da hen truoc do
    }
  }, [user]);
  useEffect(() => {
    const t = setTimeout(resync, 0);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') resync(); });
    return () => { clearTimeout(t); sub.remove(); };
  }, [resync]);
  useOnLiveChange(resync);

  return null;
}
