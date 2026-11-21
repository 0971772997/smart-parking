// Dieu huong tu ngoai man hinh (vd bam vao thong bao noi o tren cung)
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) navigationRef.navigate(name, params);
}
