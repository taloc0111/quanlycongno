# Dòng tiền v3 — tài khoản, giá vốn nhiều khoản, nhà cung cấp, ví trả trước

Yêu cầu gốc từ một đại lý (2026-11-27):
1. Khách chuyển tiền trước, nhập giá vốn sau.
2. "Vé down" (= vé đạo = vé xuất giảm): giá vốn = phí bên down (tự nhập) + giá vé F1 + phí F1 5.000đ, mỗi khoản trả cho một người.
3. Tiền vào/ra qua nhiều tài khoản (TCB, VIB, ACB, TK người khác giữ hộ); một đơn có thể chia nhiều lần, nhiều nơi. Sợ sót.
4. Đại lý cấp dưới chuyển trước một cục, xuất vé trừ dần → ví trả trước.

Nguyên tắc: **không mất dữ liệu cũ**. Chỉ THÊM bảng/cột (`IF NOT EXISTS`). Cột `cost_amount` hiện có giữ nguyên ý nghĩa
"tổng giá vốn"; khi một dòng dịch vụ có dòng giá vốn (cost items) thì `cost_amount` = tổng các dòng (server tính lại),
không có dòng nào thì giữ giá trị nhập tay như cũ.

## Schema (thêm vào backend/schema/schema.sql)

```sql
-- Tài khoản tiền (ngân hàng / ví / TK người khác giữ hộ)
CREATE TABLE IF NOT EXISTS money_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,            -- "TCB chính", "VIB", "TK chị Lan"
  bank VARCHAR(50),                      -- TCB / VIB / ACB / MoMo / Tiền mặt ...
  account_number VARCHAR(50),
  holder_name VARCHAR(255),              -- chủ tài khoản
  is_own BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = TK người khác giữ hộ (tiền cần thu về)
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Nhà cung cấp: F1, người làm down, khác
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'other',   -- f1 | down | other
  phone VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Dòng giá vốn của 1 dịch vụ (gắn đúng 1 trong 4 bảng, giống payments)
CREATE TABLE IF NOT EXISTS cost_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debt_id INTEGER REFERENCES debts(id) ON DELETE CASCADE,
  passport_id INTEGER REFERENCES passports(id) ON DELETE CASCADE,
  train_ticket_id INTEGER REFERENCES train_tickets(id) ON DELETE CASCADE,
  tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  label VARCHAR(100) NOT NULL,            -- "Giá vé F1", "Phí F1", "Phí down", "Khác"
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,   -- = SUM(supplier_payments gắn với dòng này), server tính
  due_date DATE,                          -- hạn trả NCC (tuỳ chọn)
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_cost_item_target CHECK (
    (debt_id IS NOT NULL)::int + (passport_id IS NOT NULL)::int + (train_ticket_id IS NOT NULL)::int + (tour_id IS NOT NULL)::int = 1
  )
);

-- Tiền trả ra cho nhà cung cấp (có thể gắn 1 dòng giá vốn, hoặc trả gộp)
CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  cost_item_id INTEGER REFERENCES cost_items(id) ON DELETE SET NULL,  -- xoá dòng giá vốn: tiền đã trả vẫn còn (thành trả gộp)
  account_id INTEGER REFERENCES money_accounts(id) ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  pay_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Ví trả trước theo khách (đại lý cấp dưới cũng là 1 khách)
CREATE TABLE IF NOT EXISTS wallet_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,              -- topup (+) | charge (−, trừ khi thanh toán vé) | refund (−, trả lại tiền khách) | adjust (±)
  amount DECIMAL(15,2) NOT NULL,          -- có dấu: nạp dương, trừ âm
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id INTEGER REFERENCES money_accounts(id) ON DELETE SET NULL,  -- topup/refund: tiền vào/ra TK nào
  payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,         -- charge: dòng payments đã tạo
  reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES money_accounts(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE debts         ADD COLUMN IF NOT EXISTS ticket_kind  VARCHAR(10) NOT NULL DEFAULT 'normal'; -- normal | down
ALTER TABLE debts         ADD COLUMN IF NOT EXISTS cost_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE passports     ADD COLUMN IF NOT EXISTS cost_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE train_tickets ADD COLUMN IF NOT EXISTS cost_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tours         ADD COLUMN IF NOT EXISTS cost_pending BOOLEAN NOT NULL DEFAULT FALSE;
-- + index: user_id trên 4 bảng mới; cost_items(debt_id/passport_id/train_ticket_id/tour_id), cost_items(supplier_id);
--   supplier_payments(supplier_id), (account_id); wallet_entries(customer_id), (account_id), (payment_id); payments(account_id)
-- + trigger updated_at cho money_accounts, suppliers.
```

