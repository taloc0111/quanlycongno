# Worker canh giá vé (fare watcher) — nhánh SerpApi-only

Tự động lấy giá vé và cảnh báo khi giá ≤ giá mong muốn của yêu cầu "Canh vé".
**Không dùng Playwright/Chromium** — toàn bộ nguồn giá đi HTTP thuần nên chạy
được ngay trên web service RAM thấp (Render free), không cần worker/VPS riêng.

## Nguồn giá (ưu tiên theo thứ tự)

1. **SerpApi (Google Flights)** — bật bằng `SERPAPI_KEY` (`lib/serpapi.js`).
   1 search trả giá **mọi hãng** trên chặng (đã verify 2026-06: đủ cả
   VJ/VN/QH/9G/VU trên SGN-HAN). Gói free 250 search/tháng — đếm trong bảng
   `api_usage` (chung DB nên mọi tiến trình không vượt tổng); chạm hạn mức thì
   tự rơi về nguồn 2. Watch trùng chặng+ngày trong cùng 1 vòng canh chỉ tốn 1 search.
2. **Adapter HTTP trực tiếp từng hãng** (`adapters/`) — hiện có **Vietnam
   Airlines** (`vietnamairlines.js`): gọi API public
   `integration-middleware-website.vietnamairlines.com /api/v1/public/booking/air-best-price`
   (~1.5s, không auth, không anti-bot, không tốn quota SerpApi).

> Hạn mức SerpApi khi bật vòng canh tự động: mỗi vòng tốn ~1 search cho mỗi
> chặng+ngày khác nhau. 250 lượt/tháng ⇒ vd 4 chặng khác nhau thì đặt
> `FARE_WATCH_INTERVAL_MIN=720` (2 vòng/ngày ≈ 240 lượt/tháng) là vừa khít.

`adapters/index.js` giữ `AIRLINE_MATCHERS` đủ 5 hãng VN — dùng để khớp tên hãng
Google trả về (vd "Sun PhuQuoc Airways" → `9g`) với ô "Hãng" người dùng nhập tự do.

## Cách chạy

```bash
# 1 vòng rồi thoát (canh hết các watch auto_track còn theo dõi) — hợp cron job
npm run fare-watch

# lặp định kỳ (mặc định mỗi 60 phút, đổi qua FARE_WATCH_INTERVAL_MIN)
npm run fare-watch:loop

# bật loop ngay trong tiến trình app (server.js): đặt env FARE_WATCHER=true
```

Thử nhanh 1 adapter trực tiếp với chặng thật (không đụng DB, không tốn quota):

```bash
node workers/test-adapter.js vn SGN-HAN 2026-07-15
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `SERPAPI_KEY` | _(trống)_ | Bật nguồn SerpApi — trống = chỉ còn adapter trực tiếp (VNA) |
| `SERPAPI_MONTHLY_LIMIT` | `250` | Hạn mức search/tháng theo gói SerpApi; chạm hạn → tự về fallback |
| `FARE_WATCHER` | `false` | Bật loop trong tiến trình app |
| `FARE_WATCH_INTERVAL_MIN` | `60` | Phút giữa các vòng canh |
| `FARE_ALERT_COOLDOWN_H` | `12` | Giờ tối thiểu giữa 2 lần email cảnh báo cùng 1 watch |

Cảnh báo gửi qua email (dùng `config/email.js` — Resend/SMTP đã có sẵn).

## Triển khai

- Web service Render free chạy được trọn bộ: nút "Lấy giá ngay" + "Check vé"
  in-process, vòng canh bằng `FARE_WATCHER=true`. Lưu ý app free **ngủ sau 15
  phút** không có traffic → loop ngừng khi ngủ; muốn canh đều thì dùng **Render
  Cron Job** (rẻ) chạy `npm run fare-watch` theo lịch.

## Bảo trì

- **SerpApi đổi/hết quota:** xem bảng `api_usage` (`SELECT * FROM api_usage`);
  nâng `SERPAPI_MONTHLY_LIMIT` khi đổi gói trả phí.
- **VNA adapter chết:** thường do VNA đổi API hoặc đổi chứng chỉ TLS (server
  VNA gửi thiếu intermediate CA — adapter nhúng sẵn "GlobalSign RSA OV SSL CA
  2018", hết hạn 2028-11; đổi nhà phát hành thì thay cert trong file, xem chú
  thích đầu `adapters/vietnamairlines.js`).
- Cần lại bản scrape Playwright đầy đủ 5 hãng (adapter + recon harness + worker
  uỷ thác VPS)? Tất cả còn nguyên trên nhánh **`master`**.
