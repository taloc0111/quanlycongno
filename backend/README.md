# Debt Management Backend API

Node 24 · Express 5 · PostgreSQL (`pg`). Entry: `server.js` (listen + worker) → `app.js` (Express app).

## Setup

1. Cài PostgreSQL, tạo database.
2. `cp .env.example .env` rồi điền `DATABASE_URL` (hoặc `DB_*`) + `JWT_SECRET` (≥ 32 ký tự).
3. `npm install`
4. Schema tự áp khi khởi động (`schema/schema.sql`, idempotent). Tắt bằng `AUTO_MIGRATE=false` và chạy tay `npm run migrate`.
5. `npm run dev` (nodemon) hoặc `npm start`.
6. Tài khoản demo: `npm run seed`.

## Test

```bash
npm test
```

Dùng Node test runner, chạy trên Postgres **local** (mặc định `postgresql://postgres@127.0.0.1:5499/qlcn_test`, ghi đè bằng `DATABASE_URL`). `test/helpers.js` từ chối DB không phải localhost và **xoá sạch mọi bảng** trước khi chạy.

## Quy ước chung

- Mọi route trừ `/api/auth/login|register|forgot-password|reset-password` cần `Authorization: Bearer <jwt>`.
- Phân cấp: `admin` thấy tất cả; `agency`/`user` thấy mình + đại lý con (đệ quy `parent_id`). Ghi (tạo/sửa/xóa) luôn giới hạn ở dữ liệu của chính mình; `?agencyId=` lọc 1 đại lý trong phạm vi.
- Lỗi: `400` validate (`{ error }`), `401` thiếu/sai token hoặc tài khoản không tồn tại, `403` hết hạn dùng thử / không có quyền / tính năng chưa bật (`{ error, featureDisabled }`), `404` không thấy, `409` trùng, `413` body quá lớn, `429` rate-limit.
- Cột `DATE` trả về chuỗi `YYYY-MM-DD`; "hôm nay" tính theo `TZ_OFFSET_HOURS` (mặc định 7).
- Cột `paid` / `paid_amount` là tổng từ bảng `payments` — không sửa trực tiếp.

## API

### Auth — `/api/auth`
- `POST /login`, `POST /register` → `{ token, username, userId, fullName, role, trialEndsAt, features }`
- `GET /profile` → `{ id, username, full_name, email, role, parent_id, trial_ends_at, created_at, features }`
- `PUT /profile`, `PUT /password`, `POST /forgot-password`, `POST /reset-password`

### Users — `/api/users`
- `GET /` (kèm `outstanding` + `features`), `POST /`, `PUT /:id`, `DELETE /:id` (400 nếu còn đại lý con)
- `PUT /:id/trial` `{ action: extend|unlimited|revoke, days }`
- `PUT /:id/features` `{ fareWatch: boolean }` — **admin**
- `POST /:id/password` `{ newPassword }` — admin hoặc đại lý cha

### Dịch vụ (cùng khuôn)
`/api/debts` (vé máy bay) · `/api/passports` · `/api/train-tickets` · `/api/tours`
- `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /bulk-delete { ids }`, `POST /import { rows }` → `{ inserted, failed, errors }`
- `PUT /api/debts/:id/checkin { checkedIn }`
- `companyId` phải thuộc về người tạo; `paid`/`paidAmount` khi tạo sẽ sinh 1 dòng `payments` (`paymentTarget: self|agency`, `accountId` tuỳ chọn).
- Dòng tiền v3 (xem `docs/MONEY-FLOWS.md`): body nhận thêm `costPending`, `costItems[{ id?, supplierId?, label, amount, dueDate?, payNow? }]` (có khoá = thay thế toàn bộ dòng; còn dòng → `cost_amount` = tổng), riêng vé máy bay `ticketKind: normal|down`. Sửa không gửi `costAmount`/`costPending`/`ticketKind` → giữ nguyên. GET trả thêm `cost_items`, `cost_unpaid`, `cost_pending`, (debts) `ticket_kind`.

### Khách hàng — `/api/customers`
- `GET /` (kèm `outstanding` 4 loại), `POST /`, `PUT /:id`, `DELETE /:id` (400 nếu khách đã có giao dịch ví), `POST /bulk-delete` (`{ deleted, skipped }` — bỏ qua khách có ví), `POST /import`
- `GET /:id/detail?from=&to=` → `{ customer, debts, passports, trainTickets, tours, payments[{type, target_label}], totals: { sold, cost, paid, outstanding } }`

### Thanh toán — `/api/payments`
- `GET /?debtId=|passportId=|trainTicketId=|tourId=` (kèm `account_name`), `POST /` (đúng 1 target, `amount > 0`, `accountId`, `method: 'wallet'` = trừ ví khách), `DELETE /:id` (trừ ví → hoàn lại ví)

### Dòng tiền v3 — tài khoản / nhà cung cấp / ví (`docs/MONEY-FLOWS.md`)
- `/api/accounts`: `GET /?includeArchived=1` (kèm `total_in/total_out/balance/unreconciled_count`), `POST /`, `PUT /:id` (từng phần, `archived`), `DELETE /:id` (400 nếu có giao dịch), `GET /:id/ledger?from&to`, `PUT /reconcile { kind: payment|wallet|supplier_payment, id, reconciled }`
- `/api/suppliers`: `GET /` (kèm `total_cost/total_paid/balance`), `POST /`, `PUT /:id`, `DELETE /:id` (400 nếu đã dùng), `GET /:id/ledger`, `POST /:id/payments`, `DELETE /payments/:paymentId`
- `/api/wallets`: `GET /`, `GET /:customerId`, `POST /:customerId/topup|refund|adjust`, `DELETE /entries/:id` (không xoá được entry `charge`, không cho số dư âm)

### Hóa đơn — `/api/invoices`
- `GET /`, `GET /:id` (kèm `items`), `POST /`, `PUT /:id` (từng phần; `items` thay toàn bộ dòng), `DELETE /:id`

### Nộp quỹ — `/api/deposits`
- `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /bulk-delete`, `GET /balance`

### Thống kê — `GET /api/stats`
`{ totalAmount, totalPaid, outstanding, totalProfit, costPendingCount, supplierOwed, walletTotal, othersHolding, overdue, counts{debts,passports,trainTickets,tours,customers}, byType{*: amount,cost,paid,count,profit,costPendingCount}, topDebtors, monthly (12 tháng), todo{ flightsTomorrow, dueSoon, overdue, fareHits, costPending, supplierDue } }` — lợi nhuận bỏ qua dòng `cost_pending`.

### Canh vé (cần cờ `fareWatch`)
- `/api/ticket-watches`: `GET /`, `POST /`, `PUT /:id` (từng phần), `DELETE /:id`, `GET /:id/snapshots`, `POST /:id/check-now` (3 lần/phút/user)
- `POST /api/fares/quote { route, date, returnDate?, pax }`

### Khác
- `/api/companies`, `/api/routes`, `/api/airlines`, `/api/notes`: CRUD riêng theo user.
- `GET /api/audit?limit=&userId=` → `{ rows }` nhật ký thao tác trong phạm vi.
- `GET /api/health`

## Worker canh giá
`npm run fare-watch` (1 vòng) · `npm run fare-watch:loop` · hoặc `FARE_WATCHER=true` để chạy trong app. Cấu hình: `FARE_WATCH_INTERVAL_MIN` (≥1, mặc định 60), `FARE_ALERT_COOLDOWN_H` (≥0, mặc định 12), `FARE_ALERT_EMAIL`, `SERPAPI_KEY`.
