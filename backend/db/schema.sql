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