`cost_pending = TRUE` nghĩa là "Chưa đủ giá vốn": dòng đó **không tính vào lợi nhuận** (mọi nơi: stats, dashboard,
trang module), nhưng vẫn tính doanh số / đã thu / còn nợ.

## API

Quy ước như v2: auth bắt buộc; đọc theo `req.scope.userIds` (cấp 1 xem cấp 2, chỉ xem); ghi chỉ trên dữ liệu
`user_id = req.user.id`; id ngoại (account/supplier/customer/cost item) không thuộc mình → **400** với thông báo
tiếng Việt (vd "Tài khoản không hợp lệ"); validate bằng `utils/validate.js`; ghi `logAudit`. Tiền trả về dạng chuỗi
numeric như các API hiện có. Ngày 'YYYY-MM-DD'.

### Tài khoản — `/api/accounts`
- `GET /api/accounts?includeArchived=1` → `[{ id, user_id, owner_name, name, bank, account_number, holder_name, is_own, opening_balance, archived, notes, total_in, total_out, balance, unreconciled_count }]`
  - `total_in` = payments.amount (method ≠ 'wallet') có account_id này + wallet_entries kind topup (amount) có account_id này
  - `total_out` = supplier_payments.amount + |wallet_entries kind refund| có account_id này
  - `balance` = opening_balance + total_in − total_out
- `POST /api/accounts` `{ name*, bank, accountNumber, holderName, isOwn=true, openingBalance=0, notes }` → row
- `PUT /api/accounts/:id` (cùng field, cập nhật từng phần: field vắng = giữ nguyên) + `archived`
- `DELETE /api/accounts/:id` → 400 "Tài khoản đã có giao dịch, hãy lưu trữ thay vì xoá" nếu có bất kỳ giao dịch; không thì xoá.
- `GET /api/accounts/:id/ledger?from&to` → `{ account, opening, rows:[{ kind:'payment'|'topup'|'refund'|'supplier_payment', id, date, direction:'in'|'out', amount, description, customer_name, supplier_name, reconciled, ref:{ type, id } }], total_in, total_out, closing }`
  - `opening` = opening_balance + mọi giao dịch trước `from`; `rows` sắp theo ngày tăng rồi id; `description` ví dụ "Khách Nguyễn A · Vé VN123 HAN-SGN", "Trả F1 Thùy Dương · Giá vé F1 (vé VN123)", "Nạp ví · Đại lý Minh".
  - `ref.type`: 'debt'|'passport'|'train'|'tour' (payment), 'wallet' (topup/refund), 'supplier' (supplier_payment).
- `PUT /api/accounts/reconcile` `{ kind:'payment'|'wallet'|'supplier_payment', id, reconciled:boolean }` → `{ ok:true }` (chỉ trên dữ liệu của mình).

