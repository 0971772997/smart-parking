// Loai xe + bien so (dung chung: form them xe, the xe, chon xe khi dat cho / qua cong)
export const VEHICLE_TYPES = [
  { key: 'car', label: 'Ô tô', icon: 'car-sport-outline' },
  { key: 'motorbike', label: 'Xe máy', icon: 'bicycle-outline' },
  { key: 'electric', label: 'Xe điện', icon: 'flash-outline' },
  { key: 'bicycle', label: 'Xe đạp', icon: 'bicycle' },
  { key: 'other', label: 'Khác', icon: 'cube-outline' },
];

const BY_KEY = Object.fromEntries(VEHICLE_TYPES.map((t) => [t.key, t]));
export const vehicleType = (key) => BY_KEY[key] || BY_KEY.car;

// Chuan hoa bien so giong may chu: IN HOA, gon khoang trang
export const normalizePlate = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

// '' neu hop le, nguoc lai tra ve thong bao loi tieng Viet
export function plateError(raw) {
  const p = normalizePlate(raw);
  if (!p) return 'Vui lòng nhập biển số xe';
  if (p.length < 4 || p.length > 20) return 'Biển số dài 4–20 ký tự';
  if (!/^[A-Z0-9][A-Z0-9.\- ]{2,18}[A-Z0-9]$/.test(p) || !/\d/.test(p)) {
    return 'Biển số chỉ gồm chữ, số, dấu "-" hoặc "." (vd 43A-123.45)';
  }
  return '';
}

// "Ô tô • Toyota Vios" / "Xe máy"
export const vehicleTitle = (v) => [vehicleType(v?.vehicleType).label, v?.brand].filter(Boolean).join(' • ');
