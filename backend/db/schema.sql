-- =====================================================================
-- SMART PARKING - SCHEMA (PostgreSQL / Neon)
-- Chay lai nhieu lan van an toan (IF NOT EXISTS)
-- =====================================================================

-- Nguoi dung app (tai xe / quan tri)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(20),
  role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- v2 (app di dong): ten dang nhap rieng, ho ten khong bat buoc
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(30);
ALTER TABLE users ALTER COLUMN full_name DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
-- v3: dang nhap Google / Facebook
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(64) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(64) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

-- Ma OTP (gia lap SMS): dang nhap bang ten + SDT, tim ID, dat lai mat khau
CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('login_phone', 'find_id', 'reset_password')),
  code_hash   VARCHAR(100) NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes (user_id, created_at DESC);

-- Xe cua nguoi dung
CREATE TABLE IF NOT EXISTS vehicles (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate_number VARCHAR(20) NOT NULL UNIQUE,
  brand        VARCHAR(50),
  color        VARCHAR(30),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bai do xe (moi bai = 1 ESP32, id trung voi PARKING_ID trong firmware)
CREATE TABLE IF NOT EXISTS parking_lots (
  id             VARCHAR(50) PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  address        VARCHAR(255),
  total_slots    INT NOT NULL CHECK (total_slots > 0),
  price_per_hour INT NOT NULL DEFAULT 10000,          -- VND / gio
  online         BOOLEAN NOT NULL DEFAULT false,
  entry_gate     VARCHAR(10) NOT NULL DEFAULT 'closed',
  exit_gate      VARCHAR(10) NOT NULL DEFAULT 'closed',
  fw_version     VARCHAR(20),
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O do (trang thai hien tai, dong bo tu ESP32)
CREATE TABLE IF NOT EXISTS slots (
  id          SERIAL PRIMARY KEY,
  lot_id      VARCHAR(50) NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  slot_number INT NOT NULL,
  state       VARCHAR(10) NOT NULL DEFAULT 'free' CHECK (state IN ('free', 'occupied', 'reserved')),
  distance_cm INT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, slot_number)
);

-- Dat cho truoc tu app
CREATE TABLE IF NOT EXISTS reservations (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id     INT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  vehicle_id  INT REFERENCES vehicles(id) ON DELETE SET NULL,
  status      VARCHAR(12) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'fulfilled', 'cancelled', 'expired', 'failed')),
  minutes     INT NOT NULL CHECK (minutes BETWEEN 1 AND 240),   -- tong thoi gian (ke ca gia han)
  request_id  VARCHAR(40) NOT NULL UNIQUE,            -- ghep voi ack tu ESP32
  error       VARCHAR(40),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Moi o chi co toi da 1 dat cho dang hieu luc
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservation_active_slot
  ON reservations (slot_id) WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations (user_id, created_at DESC);

