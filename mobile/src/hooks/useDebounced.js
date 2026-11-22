import { useEffect, useState } from 'react';

/** Gia tri tre `ms` sau lan doi cuoi (o tim kiem: khong goi API moi lan go phim) */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
