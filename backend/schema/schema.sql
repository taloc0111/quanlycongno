-- ============================================================================
-- schema.sql  —  NGUỒN SCHEMA DUY NHẤT (single source of truth)
-- An toàn chạy lại nhiều lần (idempotent): KHÔNG drop bảng, KHÔNG xoá dữ liệu.
-- Thay thế cho database.sql / new.sql / passports.sql (đã bị xoá vì mâu thuẫn).
--
-- Cách chạy:
--   psql "<CONNECTION_STRING>" -f schema/schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USERS — tài khoản đăng nhập
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  email         VARCHAR(255),
  role          VARCHAR(20)  NOT NULL DEFAULT 'user',   -- user | admin
  trial_ends_at TIMESTAMPTZ,                             -- NULL = không giới hạn; có giá trị = tài khoản dùng thử
  created_at    TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- COMPANIES — công ty / đại lý (khách hàng doanh nghiệp B2B có hạn mức nợ)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  tax_code       VARCHAR(50),
  address        TEXT,
  email          VARCHAR(255),
  contact_person VARCHAR(255),
  phone          VARCHAR(20),
  credit_limit   DECIMAL(15,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- CUSTOMERS — danh bạ khách hàng (cá nhân hoặc công ty). MỚI — best practice:
-- khách hàng là entity riêng, mỗi giao dịch (vé/hộ chiếu) tham chiếu customer_id
-- thay vì lặp lại tên + SĐT dạng text trên từng dòng.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  phone        VARCHAR(20),
  email        VARCHAR(255),
  address      TEXT,
  id_number    VARCHAR(50),                              -- CCCD / CMND / hộ chiếu
  type         VARCHAR(20) NOT NULL DEFAULT 'individual',-- individual | company
  company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  credit_limit DECIMAL(15,2) DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  -- Định danh khách = (tên + SĐT): cùng tên VÀ cùng SĐT mới là 1 khách.
  -- Không ràng buộc UNIQUE theo SĐT (nhiều người có thể chung 1 số).
);

-- ---------------------------------------------------------------------------
-- FLIGHT_ROUTES — danh mục hành trình bay (HAN-SGN, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flight_routes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, route_name)
);

