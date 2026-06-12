# Worker canh giá vé (fare watcher)

Tự động lấy giá vé và cảnh báo khi giá ≤ giá mong muốn của yêu cầu "Canh vé".
Hai nguồn giá, ưu tiên theo thứ tự:

1. **SerpApi (Google Flights)** — bật bằng `SERPAPI_KEY` (`lib/serpapi.js`).
   1 search trả giá **mọi hãng** trên chặng (đã verify 2026-06: đủ cả
   VJ/VN/QH/9G/VU trên SGN-HAN), không cần Chromium nên chạy được ngay trên web
   service. Gói free 250 search/tháng — đếm trong bảng `api_usage` (chung DB nên
   web + worker không vượt tổng); chạm hạn mức thì tự rơi về nguồn 2.
   Watch trùng chặng+ngày trong cùng 1 vòng canh chỉ tốn 1 search.
2. **Scrape site hãng** (Playwright + Chromium stealth) — đọc giá hiển thị trên
   trang từng hãng. Dùng khi không có key hoặc SerpApi lỗi/hết hạn mức.

> Lưu ý hạn mức khi bật vòng canh tự động: mỗi vòng tốn ~1 search cho mỗi
> chặng+ngày khác nhau. 250 lượt/tháng ⇒ vd 4 chặng khác nhau thì đặt
> `FARE_WATCH_INTERVAL_MIN=720` (2 vòng/ngày ≈ 240 lượt/tháng) là vừa khít.

## Hãng hỗ trợ

| Mã | Hãng | Engine | Adapter |
|----|------|--------|---------|
| vj | VietJet | riêng | `adapters/vietjet.js` |
| vn | Vietnam Airlines | API middleware public (HTTP thuần, không Chromium) | `adapters/vietnamairlines.js` |
| qh | Bamboo Airways | (chung với 9G) | `adapters/sabreEngine.js` |
| 9g | Sun PhuQuoc Airways | (chung với QH) | `adapters/sabreEngine.js` |
| vu | Vietravel | Radixx (Vue SPA) | `adapters/vietravel.js` |

> Bamboo và Sun PhuQuoc chạy **cùng một engine** (`/{code}/statics/booking/...`,
> `api-des.{domain}`) nên dùng chung 1 adapter (`makeSabreAdapter`).

## Cách chạy

```bash
# 1 vòng rồi thoát (canh hết các watch auto_track còn theo dõi)
npm run fare-watch

# lặp định kỳ (mặc định mỗi 60 phút, đổi qua FARE_WATCH_INTERVAL_MIN)
npm run fare-watch:loop

# bật loop ngay trong tiến trình app (server.js): đặt env FARE_WATCHER=true
```

Thử nhanh 1 adapter với chặng thật (không đụng DB):

```bash
node workers/test-adapter.js vu SGN-HAN 2026-07-15
node workers/test-adapter.js vn HAN-SGN 2026-08-01 2
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `FARE_WATCHER` | `false` | Bật loop trong tiến trình app |
| `FARE_WATCH_INTERVAL_MIN` | `60` | Phút giữa các vòng canh |
| `FARE_ALERT_COOLDOWN_H` | `12` | Giờ tối thiểu giữa 2 lần email cảnh báo cùng 1 watch |
| `SERPAPI_KEY` | _(trống)_ | Bật nguồn SerpApi (Google Flights) — trống = chỉ scrape |
| `SERPAPI_MONTHLY_LIMIT` | `250` | Hạn mức search/tháng theo gói SerpApi; chạm hạn → tự về scrape |

Cảnh báo gửi qua email (dùng `config/email.js` — Resend/SMTP đã có sẵn).

## Triển khai

- Playwright để ở `devDependencies` → bản deploy production (`npm i --production`)
  **không** cài, nên tính năng tự tắt an toàn (endpoint `check-now` trả 503,
  loop không bật). Muốn bật trên server: chuyển `playwright` sang `dependencies`,
  chạy `npx playwright install chromium`, rồi đặt `FARE_WATCHER=true`.
- Render free RAM thấp + ngủ sau 15 phút → **nên chạy worker ở máy/VPS riêng**
  (cùng `DATABASE_URL`) thay vì nhồi vào web service.

## Bảo trì — khi 1 hãng "lăn ra chết"

Triệu chứng: cột `last_check_ok = false`, `last_error` kiểu "Không đọc được giá…".
Nguyên nhân hầu như luôn là **hãng đổi markup** (selector cũ không còn khớp) hoặc
anti-bot siết hơn. Cách dò lại selector:

```bash
# chụp trang chủ + mọi XHR JSON có chứa giá
node workers/recon.js <tên> <url> [waitMs]

