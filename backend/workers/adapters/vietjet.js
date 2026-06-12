// workers/adapters/vietjet.js — VietJet Air (VJ).
// Site www.vietjetair.com (React MUI + AWS WAF). Luồng đã verify (2026-06):
//   /vi → radio "Một chiều" (input[value=oneway]) → gõ mã vào ô điểm đi (input MUI
//   đầu tiên) → chọn hàng gợi ý div:text-is(mã) trong MuiExpansionPanelDetails →
//   focus tự nhảy sang #arrivalPlaceDesktop, làm tương tự → lịch react-date-range
//   (rdrDay) tự mở, click ngày trong khối tháng đúng header "tháng MM yyyy" →
//   nút "Tìm chuyến bay" (phải check elementFromPoint vì có nút trùng bị che) →
//   điều hướng SPA sang /vi/select-flight.
// Giá lấy từ XHR /booking/api/v1/search-flight (lọc đúng departureDate, charge FA,
// baseAmount VND = đúng số site hiển thị); DOM chỉ là fallback vì giá bị tách
// "1.010" + "000 VND" ở 2 thẻ p (h4 + body1) trong cùng 1 div.
const { parseRoute, parseDate, minPrice, parsePriceVnd } = require('../lib/util');

const HOME = 'https://www.vietjetair.com/vi';
const SEARCH_API = '/booking/api/v1/search-flight';
// Ô giá 1 chuyến/hạng vé trên /select-flight: div bọc <p h4>2.490</p><p body1>000 VND</p>.
// innerText cả div = "2.490\n000 VND" → parsePriceVnd ra 2490000.
// (KHÔNG dùng MuiTypography-subtitle1 — đó là dải "Từ ..." của các ngày lân cận.)
const FARE_SELECTORS = [
  'div:has(> p[class*="MuiTypography-h4"] + p[class*="MuiTypography-body1"])',
];

