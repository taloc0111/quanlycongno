// workers/lib/browser.js — khởi tạo Chromium "tàng hình" dùng chung cho mọi adapter.
// Mục tiêu: trông giống trình duyệt thật để qua các lớp anti-bot cơ bản
// (che navigator.webdriver, set locale/timezone/UA VN, viewport thật).
//
// CHÚ Ý: đây là chống bot cơ bản. Các site có Akamai/PerimeterX có thể vẫn chặn —
// khi đó adapter sẽ trả lỗi và worker ghi nhận, không làm sập tiến trình.
let _chromium = null;
function getChromium() {
  if (!_chromium) {
    // require trễ để server vẫn chạy được khi chưa cài playwright (tính năng tắt).
    _chromium = require('playwright').chromium;
  }
  return _chromium;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function launchBrowser({ headless = true } = {}) {
  const chromium = getChromium();
  return chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage', // ổn định trên container RAM thấp (Render free)
    ],
  });
}

async function newStealthContext(browser) {
  const ctx = await browser.newContext({
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1366, height: 900 },
    userAgent: UA,
    extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
  });
  // Xoá vài dấu hiệu automation phổ biến trước khi trang chạy script.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    window.chrome = window.chrome || { runtime: {} };
  });
  ctx.setDefaultTimeout(30000);
  return ctx;
}

module.exports = { launchBrowser, newStealthContext, getChromium };
