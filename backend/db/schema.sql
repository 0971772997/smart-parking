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

-- v4: Lo trinh thuong di cua tai xe (vd: Nha -> Cong ty), gan voi bai do dich, xe, gio di, cac ngay lap lai
CREATE TABLE IF NOT EXISTS driver_routes (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(60)  NOT NULL,
  origin      VARCHAR(120),
  lot_id      VARCHAR(50)  NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  vehicle_id  INT REFERENCES vehicles(id) ON DELETE SET NULL,
  depart_time VARCHAR(5)   NOT NULL CHECK (depart_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days        SMALLINT[]   NOT NULL DEFAULT '{1,2,3,4,5}',   -- 1 = Thu 2 ... 7 = Chu nhat (ISO)
  minutes     INT          NOT NULL DEFAULT 15 CHECK (minutes BETWEEN 1 AND 120), -- thoi gian giu cho khi dat nhanh
  note        VARCHAR(255),
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_routes_user ON driver_routes (user_id, depart_time);