# điều khiển luồng tìm chuyến rồi chụp trang KẾT QUẢ + screenshot
node workers/recon-search.js <tên> <homeUrl> SGN HAN 2026-07-15
```

Kết quả ghi vào `workers/recon-out/<tên>/` (đã gitignore):
`dom.html`, `results.html`, `screenshot.png`, `xhr-*.json`, `avail-*.json`.

Mở `results.html`/`screenshot.png`, tìm phần tử chứa giá (có "₫"), lấy class/selector
rồi cập nhật mảng `FARE_SELECTORS` trong adapter tương ứng. Mỗi adapter gom hết
selector dễ vỡ vào 1 chỗ để chỉ sửa 1 nơi.

## Trạng thái selector từng hãng (2026-06-12)

Khung + pipeline (snapshot → cảnh báo → UI → uỷ thác worker) đã hoàn chỉnh.
Tình trạng đọc giá thực tế của từng adapter:

| Hãng | Adapter | Trạng thái | Ghi chú |
|------|---------|-----------|---------|
| **Vietravel (vu)** | `vietravel.js` | ✅ **CHẠY** — ra giá thật | Đã verify `test-adapter.js vu SGN-HAN`: 1.688.000đ. Form id ổn định, lịch `asd__*` chọn theo `data-date`, giá ở `.price.large-currency`. |
| Bamboo (qh) | `sabreEngine.js` | ⚠️ chưa | Autocomplete sân bay (Amadeus/Liferay, item `.loca-code`) KHÔNG commit mã khi chọn bằng click/bàn phím tự động → form không submit. Cần cách kích hoạt handler khác (đã thử 14 cách). |
| Sun PhuQuoc (9g) | `sabreEngine.js` | ⚠️ chưa | Cùng booking engine với QH nhưng marketing site (Next.js) khác → cần dò luồng riêng. |
| **VietJet (vj)** | `vietjet.js` | ✅ **CHẠY** — ra giá thật | Anti-bot là AWS WAF (không phải Akamai) — Chromium stealth qua được. UI MUI: chọn sân bay qua `div:text-is(mã)` trong `MuiExpansionPanelDetails` (focus tự nhảy đi→đến), lịch react-date-range (`.rdrDay`, lật tháng bằng `.rdrNextButton` — đừng dùng `[class*="rdrNext"]`, dính nút lùi), nút "Tìm chuyến bay" phải check `elementFromPoint` vì có nút trùng bị che. Giá đọc từ XHR `/booking/api/v1/search-flight`: lọc journey đúng `departureDate` (response kèm ngày lân cận), charge `FA`, `baseAmount` VND = đúng số site hiển thị; kèm flightNo + giờ bay. Fallback DOM: div bọc `p.MuiTypography-h4` ("1.010") + `p.MuiTypography-body1` ("000 VND"). Verify: SGN-HAN 15/7 = 1.010.000đ, HAN-DAD 20/8 = 1.120.000đ (~48s/lần). Dò lại: `node workers/scratch-vj.js`. |
| **Vietnam Airlines (vn)** | `vietnamairlines.js` | ✅ **CHẠY** — ra giá thật | KHÔNG scrape DOM — gọi thẳng API public `integration-middleware-website.vietnamairlines.com /api/v1/public/booking/air-best-price` (~1.5s, không cần Chromium). Bỏ `tripDuration` trong body = giá MỘT CHIỀU đã thuế. Server thiếu intermediate CA → adapter nhúng GlobalSign RSA OV SSL CA 2018 (hạn 2028-11). Verify: SGN-HAN 15/7 = 1.551.000đ, HAN-PQC 2/8 = 2.556.000đ. Dò lại: `node workers/probe-vn.js`. |

**Tiện ích đã có để dò tiếp:** `parsePriceVnd` xử lý đúng cả "VND 1,688,000.00" lẫn
"1.234.567 ₫". `cityOf(code)` / `AIRPORT_VI` (lib/util.js) — map mã IATA → tên thành
phố tiếng Việt, dùng khi ô autocomplete chỉ hiện gợi ý lúc gõ TÊN (như Bamboo).

**Bài học khi tinh chỉnh:** dùng **click thật của Playwright** (sự kiện tin cậy), tránh
`element.click()` trong `page.evaluate` (nhiều widget không nhận). Với autocomplete khó
như Bamboo, kiểm tra ô HIDDEN code (vd `#from-location-code`) đã đổi chưa — input text
đổi không có nghĩa là đã chọn hợp lệ.