-- Luot do xe (xe vao o -> xe roi o), tinh phi
CREATE TABLE IF NOT EXISTS parking_sessions (
  id               SERIAL PRIMARY KEY,
  slot_id          INT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  reservation_id   INT REFERENCES reservations(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INT,
  fee              INT                                -- VND
);
CREATE INDEX IF NOT EXISTS idx_sessions_slot_open ON parking_sessions (slot_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_started ON parking_sessions (started_at DESC);

-- Nhat ky su kien tho tu ESP32 (gate, slot_changed, ack, ...)
CREATE TABLE IF NOT EXISTS device_events (
  id         BIGSERIAL PRIMARY KEY,
  lot_id     VARCHAR(50) NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  type       VARCHAR(30) NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_lot_time ON device_events (lot_id, created_at DESC);

-- v5: Lich gui xe thuong xuyen (vd: Di lam - gui o bai X luc 07:30, T2-T6, giu cho 30 phut)
-- (thay cho bang "driver_routes" v4 - mau lo trinh cua app ben xe, khong hop voi bai do)
DROP TABLE IF EXISTS driver_routes;
CREATE TABLE IF NOT EXISTS parking_schedules (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(60)  NOT NULL,
  lot_id      VARCHAR(50)  NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  vehicle_id  INT REFERENCES vehicles(id) ON DELETE SET NULL,
  arrive_time VARCHAR(5)   NOT NULL CHECK (arrive_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), -- gio den bai
  days        SMALLINT[]   NOT NULL DEFAULT '{1,2,3,4,5}',   -- 1 = Thu 2 ... 7 = Chu nhat (ISO)
  minutes     INT          NOT NULL DEFAULT 15 CHECK (minutes BETWEEN 1 AND 120), -- thoi gian giu cho khi dat nhanh
  note        VARCHAR(255),
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parking_schedules_user ON parking_schedules (user_id, arrive_time);

-- v6: Giao dich thanh toan phi gui xe (moi luot do da ket thuc -> 1 giao dich)
-- Cong thanh toan dang GIA LAP (tra ve thanh cong ngay); method ghi lai hinh thuc tai xe chon.
CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(24)  NOT NULL UNIQUE,                 -- ma giao dich, vd GD20261120-7KQ2XA
  session_id   INT NOT NULL UNIQUE REFERENCES parking_sessions(id) ON DELETE CASCADE, -- moi luot do chi tra 1 lan
  user_id      INT REFERENCES users(id) ON DELETE SET NULL,   -- NULL = khach vang lai (admin thu tien mat)
  amount       INT NOT NULL CHECK (amount >= 0),             -- VND
  method       VARCHAR(10)  NOT NULL CHECK (method IN ('cash', 'card', 'momo', 'zalopay', 'bank')),
  collected_by INT REFERENCES users(id) ON DELETE SET NULL,   -- admin thu tien mat tai cong
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id, created_at DESC);

-- v7: Dat cho day du - khu vuc do, ma xac nhan, thoi luong gui du kien, quy tac gia han
-- Khu vuc (day) cua o do, vd 'A', 'B' (gan mac dinh trong seed.sql / khi admin tao bai)
ALTER TABLE slots ADD COLUMN IF NOT EXISTS zone VARCHAR(10);
-- minutes          = tong thoi gian GIU CHO (ke ca gia han)
-- duration_minutes = thoi luong gui xe du kien sau khi den (de uoc tinh phi)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS code VARCHAR(12) UNIQUE;          -- ma dat cho, vd DC-7KQ2XA
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS duration_minutes INT CHECK (duration_minutes BETWEEN 30 AND 1440);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS estimated_fee INT;                 -- VND, theo gia luc dat
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS extend_count INT NOT NULL DEFAULT 0;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;          -- luc ESP32 xac nhan giu o
CREATE INDEX IF NOT EXISTS idx_reservations_open ON reservations (status, expires_at) WHERE status IN ('pending', 'active');

-- v8: Ma QR qua cong (vao / ra bai) cho luot dat cho
-- entered_at / exited_at = luc barie mo THAT (ESP32 tra ack ok) sau khi quet ma hop le
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS entered_at TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;
-- Nhat ky MOI lan quet ma tai cong (ke ca ma loi) de doi chieu / xu ly su co
CREATE TABLE IF NOT EXISTS gate_scans (
  id             SERIAL PRIMARY KEY,
  lot_id         VARCHAR(50) NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  gate           VARCHAR(5)  NOT NULL CHECK (gate IN ('entry', 'exit')),
  reservation_id INT REFERENCES reservations(id) ON DELETE SET NULL,
  nonce          VARCHAR(16),                       -- ma ngau nhien trong QR (moi ma chi dung 1 lan)
  result         VARCHAR(10) NOT NULL CHECK (result IN ('pending', 'granted', 'denied')),
  error          VARCHAR(40),                       -- ly do tu choi (qr_expired, payment_required, device_timeout...)
  request_id     VARCHAR(40),                       -- ghep voi ack mo barie tu ESP32
  scanned_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at   TIMESTAMPTZ                        -- luc ESP32 xac nhan da mo barie
);
CREATE INDEX IF NOT EXISTS idx_gate_scans_lot_time ON gate_scans (lot_id, created_at DESC);
-- Moi dat cho chi vao 1 lan / ra 1 lan (chan quet trung, 2 nguoi quet cung luc)
CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_scan_once
  ON gate_scans (reservation_id, gate) WHERE result IN ('pending', 'granted');

-- v9: Phien gui xe day du (bat dau khi qua cong vao, ket thuc khi ra cong) + thong bao
--   source   = 'gate'   : mo khi barie cong vao mo cho dat cho (quet QR) -> started_at = luc vao bai
--              'sensor' : khach vang lai / vao bang nut -> mo khi cam bien thay xe trong o
--   parked_at    = luc cam bien thay xe trong o
--   ended_at     = luc CHOT PHI (xe roi o, hoac ra cong khi chua do) -> fee, duration_seconds
--   exited_at    = luc qua cong ra (ket thuc phien gui xe 'gate')
--   planned_end_at = het gio gui du kien (tu dat cho, gia han duoc) -> qua gio tinh phu phi
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS vehicle_id INT REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'sensor';
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS planned_end_at TIMESTAMPTZ;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS extend_count INT NOT NULL DEFAULT 0;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS overtime_fee INT;            -- VND, phan phu phi qua gio trong fee
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS flags TEXT[] NOT NULL DEFAULT '{}'; -- wrong_slot, sensor_gap ...
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE parking_sessions SET parked_at = started_at WHERE parked_at IS NULL AND source = 'sensor';
UPDATE parking_sessions ps SET user_id = r.user_id, vehicle_id = r.vehicle_id
FROM reservations r WHERE r.id = ps.reservation_id AND ps.user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON parking_sessions (user_id, started_at DESC);
-- Moi dat cho chi mo 1 phien gui xe
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_reservation ON parking_sessions (reservation_id) WHERE reservation_id IS NOT NULL;

-- Thong bao trong app (phien gui xe, thay doi chi phi, dat cho het han...)
-- dedupe_key: moi su kien chi bao 1 lan (vd 's12:fee:3' = phi phien 12 len muc 3 gio)
CREATE TABLE IF NOT EXISTS notifications (
  id             BIGSERIAL PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id     INT REFERENCES parking_sessions(id) ON DELETE CASCADE,
  reservation_id INT REFERENCES reservations(id) ON DELETE CASCADE,
  type           VARCHAR(30) NOT NULL,
  title          VARCHAR(120) NOT NULL,
  body           TEXT,
  data           JSONB NOT NULL DEFAULT '{}',
  dedupe_key     VARCHAR(80) UNIQUE,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, id DESC);

-- v10: Cong thanh toan (MoMo moi truong THU NGHIEM) + bien nhan dien tu
--   payment_orders: don thanh toan gui sang cong (cho tai xe thanh toan tren trang MoMo)
--   payments      : giao dich THANH CONG (1 phien chi 1 giao dich) + so bien nhan + chi tiet phi luc thanh toan
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'card', 'momo', 'zalopay', 'bank', 'atm'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(10) NOT NULL DEFAULT 'mock'; -- momo | cash | mock (gia lap)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id VARCHAR(50);                       -- ma don gui sang cong
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_trans_id VARCHAR(40);               -- ma giao dich phia MoMo
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_no VARCHAR(24) UNIQUE;              -- so bien nhan, vd BL20261121-000012
ALTER TABLE payments ADD COLUMN IF NOT EXISTS breakdown JSONB;                            -- chi tiet phi (chot luc thanh toan)
UPDATE payments SET provider = 'cash' WHERE method = 'cash' AND provider = 'mock';
UPDATE payments SET receipt_no = 'BL' || to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || lpad(id::text, 6, '0')
WHERE receipt_no IS NULL;

CREATE TABLE IF NOT EXISTS payment_orders (
  id           SERIAL PRIMARY KEY,
  order_id     VARCHAR(50) NOT NULL UNIQUE,
  request_id   VARCHAR(50) NOT NULL,
  session_id   INT NOT NULL REFERENCES parking_sessions(id) ON DELETE CASCADE,
  user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  provider     VARCHAR(10) NOT NULL,                     -- momo
  method       VARCHAR(10) NOT NULL,                     -- momo (vi) | atm (the noi dia) | card (Visa/Master)
  amount       INT NOT NULL CHECK (amount > 0),
  status       VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  result_code  INT,
  message      TEXT,
  trans_id     VARCHAR(40),
  pay_type     VARCHAR(20),
  pay_url      TEXT,
  deeplink     TEXT,
  qr_code_url  TEXT,
  payment_id   INT REFERENCES payments(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_session ON payment_orders (session_id, created_at DESC);

-- v11: Thong bao day (Expo Push -> FCM / APNs)
-- Moi thiet bi dang nhap dang ky 1 token; token het hieu luc (go app) -> Expo bao DeviceNotRegistered -> xoa
CREATE TABLE IF NOT EXISTS push_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        VARCHAR(200) NOT NULL UNIQUE,
  platform     VARCHAR(10),                 -- android | ios
  device_name  VARCHAR(100),
  last_error   VARCHAR(60),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);
-- Tuy chon nhan thong bao day theo nhom: { reservation, arrival, reminder, payment } (mac dinh bat het)
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}';
-- Ghi nhan da gui day cho thong bao nao (tranh gui lai)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;

-- v12: Bai do yeu thich, danh gia / phan hoi co so bai do, ho tro & bao cao su co
CREATE TABLE IF NOT EXISTS favorite_lots (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lot_id     VARCHAR(50) NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lot_id)
);

-- Moi tai xe 1 danh gia / bai (sua lai duoc). Chi tai xe DA GUI XE o bai moi danh gia duoc (session_id = luot gan nhat)
CREATE TABLE IF NOT EXISTS lot_reviews (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lot_id      VARCHAR(50) NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  session_id  INT REFERENCES parking_sessions(id) ON DELETE SET NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags        TEXT[] NOT NULL DEFAULT '{}',          -- clean, safe, easy_find, staff, price, ... (xem src/feedback.js)
  comment     VARCHAR(1000),
  reply       VARCHAR(1000),                          -- phan hoi cua quan ly bai
  replied_by  INT REFERENCES users(id) ON DELETE SET NULL,
  replied_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lot_id)
);
CREATE INDEX IF NOT EXISTS idx_lot_reviews_lot ON lot_reviews (lot_id, updated_at DESC);

-- Yeu cau ho tro (kind = support) / bao cao su co (kind = incident) + trao doi voi nhan vien
CREATE TABLE IF NOT EXISTS support_tickets (
  id             SERIAL PRIMARY KEY,
  code           VARCHAR(16) NOT NULL UNIQUE,                     -- vd HT-7KQ2XA / SC-7KQ2XA
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('support', 'incident')),
  category       VARCHAR(20) NOT NULL,
  subject        VARCHAR(120) NOT NULL,
  description    VARCHAR(2000) NOT NULL,
  lot_id         VARCHAR(50) REFERENCES parking_lots(id) ON DELETE SET NULL,
  slot_number    INT,
  session_id     INT REFERENCES parking_sessions(id) ON DELETE SET NULL,
  reservation_id INT REFERENCES reservations(id) ON DELETE SET NULL,
  priority       VARCHAR(6) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status         VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id         SERIAL PRIMARY KEY,
  ticket_id  INT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  staff      BOOLEAN NOT NULL DEFAULT false,
  body       VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages (ticket_id, id);

-- v13: Trang quan tri
-- Khoa tai khoan (khong dang nhap / goi API duoc) + mo khoa dat cho (bo qua cac lan "khong den" truoc moc nay)
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS noshow_reset_at TIMESTAMPTZ;
-- Bai tam ngung nhan dat cho (bao tri) - van hien tren app
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN NOT NULL DEFAULT true;
-- Ghi chu cua quan tri khi dong phien / mien phi
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS admin_note VARCHAR(200);

-- Nhat ky thao tac cua quan tri vien (ai, lam gi, luc nao)
CREATE TABLE IF NOT EXISTS admin_actions (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    INT REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(40) NOT NULL,              -- user.lock, lot.update, session.close, broadcast ...
  target_type VARCHAR(20),
  target_id   VARCHAR(60),
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_time ON admin_actions (id DESC);

-- Thong bao chung gui toi tai xe
CREATE TABLE IF NOT EXISTS broadcasts (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  body        VARCHAR(500),
  audience    VARCHAR(20) NOT NULL DEFAULT 'all',  -- all | lot:<lotId> (tai xe tung gui xe / yeu thich bai)
  recipients  INT NOT NULL DEFAULT 0,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
