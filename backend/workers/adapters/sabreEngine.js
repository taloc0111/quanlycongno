// workers/adapters/sabreEngine.js
// Adapter dùng chung cho 2 hãng chạy CÙNG MỘT booking engine (phát hiện khi recon):
//   - Bamboo Airways  (QH) → digital.bambooairways.com
//   - Sun PhuQuoc     (9G) → fly.sunphuquocairways.com
// Cả hai có cấu trúc /{code}/statics/booking/content/... và API api-des.{domain}.
//
// Chiến lược: KHÔNG gọi thẳng API (bị anti-bot chặn) — ta điều khiển UI:
//   mở engine với deep-link tìm chuyến → đợi danh sách chuyến render →
//   đọc tất cả giá hiển thị trên DOM → lấy giá thấp nhất.
//
// Selector ở đây là điểm DỄ VỠ nhất (engine đổi markup là phải sửa). Đã gom hết
// vào hằng SELECTORS bên dưới để chỉ sửa 1 chỗ. Dùng workers/recon-search.js để
// chụp lại results.html khi cần dò selector mới.
const { parseRoute, parseDate, minPrice } = require('../lib/util');
const { sniffJsonPrices, scrapePriceSelectors } = require('../lib/scrape');

// Các selector "ứng viên" — thử lần lượt, cái nào có phần tử thì dùng.
const FARE_SELECTORS = [
  '[class*="fare-price"]',
  '[class*="price-amount"]',
  '[class*="lowest-fare"]',
  '[data-test*="fare"] [class*="price"]',
  '.journey-price, .flight-price, .fare-amount',
];

// Build deep-link tìm chuyến 1 chiều. Tham số đặt theo dạng phổ biến của engine này;
// nếu engine bỏ qua param lạ nó vẫn về trang search để ta điền tay (fallback).
function buildSearchUrl(baseUrl, { origin, dest, date, pax }) {
  const qs = new URLSearchParams({
    culture: 'vi-VN',
    activeMonth: date.iso,
    'journeys[0].origin': origin,
    'journeys[0].destination': dest,
    'journeys[0].date': date.iso,
    adultCount: String(pax || 1),
  });
  return `${baseUrl}/select?${qs.toString()}`;
}

function makeSabreAdapter({ key, baseUrl, label }) {
  return {
    key,
    label,
    async getLowestFare({ route, date, pax, ctx, log = () => {} }) {
      const r = parseRoute(route);
      const d = parseDate(date);
      if (!r || !d) throw new Error(`Hành trình/ngày không hợp lệ: route=${route} date=${date}`);

      const page = await ctx.newPage();
      const prices = [];
      try {
        // Bắt thêm giá từ XHR availability (nếu engine trả JSON ta đọc được).
        sniffJsonPrices(page, {
          bodyRe: /journey|fare|availab/i,
          priceRe: /"(?:amount|totalAmount|fareAmount|adultFare)"\s*:\s*"?([\d.,]+)"?/gi,
          sink: prices,
        });

        const url = buildSearchUrl(baseUrl, { origin: r.origin, dest: r.dest, date: d, pax });
        log(`${key}: GET ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Đợi engine render danh sách chuyến (hoặc XHR avail về).
        await page.waitForTimeout(12000);
        prices.push(...(await scrapePriceSelectors(page, FARE_SELECTORS, 30)));

        const price = minPrice(prices);
        if (!price) throw new Error('Không đọc được giá nào (anti-bot hoặc selector đã đổi)');
        return { price, currency: 'VND', source: key, flightNo: null, departTime: null };
      } finally {
        await page.close().catch(() => {});
      }
    },
  };
}

module.exports = { makeSabreAdapter };
