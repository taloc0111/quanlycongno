// workers/lib/scrape.js — helper đọc giá từ trang kết quả (dùng chung mọi adapter).
const { parsePriceVnd } = require('./util');

// Gắn listener bắt giá trong các response JSON khớp `bodyRe`.
// Mọi số khớp `priceRe` (group 1) được parse và đẩy vào mảng `sink`.
function sniffJsonPrices(page, { bodyRe, priceRe, sink }) {
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const body = await res.text();
      if (bodyRe && !bodyRe.test(body)) return;
      for (const m of body.matchAll(priceRe)) {
        const p = parsePriceVnd(m[1]);
        if (p) sink.push(p);
      }
    } catch { /* response bị huỷ — bỏ qua */ }
  });
}

// Duyệt lần lượt danh sách selector, đọc innerText, parse giá VND.
// Trả về mảng giá đọc được từ selector ĐẦU TIÊN có dữ liệu.
async function scrapePriceSelectors(page, selectors, max = 40) {
  const out = [];
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const cnt = await loc.count().catch(() => 0);
    if (!cnt) continue;
    for (let i = 0; i < Math.min(cnt, max); i++) {
      const t = await loc.nth(i).innerText().catch(() => '');
      const p = parsePriceVnd(t);
      if (p) out.push(p);
    }
    if (out.length) break;
  }
  return out;
}

module.exports = { sniffJsonPrices, scrapePriceSelectors };