// Bóc giá vé người lớn (charge FA) của các journey đúng ngày từ JSON search-flight.
// Trả mảng { price, flightNo, departTime }.
function faresFromSearchJson(body, isoDate) {
  const out = [];
  let data;
  try { data = JSON.parse(body); } catch { return out; }
  for (const journeys of Object.values(data?.travelOption || {})) {
    if (!Array.isArray(journeys)) continue;
    for (const j of journeys) {
      if (j?.departureDate !== isoDate) continue; // response kèm cả ngày lân cận (dải giá)
      const f0 = j.flights?.[0] || {};
      for (const fo of j.fareOptions || []) {
        if (fo?.noFare) continue; // hết chỗ
        for (const ch of fo.fareCharges || []) {
          if (ch?.chargeType?.code !== 'FA') continue; // FA = giá vé, còn lại là phụ phí
          for (const ca of ch.currencyAmounts || []) {
            if (ca?.currency?.code && ca.currency.code !== 'VND') continue;
            const p = Number(ca?.baseAmount);
            if (Number.isFinite(p) && p >= 50000) {
              out.push({
                price: p,
                flightNo: f0.airlineCode?.code && f0.flightNumber ? `${f0.airlineCode.code}${f0.flightNumber}` : null,
                departTime: f0.departure?.localScheduledTime || null,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

module.exports = {
  key: 'vj',
  label: 'VietJet',
  async getLowestFare({ route, date, pax, ctx, log = () => {} }) {
    const r = parseRoute(route);
    const d = parseDate(date);
    if (!r || !d) throw new Error(`Hành trình/ngày không hợp lệ: route=${route} date=${date}`);

    const page = await ctx.newPage();
    const fares = []; // {price, flightNo, departTime} từ XHR search-flight
    try {
      page.on('response', async (res) => {
        try {
          if (!res.url().includes(SEARCH_API)) return;
          fares.push(...faresFromSearchJson(await res.text(), d.iso));
        } catch { /* response bị huỷ — bỏ qua */ }
      });

      log(`vj: open ${HOME}`);
      await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);

      // Cookie bar + popup khuyến mãi.
      for (const sel of ['button:has-text("Đồng ý")', 'button:has-text("Tôi đã hiểu")']) {
        const b = page.locator(sel).first();
        if (await b.count().catch(() => 0)) await b.click({ timeout: 2000 }).catch(() => {});
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(600);

      await page.locator('input[value="oneway"]').first().click({ timeout: 3000, force: true }).catch(() => {});
      await page.waitForTimeout(800);

      // Chọn sân bay: gõ mã → hàng gợi ý hiện trong panel xổ xuống.
      const pickAirport = async (code) => {
        for (const sel of [
          `div[class*="MuiExpansionPanelDetails"] div:text-is("${code}")`,
          `div[class*="MuiExpansionPanelDetails"] div[class*="MuiBox-root"]:has-text("${code}")`,
        ]) {
          const el = page.locator(sel).first();
          if (await el.count().catch(() => 0)) {
            if (await el.click({ timeout: 3000 }).then(() => true).catch(() => false)) return true;
          }
        }
        return false;
      };

      log(`vj: điểm đi ${r.origin}`);
      const origin = page.locator('input.MuiInputBase-input.MuiOutlinedInput-input').first();
      await origin.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await origin.type(r.origin, { delay: 130 }).catch(() => {});
      await page.waitForTimeout(2200);
      if (!await pickAirport(r.origin)) throw new Error(`Không chọn được điểm đi ${r.origin}`);
      await page.waitForTimeout(1200);

      // Sau khi chọn điểm đi, focus tự chuyển sang ô điểm đến.
      log(`vj: điểm đến ${r.dest}`);
      const dest = page.locator('#arrivalPlaceDesktop');
      if ((await page.evaluate(() => document.activeElement?.id).catch(() => '')) !== 'arrivalPlaceDesktop') {
        await dest.click({ timeout: 3000, force: true }).catch(() => {});
        await page.waitForTimeout(800);
      }
      await page.keyboard.type(r.dest, { delay: 130 }).catch(() => {});
      await page.waitForTimeout(2200);
      if (!await pickAirport(r.dest)) throw new Error(`Không chọn được điểm đến ${r.dest}`);
      await page.waitForTimeout(1500);

      // Lịch react-date-range (2 tháng) tự mở. Click ngày trong khối tháng đúng header;
      // chưa thấy tháng thì bấm mũi tên sang tháng kế (rdrNext*).
      log(`vj: chọn ngày ${d.iso}`);
      const clickDay = async () => {
        const pt = await page.evaluate(({ month, year, day }) => {
          const re = new RegExp(`tháng\\s*0?${month}\\s*${year}`, 'i');
          const heads = [...document.querySelectorAll('*')]
            .filter((e) => e.children.length === 0 && re.test((e.textContent || '').trim()));
          for (const h of heads) {
            let p = h.parentElement;
            for (let up = 0; up < 8 && p; up++, p = p.parentElement) {
              const btns = [...p.querySelectorAll('button.rdrDay')];
              if (btns.length >= 25 && btns.length <= 45) {
                const b = btns.find((x) => (x.textContent || '').trim() === String(day) && !x.disabled);
                if (b) { const r2 = b.getBoundingClientRect(); return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 }; }
              }
            }
          }
          return null;
        }, { month: d.month, year: d.year, day: d.day }).catch(() => null);
        if (!pt) return false;
        await page.mouse.click(pt.x, pt.y);
        return true;
      };
      // CHÚ Ý: phải là .rdrNextButton — [class*="rdrNext"] dính cả nút LÙI
      // (cả 2 nút đều mang class rdrNextPrevButton).
      let dayOk = false;
      for (let i = 0; i < 12 && !(dayOk = await clickDay()); i++) {
        const next = page.locator('button.rdrNextButton').first();
        if (!(await next.count().catch(() => 0))) break;
        await next.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(450);
      }
      if (!dayOk) throw new Error(`Không chọn được ngày ${d.iso} trên lịch VietJet`);
      await page.waitForTimeout(1500);

      // Đóng panel hành khách đang mở rồi bấm nút "Tìm chuyến bay" THẬT
      // (trang có nút trùng text bị che — phải kiểm tra elementFromPoint).
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
      const sbPt = await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          if (!/tìm chuyến bay/i.test((b.textContent || '').trim())) continue;
          const r2 = b.getBoundingClientRect();
          const x = r2.x + r2.width / 2, y = r2.y + r2.height / 2;
          const top = document.elementFromPoint(x, y);
          if (r2.width > 50 && top && (top === b || b.contains(top) || top.contains(b))) return { x, y };
        }
        return null;
      }).catch(() => null);
      if (!sbPt) throw new Error('Không thấy nút "Tìm chuyến bay"');
      log('vj: tìm chuyến');
      await page.mouse.click(sbPt.x, sbPt.y);

      // SPA chuyển sang /select-flight rồi gọi search-flight (nhiều lần, kèm ngày lân cận).
      await page.waitForURL(/select-flight/, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(20000);

      // Fallback DOM nếu XHR không bắt được gì.
      if (!fares.length) {
        const loc = page.locator(FARE_SELECTORS[0]);
        const cnt = await loc.count().catch(() => 0);
        for (let i = 0; i < Math.min(cnt, 40); i++) {
          const p = parsePriceVnd(await loc.nth(i).innerText().catch(() => ''));
          if (p) fares.push({ price: p, flightNo: null, departTime: null });
        }
      }

      const price = minPrice(fares.map((f) => f.price));
      if (!price) throw new Error('Không đọc được giá VietJet (anti-bot hoặc selector đã đổi)');
      const best = fares.find((f) => f.price === price) || {};
      return { price, currency: 'VND', source: 'vj', flightNo: best.flightNo || null, departTime: best.departTime || null };
    } finally {
      await page.close().catch(() => {});
    }
  },
};