### Nhà cung cấp — `/api/suppliers`
- `GET /api/suppliers` → `[{ id, name, kind, phone, notes, owner_name, total_cost, total_paid, balance, items_count, unpaid_items }]` (balance = total_cost − total_paid = mình còn nợ họ)
- `POST /api/suppliers` `{ name*, kind='other', phone, notes }`; `PUT /:id` (từng phần); `DELETE /:id` → 400 nếu còn dòng giá vốn hoặc thanh toán.
- `GET /api/suppliers/:id/ledger` → `{ supplier, items:[{ id, label, amount, paid_amount, due_date, created_at, target:{ type, id, customer_name, label } }], payments:[{ id, amount, pay_date, account_id, account_name, cost_item_id, cost_item_label, reconciled, notes }], total_cost, total_paid, balance }`
- `POST /api/suppliers/:id/payments` `{ amount*>0, payDate, accountId, costItemId, notes }` → row. costItemId phải thuộc NCC này. Tính lại `cost_items.paid_amount`.
- `DELETE /api/suppliers/payments/:paymentId` → tính lại paid_amount của dòng liên quan.

### Dòng giá vốn trên dịch vụ
Áp dụng cho **cả 4** API dịch vụ (`/debts`, `/passports`, `/train-tickets`, `/tours`):
- Body tạo/sửa nhận thêm: `costPending` (bool), `costItems` (mảng, tuỳ chọn) và với `/debts` thêm `ticketKind` ('normal'|'down').
  - `costItems: [{ id?, supplierId?, label*, amount*≥0, dueDate?, payNow?: { accountId?, payDate? } }]`
  - Khi có khoá `costItems` trong body (kể cả mảng rỗng): server **thay thế** tập dòng của dịch vụ trong cùng transaction —
    dòng có `id` thì cập nhật, dòng mới thì thêm, dòng cũ không còn trong mảng thì xoá (supplier_payments gắn với nó giữ
    nguyên, cost_item_id → NULL). Sau đó: nếu còn ≥1 dòng thì `cost_amount = SUM(amount)`; mảng rỗng thì giữ `costAmount` gửi lên.
  - `payNow`: tạo luôn supplier_payment = amount của dòng (yêu cầu dòng có supplierId; dòng đã trả đủ thì bỏ qua).
  - Không gửi khoá `costItems` → không đụng tới các dòng hiện có (giữ tương thích FE/import cũ).
- GET danh sách trả thêm mỗi dòng: `cost_items` (mảng JSON `[{ id, supplier_id, supplier_name, label, amount, paid_amount, due_date }]`, sắp theo position), `cost_unpaid` (SUM(amount − paid_amount) của các dòng có supplier), `cost_pending`, (debts) `ticket_kind`.
- Import Excel giữ nguyên (không tạo cost items).

### Ví trả trước — `/api/wallets`
- `GET /api/wallets` → `[{ customer_id, customer_name, phone, owner_name, balance, last_entry_date, entries_count }]` — chỉ khách có ít nhất 1 entry, trong scope.
- `GET /api/wallets/:customerId` → `{ customer, balance, entries:[{ id, kind, amount, entry_date, account_id, account_name, payment_id, target_label, reconciled, notes }] }`
- `POST /api/wallets/:customerId/topup` `{ amount*>0, entryDate, accountId, notes }`
- `POST /api/wallets/:customerId/refund` `{ amount*>0, entryDate, accountId, notes }` → 400 nếu vượt số dư.
- `POST /api/wallets/:customerId/adjust` `{ amount (≠0, có dấu), entryDate, notes }`
- `DELETE /api/wallets/entries/:id` → chỉ topup/refund/adjust; xoá topup làm số dư âm → 400 "Số dư ví sẽ âm…". Entry `charge` không xoá trực tiếp (xoá payment tương ứng).

### Thanh toán (mở rộng `/api/payments`)
- `POST /api/payments` thêm `accountId` (TK nhận) và `method: 'wallet'`.
  - `method = 'wallet'`: lấy `customer_id` của dịch vụ; không có khách → 400; số dư ví < amount → 400 "Ví khách chỉ còn X";
    tạo payment (account_id = NULL) + wallet_entries `{ kind:'charge', amount: −amount, payment_id }` trong cùng transaction.
