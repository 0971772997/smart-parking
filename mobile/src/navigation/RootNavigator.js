import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import FindPasswordScreen from '../screens/auth/FindPasswordScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import HomeScreen from '../screens/home/HomeScreen';
import SchedulesScreen from '../screens/schedules/SchedulesScreen';
import ScheduleFormScreen from '../screens/schedules/ScheduleFormScreen';
import SetupParkingLotScreen from '../screens/parking/SetupParkingLotScreen';
import BookingScreen from '../screens/booking/BookingScreen';
import ReservationDetailScreen from '../screens/booking/ReservationDetailScreen';
import GateScannerScreen from '../screens/gate/GateScannerScreen';
import SessionDetailScreen from '../screens/session/SessionDetailScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="Splash" component={SplashScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="Login" component={LoginScreen} options={{ animation: 'fade', title: 'Đăng nhập' }} />
      <Stack.Screen name="FindPassword" component={FindPasswordScreen} options={{ title: 'Quên mật khẩu' }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Đăng ký' }} />
      <Stack.Screen name="Home" component={HomeScreen} options={{ animation: 'fade', title: 'SmartPark' }} />
      <Stack.Screen name="Schedules" component={SchedulesScreen} options={{ title: 'Lịch gửi xe' }} />
      <Stack.Screen name="ScheduleForm" component={ScheduleFormScreen} options={{ title: 'Lịch gửi xe', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="SetupParkingLot" component={SetupParkingLotScreen} options={{ title: 'Sơ đồ Mặt bằng Bãi đỗ xe' }} />
      <Stack.Screen name="Booking" component={BookingScreen} options={{ title: 'Đặt chỗ' }} />
      <Stack.Screen name="ReservationDetail" component={ReservationDetailScreen} options={{ title: 'Chi tiết đặt chỗ' }} />
      <Stack.Screen name="GateScanner" component={GateScannerScreen} options={{ title: 'Quét mã tại cổng' }} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} options={{ title: 'Phiên gửi xe' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Thông báo' }} />
    </Stack.Navigator>
  );
}
