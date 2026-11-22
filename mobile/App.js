import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as NativeSplash from 'expo-splash-screen';
import { AuthProvider } from './src/context/AuthContext';
import { LiveProvider } from './src/context/LiveContext';
import RootNavigator from './src/navigation/RootNavigator';
import { navigationRef } from './src/navigation/ref';
import NotificationToast from './src/components/NotificationToast';
import PushBridge from './src/notifications/PushBridge';

// Giu splash cua he dieu hanh cho toi khi SplashScreen (co animation) hien len
NativeSplash.preventAutoHideAsync().catch(() => {});

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LiveProvider>
          <NavigationContainer ref={navigationRef}>
            <View style={{ flex: 1 }}>
              <RootNavigator />
              <NotificationToast />
              <PushBridge />
            </View>
          </NavigationContainer>
        </LiveProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