- `GET /api/payments?…` trả thêm `account_id`, `account_name`, `reconciled`.
- `DELETE /api/payments/:id`: wallet entry charge tự xoá theo (CASCADE) → tiền trả lại ví.

### Stats (mở rộng `/api/stats`)
- Lợi nhuận (`totalProfit`, `monthly.profit`, `byType.*` nếu có profit) **bỏ qua dòng cost_pending**.
- Thêm: `costPendingCount`, `supplierOwed` (tổng balance NCC trong scope), `walletTotal` (tổng số dư ví khách), `othersHolding` (tổng balance các TK `is_own = false`).
- `todo.costPending: [{ type, id, customer_name, issue_date, amount }]` (tối đa 50, mới nhất trước), `todo.supplierDue: [{ supplier_id, supplier_name, label, amount_due, due_date, target_label }]` (dòng giá vốn còn nợ có due_date ≤ hôm nay + 7, tối đa 50).

## Frontend
- Menu nhóm mới **"Dòng tiền"**: Tài khoản (`#accounts`, `#accounts/<id>` sổ chi tiết), Nhà cung cấp (`#suppliers`, `#suppliers/<id>`), Ví trả trước (`#wallets`, `#wallets/<customerId>`).
- Form 4 module: khối "Giá vốn" có trình nhập nhiều dòng (CostItemsEditor), công tắc "Chưa đủ giá vốn"; riêng vé máy bay có chọn
  "Loại vé: Thường / Vé down" — chọn Vé down mà chưa có dòng nào thì tự thêm 3 dòng: "Giá vé F1" (NCC loại f1), "Phí F1" 5.000đ (NCC loại f1), "Phí down" (NCC loại down, để trống).
- Bảng: badge "Chưa đủ giá vốn", "Nợ NCC x đ", "Vé down"; thẻ Lợi nhuận ghi rõ "không tính N dòng chưa đủ giá vốn"; bộ lọc "Chưa đủ giá vốn".
- PaymentModal: chọn "Vào tài khoản" (danh sách TK chưa lưu trữ) và hình thức "Trừ ví" (hiện số dư ví của khách).
- Chi tiết khách hàng: khối Ví trả trước (số dư, nạp/hoàn, lịch sử).
- Dashboard: thẻ "Nợ nhà cung cấp", "Tiền đang ở TK người khác", "Ví khách"; việc cần làm thêm "Chưa đủ giá vốn" và "Sắp đến hạn trả NCC".

---

# v3.1 — bổ sung (2026-11-27): chuyển TK, thu nhiều vé, huỷ/hoàn/đổi vé, trả thừa, thu chi khác, sao kê

Nguyên tắc giữ nguyên: chỉ thêm bảng/cột; mọi thao tác tiền phải **hoàn tác được** (xoá thao tác → số liệu về như trước).
Các bảng v3 CHƯA lên production nên được phép nới ràng buộc của chúng (supplier_payments.amount).

