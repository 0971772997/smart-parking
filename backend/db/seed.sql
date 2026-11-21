-- Du lieu mau: 1 bai do 4 o, khop voi PARKING_ID "sp-demo-01" trong firmware
INSERT INTO parking_lots (id, name, address, total_slots, price_per_hour)
VALUES ('sp-demo-01', 'Bãi đỗ xe thông minh', 'Hải Châu - Đà Nẵng', 4, 10000)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  total_slots = EXCLUDED.total_slots,
  price_per_hour = EXCLUDED.price_per_hour;

INSERT INTO slots (lot_id, slot_number)
SELECT 'sp-demo-01', n FROM generate_series(1, 4) AS n
ON CONFLICT (lot_id, slot_number) DO NOTHING;

-- Gan khu vuc cho o chua co (chia 2 day A / B theo so o; bai 4 o: A = 1-2, B = 3-4)
UPDATE slots s SET zone = chr(65 + ((s.slot_number - 1) / GREATEST(1, ceil(l.total_slots / 2.0)::int)))
FROM parking_lots l WHERE l.id = s.lot_id AND s.zone IS NULL;
