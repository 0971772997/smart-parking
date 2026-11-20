// Luu tru tren may:
// - Token dang nhap: SecureStore (ma hoa boi Keychain/Keystore). Tren web dung localStorage.
// - Tuy chon "Luu ID", "Tu dong dang nhap", email da luu: AsyncStorage (khong nhay cam).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  token: 'sp_token',
  savedEmail: 'sp_saved_email',
  saveId: 'sp_save_id',
  autoLogin: 'sp_auto_login',
};

const secure = {
  get: (k) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  set: (k, v) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  del: (k) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k)),
};

export const storage = {
  getToken: () => secure.get(KEYS.token).catch(() => null),
  setToken: (t) => secure.set(KEYS.token, t),
  clearToken: () => secure.del(KEYS.token).catch(() => {}),

  async getLoginPrefs() {
    const [[, saveId], [, autoLogin], [, savedEmail]] = await AsyncStorage.multiGet([KEYS.saveId, KEYS.autoLogin, KEYS.savedEmail]);
    return { saveId: saveId === '1', autoLogin: autoLogin === '1', savedEmail: savedEmail || '' };
  },
  async setLoginPrefs({ saveId, autoLogin, email }) {
    await AsyncStorage.multiSet([[KEYS.saveId, saveId ? '1' : '0'], [KEYS.autoLogin, autoLogin ? '1' : '0']]);
    if (saveId && email) await AsyncStorage.setItem(KEYS.savedEmail, email);
    if (!saveId) await AsyncStorage.removeItem(KEYS.savedEmail);
  },
  async setAutoLogin(on) {
    await AsyncStorage.setItem(KEYS.autoLogin, on ? '1' : '0');
  },
};