## Schema bổ sung
```sql
-- Chuyển tiền giữa 2 tài khoản (vd TK chị Lan trả về TCB, rút tiền mặt). fee = phí chuyển, trừ ở TK nguồn.
CREATE TABLE IF NOT EXISTS account_transfers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  to_account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  fee DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reconciled_from BOOLEAN NOT NULL DEFAULT FALSE,
  reconciled_to BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_transfer_accounts CHECK (from_account_id <> to_account_id)
);

-- Thu chi khác ngoài vé (phí ngân hàng, văn phòng, lương, rút tiền riêng, góp vốn...)
CREATE TABLE IF NOT EXISTS account_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
  direction VARCHAR(3) NOT NULL CHECK (direction IN ('in','out')),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category VARCHAR(50) NOT NULL DEFAULT 'Khác',
  reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Phiếu thu: 1 lần khách chuyển khoản, chia cho nhiều dịch vụ (+ phần thừa vào ví)
CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES money_accounts(id) ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method VARCHAR(30),
  payment_target VARCHAR(20) NOT NULL DEFAULT 'self',
  reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE payments       ADD COLUMN IF NOT EXISTS receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE;
ALTER TABLE payments       ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'payment'; -- payment | refund (hoàn tiền khách, amount ÂM)
ALTER TABLE wallet_entries ADD COLUMN IF NOT EXISTS receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE;
-- wallet_entries.kind thêm giá trị 'credit' (+): hoàn vé vào ví (gắn payment_id của dòng hoàn); không có tiền thật đi qua TK.
ALTER TABLE cost_items     ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'cost'; -- cost | refund (NCC hoàn, amount ÂM) | change (phí đổi)
-- supplier_payments: cho phép amount ÂM = NCC trả lại tiền cho mình (tiền VÀO tài khoản).
ALTER TABLE supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_amount_check;
ALTER TABLE supplier_payments DROP CONSTRAINT IF EXISTS chk_supplier_payment_amount;
ALTER TABLE supplier_payments ADD CONSTRAINT chk_supplier_payment_amount CHECK (amount <> 0);
-- Trạng thái huỷ trên 3 bảng chưa có trạng thái (tours dùng tours.status = 'cancelled' sẵn có)
ALTER TABLE debts         ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'; -- active | cancelled
ALTER TABLE passports     ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE train_tickets ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
-- Cả 4 bảng (debts, passports, train_tickets, tours): giá bán gốc trước khi huỷ + ngày/ghi chú huỷ
--   ADD COLUMN IF NOT EXISTS original_amount DECIMAL(15,2), cancelled_at DATE, cancel_note TEXT
-- + index: account_transfers(from_account_id), (to_account_id); account_entries(account_id); receipts(customer_id), (account_id);
--   payments(receipt_id); wallet_entries(receipt_id)
```

## Công thức số dư tài khoản (thay công thức v3)
```
balance = opening_balance
        + Σ payments.amount            (method ≠ 'wallet', account_id = TK; dòng refund âm tự trừ)
        + Σ wallet_entries topup       (account_id = TK)
        − Σ |wallet_entries refund|    (account_id = TK)
        − Σ supplier_payments.amount   (account_id = TK; âm = NCC trả lại → cộng)
        + Σ transfers.amount           (to_account_id = TK)
        − Σ (transfers.amount + fee)   (from_account_id = TK)
        + Σ account_entries in − Σ account_entries out
total_in / total_out: cộng theo chiều thực tế của từng dòng (tiền vào / tiền ra).
```

## Ledger `GET /api/accounts/:id/ledger` — kind mới
`receipt` (1 phiếu thu = 1 dòng, amount = receipts.amount, description liệt kê các vé + "vào ví X"), `customer_refund`
(payment kind refund, out), `supplier_refund` (supplier_payment âm, in), `transfer_in`, `transfer_out` (amount + fee; fee ghi
trong description), `entry_in`, `entry_out` (description = category + notes). Payments thuộc receipt KHÔNG hiện riêng. Mỗi dòng giữ
`{ kind, id, date, direction, amount, description, reconciled, ref }`.
`PUT /api/accounts/reconcile` nhận thêm kind: `receipt` (đánh dấu receipt + mọi con), `transfer_in`, `transfer_out`, `entry`.
`PUT /api/accounts/reconcile-batch` `{ items:[{kind,id,reconciled}] }` → `{ updated }` (dùng cho khớp sao kê).

## API mới
### Chuyển tiền & thu chi khác
- `GET /api/accounts/transfers?accountId=` · `POST /api/accounts/transfers` `{ fromAccountId*, toAccountId*, amount*>0, fee=0, transferDate, notes }` · `DELETE /api/accounts/transfers/:id`
- `GET /api/accounts/entries?accountId=&from=&to=&category=` · `POST /api/accounts/entries` `{ accountId*, direction*('in'|'out'), amount*>0, entryDate, category, notes }` · `PUT /api/accounts/entries/:id` · `DELETE /api/accounts/entries/:id`
- Danh mục gợi ý (FE): chi — Phí ngân hàng, Văn phòng, Lương, Quảng cáo, Điện nước, Rút tiền riêng, Khác; thu — Góp vốn, Lãi ngân hàng, Thu khác.
  "Rút tiền riêng" và "Góp vốn" KHÔNG tính vào lãi/lỗ (chỉ là dòng tiền của chủ).