-- ---------------------------------------------------------------------------
-- DEBTS — công nợ vé máy bay
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS debts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  phone_number  VARCHAR(20),
  ticket_code   VARCHAR(50),
  airline       VARCHAR(50),
  route         VARCHAR(50),
  flight_date   DATE,
  issue_date    DATE,
  due_date      DATE,                                    -- hạn thanh toán
  ticket_source VARCHAR(100),                            -- nơi/nguồn xuất vé (Ngọc Mai, website, ...)
  ticket_amount DECIMAL(15,2) NOT NULL DEFAULT 0,        -- giá bán cho khách
  cost_amount   DECIMAL(15,2) NOT NULL DEFAULT 0,        -- giá gốc/giá vốn (để tính lợi nhuận)
  paid          DECIMAL(15,2) NOT NULL DEFAULT 0,        -- tổng đã trả (suy ra từ payments)
  notes         TEXT,
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  checked_in    BOOLEAN NOT NULL DEFAULT FALSE,         -- đã check-in online cho khách chưa
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- PASSPORTS — dịch vụ làm hộ chiếu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passports (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  passport_number VARCHAR(50),
  customer_name   VARCHAR(255) NOT NULL,
  phone_number    VARCHAR(20),
  address         VARCHAR(255),
  service_date    DATE NOT NULL,
  due_date        DATE,
  total_amount    NUMERIC(15,2) NOT NULL,                 -- giá bán cho khách
  cost_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,        -- giá gốc/giá vốn
  paid_amount     NUMERIC(15,2) DEFAULT 0,
  notes           TEXT,
  company_id      INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- PAYMENTS — lịch sử thanh toán (sổ giao dịch). MỚI — best practice kế toán:
-- KHÔNG sửa cột `paid` trực tiếp, luôn ghi 1 dòng vào đây để có audit trail.
-- Mỗi payment gắn với 1 debt HOẶC 1 passport (không cả hai).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debt_id      INTEGER REFERENCES debts(id) ON DELETE CASCADE,
  passport_id  INTEGER REFERENCES passports(id) ON DELETE CASCADE,
  amount       DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method       VARCHAR(30),                              -- cash | bank_transfer | momo | ...
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_payment_target CHECK (
    (debt_id IS NOT NULL AND passport_id IS NULL) OR
    (debt_id IS NULL     AND passport_id IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- FUND_DEPOSITS — nộp quỹ (đại lý cấp 2 nộp tiền lên cấp 1). Sổ theo dõi.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fund_deposits (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- người nộp
  amount       DECIMAL(15,2) NOT NULL,
  deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method       VARCHAR(30),                              -- cash | bank_transfer | momo
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- INVOICES — hóa đơn
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) NOT NULL,
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  issue_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  subtotal       DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount   DECIMAL(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(20) NOT NULL DEFAULT 'unpaid',  -- unpaid | partial | paid | cancelled
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          SERIAL PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  debt_id     INTEGER REFERENCES debts(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount      DECIMAL(15,2) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- TRAIN_TICKETS — công nợ vé tàu hỏa (tương tự debts cho vé máy bay).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS train_tickets (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  phone_number  VARCHAR(20),
  train_no      VARCHAR(50),                            -- số tàu (VD: SE7)
  route         VARCHAR(100),                           -- ga đi - ga đến
  seat_class    VARCHAR(100),                           -- loại chỗ/giường
  depart_date   DATE,                                   -- ngày đi
  issue_date    DATE,
  due_date      DATE,
  ticket_source VARCHAR(100),
  ticket_amount DECIMAL(15,2) NOT NULL DEFAULT 0,        -- giá bán
  cost_amount   DECIMAL(15,2) NOT NULL DEFAULT 0,        -- giá gốc
  paid          DECIMAL(15,2) NOT NULL DEFAULT 0,        -- tổng đã trả (suy ra từ payments)
  notes         TEXT,
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- TOURS — nghiệp vụ Du lịch (bán tour, công nợ + lợi nhuận).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tours (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  phone_number  VARCHAR(20),
  tour_name     VARCHAR(255),                          -- tên tour / điểm đến
  depart_date   DATE,                                  -- ngày đi
  return_date   DATE,                                  -- ngày về
  pax           INTEGER DEFAULT 1,                     -- số khách
  issue_date    DATE,
  due_date      DATE,
  source        VARCHAR(100),                          -- nguồn/đối tác điều hành
  sell_amount   DECIMAL(15,2) NOT NULL DEFAULT 0,       -- giá bán (tổng)
  cost_amount   DECIMAL(15,2) NOT NULL DEFAULT 0,       -- giá gốc (tổng)
  paid          DECIMAL(15,2) NOT NULL DEFAULT 0,       -- đã trả (suy ra từ payments)
  status        VARCHAR(20) NOT NULL DEFAULT 'deposited', -- consulting|deposited|completed|cancelled
  notes         TEXT,
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- STICKY_NOTES — ghi chú nhanh dạng sticky, riêng tư theo từng user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sticky_notes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT        NOT NULL DEFAULT '',
  color      VARCHAR(20) NOT NULL DEFAULT 'yellow',   -- yellow | green | pink | blue | purple
  pinned     BOOLEAN     NOT NULL DEFAULT FALSE,
  position   INTEGER     NOT NULL DEFAULT 0,           -- thứ tự sắp xếp do người dùng kéo
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- TICKET_WATCHES — yêu cầu "canh vé" cho khách (theo dõi vé rẻ theo chặng/ngày).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_watches (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_name VARCHAR(255) NOT NULL,
  phone_number  VARCHAR(20),
  route         VARCHAR(100),                          -- VD: SGN-HAN
  depart_date   DATE,                                  -- ngày đi mong muốn
  return_date   DATE,                                  -- ngày về (khứ hồi, có thể trống)
  airline       VARCHAR(50),
  pax           INTEGER DEFAULT 1,                     -- số khách
  target_price  DECIMAL(15,2) DEFAULT 0,               -- giá mong muốn
  status        VARCHAR(20) NOT NULL DEFAULT 'watching', -- watching | quoted | booked | cancelled
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- AIRLINES — hãng bay + link check-in tự khai báo (để khỏi sửa code khi có hãng mới).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS airlines (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,   -- tên hãng (dùng để khớp với ô "Hãng" của vé)
  code        VARCHAR(10),             -- mã 2 ký tự (VD: VJ, VN) — tùy chọn
  checkin_url TEXT NOT NULL,           -- link check-in online của hãng
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- PASSWORD_RESETS — token đặt lại mật khẩu (gửi qua email, hết hạn + dùng 1 lần).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,                  -- sha256 của token (không lưu token thô)
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);

-- ============================================================================
-- NÂNG CẤP DB CŨ — thêm cột mới nếu chưa có (an toàn cho DB đang có dữ liệu)
-- ============================================================================
-- Phân cấp đại lý: users.parent_id (cấp 1 là cha của cấp 2) + role.
ALTER TABLE users     ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users     ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE users     ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

ALTER TABLE debts     ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE debts     ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE debts     ADD COLUMN IF NOT EXISTS airline VARCHAR(50);
ALTER TABLE debts     ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE debts     ADD COLUMN IF NOT EXISTS ticket_source VARCHAR(100);
ALTER TABLE debts     ADD COLUMN IF NOT EXISTS checked_in BOOLEAN NOT NULL DEFAULT FALSE;

-- Bỏ ràng buộc "mỗi SĐT 1 khách" (chuyển sang định danh theo tên + SĐT).
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_user_id_phone_key;
ALTER TABLE passports ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE passports ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE passports ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday DATE;

-- Theo dõi thanh toán vào tài khoản nào: 'self' = TK cá nhân, 'agency' = TK đại lý cấp trên.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_target VARCHAR(20) NOT NULL DEFAULT 'self';

-- Payments hỗ trợ thêm vé tàu + tour: mỗi payment gắn đúng 1 đối tượng.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS train_ticket_id INTEGER REFERENCES train_tickets(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payment_target;
ALTER TABLE payments ADD CONSTRAINT chk_payment_target CHECK (
  (debt_id IS NOT NULL)::int + (passport_id IS NOT NULL)::int + (train_ticket_id IS NOT NULL)::int + (tour_id IS NOT NULL)::int = 1
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_parent_id       ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_customers_user_id      ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_user_id      ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_flight_routes_user_id  ON flight_routes(user_id);

CREATE INDEX IF NOT EXISTS idx_debts_user_id          ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_customer_id      ON debts(customer_id);
CREATE INDEX IF NOT EXISTS idx_debts_company_id       ON debts(company_id);
CREATE INDEX IF NOT EXISTS idx_debts_issue_date       ON debts(issue_date);
CREATE INDEX IF NOT EXISTS idx_debts_customer_name    ON debts(customer_name);

CREATE INDEX IF NOT EXISTS idx_passports_user_id      ON passports(user_id);
CREATE INDEX IF NOT EXISTS idx_passports_customer_id  ON passports(customer_id);
CREATE INDEX IF NOT EXISTS idx_passports_company_id   ON passports(company_id);
CREATE INDEX IF NOT EXISTS idx_passports_service_date ON passports(service_date);

CREATE INDEX IF NOT EXISTS idx_payments_user_id       ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_debt_id       ON payments(debt_id);
CREATE INDEX IF NOT EXISTS idx_payments_passport_id   ON payments(passport_id);

CREATE INDEX IF NOT EXISTS idx_fund_deposits_user_id  ON fund_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_user_id   ON sticky_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_watches_user_id ON ticket_watches(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_watches_depart  ON ticket_watches(depart_date);
CREATE INDEX IF NOT EXISTS idx_airlines_user_id       ON airlines(user_id);
CREATE INDEX IF NOT EXISTS idx_train_tickets_user_id  ON train_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_train_tickets_depart   ON train_tickets(depart_date);
CREATE INDEX IF NOT EXISTS idx_payments_train_ticket  ON payments(train_ticket_id);
CREATE INDEX IF NOT EXISTS idx_tours_user_id          ON tours(user_id);
CREATE INDEX IF NOT EXISTS idx_tours_depart           ON tours(depart_date);
CREATE INDEX IF NOT EXISTS idx_payments_tour          ON payments(tour_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user_id       ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id   ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice  ON invoice_items(invoice_id);

-- ============================================================================
-- TRIGGER tự cập nhật updated_at — best practice, đỡ phải set tay trong code
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','companies','customers','debts','passports','invoices','sticky_notes','ticket_watches','airlines','train_tickets','tours']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
  END LOOP;
END $$;
