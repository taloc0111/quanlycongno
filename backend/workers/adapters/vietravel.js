// workers/adapters/vietravel.js — Vietravel Airlines (VU).
// Engine đặt vé: booking.vietravelairlines.com (Vue SPA). Luồng đã verify (2026-06):
//   /vi → chọn "Một chiều" (#search-type-oneway) → gõ mã sân bay vào ô điểm đi/đến
//   (placeholder "Chọn điểm đi/đến") rồi chọn gợi ý chứa mã → mở lịch bằng nút phủ
//   #input-cover-button-0 (lịch vue-airbnb-style-datepicker, class asd__*) → chọn ngày
//   qua [data-date="yyyy-mm-dd"] → bấm #criteria-search-button → trang /select.
//   Giá hiển thị ở ô .price.large-currency (mỗi chuyến/hạng vé) dạng "VND 1,688,000.00".
const { parseRoute, parseDate, minPrice } = require('../lib/util');
const { sniffJsonPrices, scrapePriceSelectors } = require('../lib/scrape');

const HOME = 'https://booking.vietravelairlines.com/vi';
// Ô giá vé trên trang /select. '.price.large-currency' = giá từng chuyến/hạng cho ngày
// đã chọn; 'strong.price' (tab theo ngày) là fallback nếu markup đổi.
const FARE_SELECTORS = [
  '.price.large-currency',
  '[class*="price"][class*="large-currency"]',
  'strong.price',
];

module.exports = {
  key: 'vu',
  label: 'Vietravel',
  async getLowestFare({ route, date, pax, ctx, log = () => {} }) {
    const r = parseRoute(route);
    const d = parseDate(date);
    if (!r || !d) throw new Error(`Hành trình/ngày không hợp lệ: route=${route} date=${date}`);

    const page = await ctx.newPage();
    const prices = [];
    try {
      // Bắt thêm giá từ XHR availability nếu có (đề phòng selector DOM đổi).
      sniffJsonPrices(page, {
        bodyRe: /journey|fare|availab|price/i,
        priceRe: /"(?:amount|totalAmount|fareAmount|adultFare|price)"\s*:\s*"?([\d.,]+)"?/gi,
        sink: prices,
      });

      log(`vu: open ${HOME}`);
      await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);

      // Một chiều cho đơn giản.
      const oneway = page.locator('#search-type-oneway');
      if (await oneway.count().catch(() => 0)) await oneway.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);

      // Điền điểm đi/đến: gõ mã rồi chọn dòng gợi ý chứa đúng mã IATA.
      const fill = async (placeholders, code) => {
        for (const ph of placeholders) {
          const el = page.locator(`input[placeholder*="${ph}" i]`).first();
          if (await el.count().catch(() => 0)) {
            await el.click({ timeout: 4000 }).catch(() => {});
            await el.fill('').catch(() => {});
            await el.type(code, { delay: 120 }).catch(() => {});
            await page.waitForTimeout(2500);
            const opt = page.locator(`li:has-text("${code}"), [role="option"]:has-text("${code}")`).first();
            if (await opt.count().catch(() => 0)) await opt.click({ timeout: 3000 }).catch(() => {});
            return;
          }
        }
      };
      await fill(['Chọn điểm đi', 'điểm đi'], r.origin);
      await fill(['Chọn điểm đến', 'điểm đến'], r.dest);
      await page.waitForTimeout(1200);

      // Ngày bay: ô #criteria-dates-0 bị nút phủ #input-cover-button-0 chặn click —
      // bấm nút phủ để mở lịch (asd), rồi chọn ô [data-date="yyyy-mm-dd"];
      // nếu chưa thấy thì bấm "tháng sau" (.asd__change-month-button--next).
      const cover = page.locator('#input-cover-button-0');
      if (await cover.count().catch(() => 0)) {
        await cover.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1200);
        for (let i = 0; i < 14; i++) {
          const cell = page.locator(`[data-date="${d.iso}"]`).first();
          if (await cell.count().catch(() => 0)) { await cell.click({ timeout: 3000 }).catch(() => {}); break; }
          const next = page.locator('.asd__change-month-button--next button, [aria-label="next month"]').first();
          if (!(await next.count().catch(() => 0))) break;
          await next.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(350);
        }
        await page.waitForTimeout(700);
      }

      const searchBtn = page.locator('#criteria-search-button, button:has-text("Tìm chuyến bay")').first();
      if (await searchBtn.count().catch(() => 0)) await searchBtn.click({ timeout: 4000 }).catch(() => {});

      // Đợi trang /select render danh sách chuyến + giá.
      await page.waitForURL(/\/select/, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(8000);
      prices.push(...(await scrapePriceSelectors(page, FARE_SELECTORS)));

      const price = minPrice(prices);
      if (!price) throw new Error('Không đọc được giá Vietravel (anti-bot hoặc selector đã đổi)');
      return { price, currency: 'VND', source: 'vu', flightNo: null, departTime: null };
    } finally {
      await page.close().catch(() => {});
    }
  },
};