### Phiếu thu nhiều vé — `/api/receipts`
- `POST /api/receipts` `{ accountId, receiptDate, method (≠ 'wallet'), paymentTarget, notes, customerId?, amount*>0, allocations:[{ type:'debt'|'passport'|'train'|'tour', id, amount>0 }] }`
  - Σ allocations ≤ amount; mỗi allocation ≤ số còn nợ của dịch vụ (400 nếu vượt). Dịch vụ phải của mình, không bị huỷ.
  - Phần thừa (amount − Σ allocations) > 0 → bắt buộc `customerId` (của mình) → wallet_entries topup (account_id = TK phiếu, receipt_id). Không có khách → 400.
  - Tạo payments (receipt_id, account_id, method, payment_target) cho từng allocation; recompute paid. Một transaction.
  - Trả `{ receipt, payments, walletTopup }`.
- `GET /api/receipts?customerId=` (scope) → `[{ ...receipt, account_name, customer_name, allocations:[{ type, id, label, amount }], wallet_amount }]`
- `DELETE /api/receipts/:id` → xoá phiếu + payments + topup (CASCADE), recompute paid; nếu ví khách sẽ âm → 400.
- `GET /api/customers/:id/outstanding` → `[{ type, id, label, issue_date, due_date, total, paid, remaining }]` các dịch vụ còn nợ (chưa huỷ), cũ nhất trước.

### Trả thừa
`POST /api/payments` (không phải wallet): nếu amount > số còn nợ và dịch vụ có customer_id → tự tạo receipt: phần = còn nợ vào
dịch vụ, phần thừa vào ví (topup). Response thêm `{ overflowToWallet, receiptId }`. Dịch vụ không có khách → giữ hành vi cũ.
Body `noOverflow: true` → giữ hành vi cũ. Dịch vụ đã huỷ → 400.

### Huỷ / hoàn vé (cả 4 loại) — `POST /api/{debts|passports|train-tickets|tours}/:id/cancel`
```
{ cancelDate, note,
  finalAmount,                          // số tiền khách CHỊU sau huỷ (phí huỷ/hoàn). Mặc định 0.
  customerRefund: { amount, to:'wallet'|'account', accountId },   // mặc định amount = max(0, đã trả − finalAmount), to = 'wallet' nếu có khách
  supplierRefunds: [{ supplierId, amount>0, receivedNow?:bool, accountId? }] }  // NCC (F1) hoàn lại cho mình
```
Server (1 transaction):
1. `original_amount` = giá bán hiện tại (nếu chưa có); giá bán (`ticket_amount`/`total_amount`/`sell_amount`) = finalAmount;
   status = 'cancelled' (tours: 'cancelled'), cancelled_at, cancel_note.
2. customerRefund.amount > 0 → payments `{ kind:'refund', amount: −X, method: to==='wallet' ? 'wallet' : 'bank_transfer', account_id }`;
   to = wallet → wallet_entries `{ kind:'credit', amount:+X, payment_id }`. Recompute paid. Không hoàn quá số đã trả (400).
3. Dịch vụ chưa có cost items mà cost_amount > 0 → tạo 1 dòng "Giá vốn" = cost_amount (supplier NULL) để giữ nguyên giá trị.
   Mỗi supplierRefund → cost_items `{ kind:'refund', label:'Hoàn từ <tên NCC>', amount: −amount, supplier_id }`;
   receivedNow → supplier_payments `{ amount: −amount, cost_item_id, account_id }`. Đồng bộ cost_amount = Σ items.
