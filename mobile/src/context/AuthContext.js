import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/auth';
import { setAccountLockedHandler, setAuthToken } from '../api/client';
import { navigationRef } from '../navigation/ref';
import { storage } from '../storage';
import { unregisterPush } from '../notifications';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // Chay o Splash: neu da bat "Tu dong dang nhap" va con token -> kiem tra token voi server
  const restoreSession = useCallback(async ({ onSlow } = {}) => {
    const { autoLogin } = await storage.getLoginPrefs();
    const token = autoLogin ? await storage.getToken() : null;
    if (!token) return null;
    setAuthToken(token);
    try {
      const me = await authApi.me({ onSlow });
      setUser(me);
      return me;
    } catch (e) {
      if (e.status === 401 || e.code === 'account_locked') await storage.clearToken();   // token het han / tai khoan bi xoa
      setAuthToken(null);
      return null;
    }
  }, []);

  // remember = true -> luu token de lan sau tu dong dang nhap
  const signIn = useCallback(async ({ token, user: u }, { remember }) => {
    setAuthToken(token);
    if (remember) await storage.setToken(token);
    else await storage.clearToken();
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPush(); // go token thong bao truoc khi xoa phien dang nhap
    await storage.clearToken();
    setAuthToken(null);
    setUser(null);
  }, []);

  // Bi quan tri khoa khi dang dung app -> dang xuat, ve man dang nhap kem ly do
  useEffect(() => {
    setAccountLockedHandler(async (message) => {
      setAuthToken(null);
      await storage.clearToken();
      setUser(null);
      if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'Login', params: { notice: message } }] });
    });
    return () => setAccountLockedHandler(null);
  }, []);

  const updateUser = useCallback((updated) => {
    setUser((prev) => ({ ...prev, ...updated }));
  }, []);

  const value = useMemo(() => ({ user, restoreSession, signIn, signOut, updateUser }), [user, restoreSession, signIn, signOut, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
