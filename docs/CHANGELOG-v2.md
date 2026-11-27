# Bản v2 — 2026-11-27

Mục tiêu: sửa các lỗi mất dữ liệu/bảo mật, san bằng tính năng 4 module nghiệp vụ, giao diện mới, và
tính năng **bật Canh vé cho từng đại lý**.

## Tính năng mới
- **Canh vé theo đại lý**: admin bật/tắt ở trang *Đại lý* (cột "Canh vé"). Tắt → menu Canh vé + Check vé ẩn
  và API trả 403. Lưu ở `users.features` (JSONB). Admin luôn có.
- **Chi tiết khách hàng** (`#customer/<id>`): mọi giao dịch 4 loại + lịch sử thanh toán + tổng còn nợ, lọc theo kỳ.
- **Bảng kê công nợ** in / lưu PDF / sao chép tóm tắt gửi Zalo.
- **Dashboard mới**: việc cần làm hôm nay (bay ngày mai chưa check-in, đến hạn 7 ngày, quá hạn, canh vé đạt giá),
  biểu đồ 12 tháng, cơ cấu theo dịch vụ, top nợ.
- **Nhật ký thao tác** (`audit_logs`): ai thêm/sửa/xoá/thanh toán/đăng nhập, admin và cấp 1 xem được trong phạm vi.
- **Đặt lại mật khẩu cho đại lý con** (admin hoặc cấp 1).
- Import Excel cho vé tàu và tour; export Excel cho hộ chiếu; phân trang/ẩn cột/PaymentModal cho hộ chiếu.
- Điều hướng bằng hash (`#debt`, `#customer/12`): tải lại trang vẫn đúng màn hình, có nút Back.

## Lỗi đã sửa
- Canh vé: đổi trạng thái làm mất chặng/ngày/hãng (PUT ghi đè null).
- Hộ chiếu: số tiền đã trả bị xoá khi ghi thanh toán lần đầu; import vé/hộ chiếu không tạo dòng thanh toán.
- Hoá đơn: có thể gắn khách/công ty/vé của đại lý khác (lộ tên). Company id của người khác trên mọi module.
- Xoá đại lý cấp 1 làm đại lý con "mồ côi" → giờ chặn.
- Worker canh giá: interval sai → vòng 1 ms; vòng chồng vòng; mất cảnh báo khi mail lỗi; check-now không rate-limit.
- Ngày lệch 1 ngày trước 7h sáng (dùng UTC): DATE giờ trả chuỗi `YYYY-MM-DD`, "hôm nay" tính theo `TZ_OFFSET_HOURS`.
- Express 5 không có `req.body` → 500; chuỗi rỗng vào cột số/ngày → 500; vượt VARCHAR → 500. Giờ trả 400 có thông báo.
- FE: thêm/sửa vé không kiểm tra lỗi server; thống kê hộ chiếu ra NaN; icon tìm kiếm lệch; token hết hạn không tự đăng xuất.
- Modal: con trỏ bị kéo về ô đầu sau mỗi phím gõ (lỗi phát hiện khi chạy smoke test).

## Kiến trúc
- 4 module (vé máy bay / vé tàu / hộ chiếu / tour) chạy trên **một** `ServicePage` + config
  (`website/src/modules/serviceConfigs.jsx`). Thêm loại dịch vụ mới = thêm 1 config + 1 controller.
- Bộ UI dùng chung `website/src/ui` (xem `website/UI-GUIDE.md`); toast/confirm toàn cục; design token trong
  `tailwind.config.js` (font Be Vietnam Pro, màu brand/ink/surface/success/warning/danger).
- Backend: `app.js` (Express app) tách khỏi `server.js`; validate tập trung `utils/validate.js`;
  `utils/ownership.js`; `middleware/features.js`; auth đọc user từ DB mỗi request (khoá/bật tính năng có hiệu lực ngay).

## Kiểm thử
- Backend: `npm test` — 26 test tích hợp (node:test + Postgres local), gồm phân quyền, feature gate, sổ thanh toán,
  partial update canh vé, validation, import, stats, audit.
- Frontend: `npm test` — 22 test Vitest (format ngày/tiền, hook bảng, client 401/403, ServicePage với API giả).
- Smoke test trình duyệt headless (Playwright, ngoài repo): 16 trang, 0 lỗi console/runtime/5xx; ảnh ở `docs/screenshots/`.

## Chưa làm (đề xuất đợt sau)
- Tìm kiếm + phân trang phía server (hiện vẫn tải cả bảng rồi lọc trên client).
- Dark mode, PWA cài lên điện thoại, tìm nhanh Ctrl+K.
- Nhắc hạn qua email/Zalo tự động (hiện chỉ hiện trên Dashboard).
- `xlsx` có 2 CVE chưa có bản vá → cân nhắc đổi sang `exceljs`.