4. Đã huỷ rồi → 400. Kết quả: lãi = phí khách chịu − giá vốn không được hoàn.
- `POST /api/{…}/:id/uncancel` → hoàn tác TOÀN BỘ (xoá payments kind refund + credit ví (400 nếu ví sẽ âm), xoá cost items kind
  refund + supplier_payments gắn chúng, giá bán = original_amount, status 'active' / tours 'deposited', xoá cancelled_at/cancel_note).
- Huỷ/hoàn tác ghi audit. Dịch vụ đã huỷ: không nhận thanh toán mới (400); không vào "quá hạn"/"đến hạn".

### Đổi vé (vé máy bay) — `POST /api/debts/:id/change`
`{ changeDate, customerFee≥0, supplierFee≥0, supplierId?, newFlightDate?, newRoute?, newTicketCode?, note }`
→ ticket_amount += customerFee; supplierFee > 0 → cost item `{ kind:'change', label:'Phí đổi vé', amount, supplier_id }`
(tạo dòng "Giá vốn" từ cost_amount trước nếu chưa có items); cập nhật ngày bay/hành trình/mã vé nếu gửi; nối vào notes
"[dd/mm/yyyy] Đổi vé: …". Audit.

### NCC
- Balance âm = NCC đang giữ tiền của mình → FE hiện "Đang giữ của mình X".
- `POST /api/suppliers/:id/payments` thêm `direction: 'out' (mặc định) | 'in'` — 'in' = NCC trả lại, lưu amount âm.

### Stats bổ sung
`otherIncome`, `otherExpense` (account_entries trong scope, bỏ "Góp vốn"/"Rút tiền riêng"), `netProfit = totalProfit + otherIncome − otherExpense`;
`monthly[].otherExpense`, `monthly[].netProfit`; `counts.cancelled`.

## Frontend v3.1
- Bảng dịch vụ: badge "Đã huỷ" (mờ dòng; hiện giá gốc gạch ngang + giá còn lại), bộ lọc trạng thái (Đang hiệu lực/Đã huỷ/Tất cả);
  thao tác "Huỷ / hoàn" (modal: phí khách chịu, tiền trả khách tự tính + chọn ví/TK, các dòng NCC hoàn + nhận ngay + TK, xem trước lãi/lỗ),
  "Hoàn tác huỷ", (vé máy bay) "Đổi vé". Chọn nhiều dòng cùng 1 khách → "Thu tiền các vé đã chọn" mở ReceiptModal.
- PaymentModal: số tiền > còn nợ và có khách → "Phần thừa X sẽ vào ví khách".
- `ReceiptModal` (`src/modules/money/ReceiptModal.jsx`, props `{ open, onClose, onDone, customerId, preselect: [{type,id}] }`):
  số tiền khách chuyển + TK + ngày + hình thức; danh sách còn nợ (GET /customers/:id/outstanding) có ô nhập số chia + "Chia tự động
  (cũ trước)"; hiện phần thừa vào ví. Mở từ Chi tiết khách ("Thu tiền nhiều vé") và từ bảng dịch vụ.
- Tài khoản: "Chuyển tiền", "Thu/chi khác" trên trang TK và sổ; ledger hiện kind mới; trang "Thu chi khác" (`#expenses`, lọc danh mục/tháng);
  "Khớp sao kê": tải Excel/CSV → map cột (ngày, số tiền hoặc ghi có/ghi nợ, nội dung) → gợi ý khớp dòng chưa đối soát (cùng chiều,
  cùng số tiền, lệch ≤ 3 ngày) → xác nhận → reconcile-batch; dòng không khớp cho tạo nhanh "Thu/chi khác".
- NCC: số dư âm hiện "Đang giữ của mình"; modal trả tiền có chiều "NCC trả lại cho mình".
- Dashboard: thẻ "Lãi ròng", biểu đồ tháng thêm đường lãi ròng; việc cần làm bỏ qua dịch vụ đã huỷ.
