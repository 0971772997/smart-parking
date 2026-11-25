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
import GateCheckinScreen from '../screens/gate/GateCheckinScreen';
import GateDisplayScreen from '../screens/gate/GateDisplayScreen';
import SessionDetailScreen from '../screens/session/SessionDetailScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import PaymentScreen from '../screens/payment/PaymentScreen';
import ReceiptScreen from '../screens/payment/ReceiptScreen';
import TransactionsScreen from '../screens/payment/TransactionsScreen';
import NotificationSettingsScreen from '../screens/notifications/NotificationSettingsScreen';
import HistoryScreen from '../screens/history/HistoryScreen';
import FavoritesScreen from '../screens/favorites/FavoritesScreen';
import LotReviewsScreen from '../screens/reviews/LotReviewsScreen';
import ReviewFormScreen from '../screens/reviews/ReviewFormScreen';
import SupportScreen from '../screens/support/SupportScreen';
import SupportTicketFormScreen from '../screens/support/SupportTicketFormScreen';
import SupportTicketDetailScreen from '../screens/support/SupportTicketDetailScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminUserDetailScreen from '../screens/admin/AdminUserDetailScreen';
import AdminLotsScreen from '../screens/admin/AdminLotsScreen';
import AdminReservationsScreen from '../screens/admin/AdminReservationsScreen';
import AdminSessionsScreen from '../screens/admin/AdminSessionsScreen';
import AdminPaymentsScreen from '../screens/admin/AdminPaymentsScreen';
import AdminReviewsScreen from '../screens/admin/AdminReviewsScreen';
import AdminBroadcastScreen from '../screens/admin/AdminBroadcastScreen';
import AdminAuditScreen from '../screens/admin/AdminAuditScreen';
import AdminPricingScreen from '../screens/admin/AdminPricingScreen';

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
      <Stack.Screen name="GateCheckin" component={GateCheckinScreen} options={{ title: 'Quét mã tại cổng' }} />
      <Stack.Screen name="GateDisplay" component={GateDisplayScreen} options={{ title: 'Mã QR tại cổng' }} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} options={{ title: 'Phiên gửi xe' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Thông báo' }} />
      <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Thanh toán' }} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ title: 'Biên nhận' }} />
      <Stack.Screen name="Transactions" component={TransactionsScreen} options={{ title: 'Lịch sử giao dịch' }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: 'Cài đặt thông báo' }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Lịch sử gửi xe' }} />
      <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ title: 'Bãi đỗ yêu thích' }} />
      <Stack.Screen name="LotReviews" component={LotReviewsScreen} options={{ title: 'Đánh giá bãi đỗ' }} />
      <Stack.Screen name="ReviewForm" component={ReviewFormScreen} options={{ title: 'Viết đánh giá', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Hỗ trợ' }} />
      <Stack.Screen name="SupportTicketForm" component={SupportTicketFormScreen} options={{ title: 'Gửi yêu cầu', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="SupportTicket" component={SupportTicketDetailScreen} options={{ title: 'Yêu cầu hỗ trợ' }} />
      {/* Trang quan tri (chi admin - API tu chan tai khoan thuong) */}
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Trang quản trị' }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Người dùng' }} />
      <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} options={{ title: 'Người dùng' }} />
      <Stack.Screen name="AdminLots" component={AdminLotsScreen} options={{ title: 'Bãi đỗ' }} />
      <Stack.Screen name="AdminReservations" component={AdminReservationsScreen} options={{ title: 'Đặt chỗ' }} />
      <Stack.Screen name="AdminSessions" component={AdminSessionsScreen} options={{ title: 'Phiên gửi xe' }} />
      <Stack.Screen name="AdminPayments" component={AdminPaymentsScreen} options={{ title: 'Doanh thu' }} />
      <Stack.Screen name="AdminReviews" component={AdminReviewsScreen} options={{ title: 'Đánh giá' }} />
      <Stack.Screen name="AdminBroadcast" component={AdminBroadcastScreen} options={{ title: 'Thông báo chung' }} />
      <Stack.Screen name="AdminPricing" component={AdminPricingScreen} options={{ title: 'Điều chỉnh giá' }} />
      <Stack.Screen name="AdminAudit" component={AdminAuditScreen} options={{ title: 'Nhật ký quản trị' }} />
    </Stack.Navigator>
  );
}
