-- Du lieu mau: 1 bai do 4 o, khop voi PARKING_ID "sp-demo-01" trong firmware
INSERT INTO parking_lots (id, name, address, total_slots, price_per_hour)
VALUES ('sp-demo-01', 'Bai do xe thong minh - Demo', '01 Duong Demo, TP.HCM', 4, 10000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO slots (lot_id, slot_number)
SELECT 'sp-demo-01', n FROM generate_series(1, 4) AS n
ON CONFLICT (lot_id, slot_number) DO NOTHING;
