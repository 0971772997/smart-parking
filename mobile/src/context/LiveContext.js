// DONG BO THOI GIAN THUC cho toan app (1 ket noi duy nhat):
// - Long-poll GET /api/live: may chu giu request den khi bai do / dat cho / phien gui xe thay doi
//   -> `version` doi -> cac man hinh dang mo tu tai lai (useLiveVersion).
// - Mat mang / may chu khong phan hoi -> online = false (OfflineBanner), thu lai voi do tre tang dan;
//   ket noi lai -> version moi -> man hinh tu dong bo lai du lieu.
// - Thong bao moi (phien gui xe, thay doi chi phi...) -> hien thong bao noi (toast) tren moi man hinh.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { liveApi, notificationsApi } from '../api/sessions';

const LiveContext = createContext(null);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Thong bao theo thoi gian (sap het gio / qua gio / phi tang) duoc tao khi app hoi -> hoi it nhat 1 phut/lan
const NOTE_REFRESH_MS = 60000;

export function LiveProvider({ children }) {
  const { user } = useAuth();
  const [version, setVersion] = useState(null);
  const [lots, setLots] = useState([]);
  const [online, setOnline] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);
  const lastNoteId = useRef(null);
  const noteUser = useRef(null);
  const noteBusy = useRef(false);
  const pushedIds = useRef(new Set()); // thong bao he thong da hien (push) -> khong hien toast trung // tranh 2 lan hoi chong nhau (lan dau mo app) -> toast lai thong bao cu // doi tai khoan -> ghi nhan lai moc thong bao
  const activeRef = useRef(AppState.currentState !== 'background');

  // App xuong nen -> tam dung long-poll (tiet kiem pin / du lieu); quay lai -> hoi ngay
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { activeRef.current = s === 'active'; });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let stop = false;
    let v = '';
    let fails = 0;
    (async () => {
      while (!stop) {
        if (!activeRef.current) { await sleep(1500); continue; }
        try {
          const r = await liveApi.all(v, 25);
          if (stop) break;
          fails = 0;
          setOnline(true);
          setLastSyncAt(Date.now());
          if (r.version !== v) {
            v = r.version;
            setVersion(r.version);
            setLots(r.lots || []);
          }
        } catch {
          if (stop) break;
          fails += 1;
          if (fails >= 1) setOnline(false);
          await sleep(Math.min(15000, 1000 * 2 ** Math.min(fails, 4)));
        }
      }
    })();
    return () => { stop = true; };
  }, []);

  // Thong bao moi -> toast (lan dau chi ghi nhan moc, khong hien lai thong bao cu)
  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    if (noteBusy.current) return;
    noteBusy.current = true;
    if (noteUser.current !== user.id) { noteUser.current = user.id; lastNoteId.current = null; }
    try {
      const after = lastNoteId.current ?? 0;
      const r = await notificationsApi.list({ after, limit: 10 });
      setUnread(r.unread);
      if (r.items.length) {
        const newest = r.items[0];
        const fresh = Date.now() - new Date(newest.createdAt).getTime() < 2 * 60 * 1000;
        if (lastNoteId.current !== null && !newest.read && fresh && !pushedIds.current.has(newest.id)) {
          setToast({ ...newest, shownAt: Date.now() });
        }
        lastNoteId.current = Math.max(lastNoteId.current ?? 0, newest.id);
      } else if (lastNoteId.current === null) {
        lastNoteId.current = 0;
      }
    } catch {
      // mat mang -> lan sau thu lai
    } finally {
      noteBusy.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const t = setTimeout(refreshNotifications, 0);
    return () => clearTimeout(t);
  }, [user, version, refreshNotifications]);

  useEffect(() => {
    if (!user) return undefined;
    const t = setInterval(refreshNotifications, NOTE_REFRESH_MS);
    return () => clearInterval(t);
  }, [user, refreshNotifications]);

  const markAllRead = useCallback(async () => {
    try {
      const r = await notificationsApi.read({ all: true });
      setUnread(r.unread);
    } catch {
      // bo qua
    }
  }, []);

  const markPushed = useCallback((id) => { pushedIds.current.add(Number(id)); }, []);

  const value = useMemo(() => ({
    version, lots, online, lastSyncAt, unread: user ? unread : 0, toast: user ? toast : null,
    dismissToast: () => setToast(null), refreshNotifications, markAllRead, markPushed, setUnread,
  }), [version, lots, online, lastSyncAt, unread, toast, user, refreshNotifications, markAllRead, markPushed]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive phai nam trong LiveProvider');
  return ctx;
}

/** Goi fn moi khi du lieu tren may chu thay doi (bo qua lan dau) */
export function useOnLiveChange(fn) {
  const { version } = useLive();
  const first = useRef(true);
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);
  useEffect(() => {
    if (version === null) return;
    if (first.current) { first.current = false; return; }
    ref.current();
  }, [version]);
}
