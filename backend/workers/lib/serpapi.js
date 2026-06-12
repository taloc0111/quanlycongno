// workers/lib/serpapi.js — nguồn giá SerpApi (engine Google Flights).
//
// Nguồn giá CHÍNH: 1 search trả giá của MỌI hãng trên chặng (đã verify 2026-06:
// đủ cả VJ/VN/QH/9G/VU trên SGN-HAN), không cần Chromium. Fallback khi lỗi/hết
// hạn mức: adapter HTTP từng hãng (adapters/ — hiện có VNA).
//
// Hạn mức: gói free 250 search/tháng (50/giờ). Đếm bằng bảng api_usage trong
// Postgres — mọi tiến trình dùng chung DB nên tổng không vượt hạn mức.
// Chạm hạn mức → ném lỗi, caller tự rơi về fallback.
const pool = require('../../config/database');
const { parseRoute, parseDate } = require('./util');
const { resolveKey } = require('../adapters');

const TIMEOUT_MS = parseInt(process.env.SERPAPI_TIMEOUT_MS || '30000', 10);

function enabled() {
  return Boolean(process.env.SERPAPI_KEY);
}

function monthlyLimit() {
  return parseInt(process.env.SERPAPI_MONTHLY_LIMIT || '250', 10);
}

// Trừ 1 lượt trong hạn mức tháng (atomic qua DB, dùng chung mọi tiến trình).
// Trả false khi đã cạn. Đếm TRƯỚC khi gọi nên lỗi mạng vẫn tốn 1 lượt — chấp nhận
// đếm dư cho an toàn (SerpApi chỉ tính search thành công nên số thật <= số đã đếm).
async function tryConsume() {
  const limit = monthlyLimit();
  if (!(limit > 0)) return false;
  const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const { rows } = await pool.query(
    `INSERT INTO api_usage (provider, period, used) VALUES ('serpapi', $1, 1)
     ON CONFLICT (provider, period)
       DO UPDATE SET used = api_usage.used + 1 WHERE api_usage.used < $2
     RETURNING used`,
    [period, limit]
  );
  return rows.length > 0;
}

// 1 search một chiều → mảng hành trình chuẩn hoá, mỗi phần tử:
//   { airline, price, currency, flightNo, departTime, stops }
// `cache` (Map, tuỳ chọn): các lần gọi trùng chặng+ngày trong 1 vòng canh dùng lại
// kết quả — nhiều watch cùng chặng chỉ tốn 1 lượt search.
async function searchRoute({ route, date, pax = 1, cache = null }) {
  const r = parseRoute(route);
  const d = parseDate(date);
  if (!r || !d) throw new Error(`Hành trình/ngày không hợp lệ: route=${route} date=${date}`);

  const cacheKey = `${r.origin}-${r.dest}|${d.iso}`;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

  if (!enabled()) throw new Error('SERPAPI_KEY chưa cấu hình');
  if (!(await tryConsume())) throw new Error(`SerpApi đã hết hạn mức tháng này (${monthlyLimit()} lượt)`);

  const params = new URLSearchParams({
    engine: 'google_flights',
    departure_id: r.origin,
    arrival_id: r.dest,
    outbound_date: d.iso,
    type: '2', // một chiều — Canh vé/Check vé đều so giá 1 chiều
    adults: String(Math.min(Math.max(parseInt(pax, 10) || 1, 1), 9)),
    currency: 'VND',
    hl: 'vi',
    gl: 'vn',
    api_key: process.env.SERPAPI_KEY,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetch(`https://serpapi.com/search?${params}`, { signal: controller.signal });
    data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `SerpApi trả HTTP ${res.status}`);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('SerpApi phản hồi quá lâu (timeout)');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const raw = [...(data.best_flights || []), ...(data.other_flights || [])];
  const itins = raw
    .map((it) => {
      const legs = it.flights || [];
      const first = legs[0] || {};
      const last = legs[legs.length - 1] || {};
      return {
        // chuyến nối chặng lấy hãng của chặng đầu; flightNo nối bằng '+'
        airline: first.airline || null,
        price: Number(it.price) || null,
        currency: 'VND',
        flightNo:
          legs.map((l) => String(l.flight_number || '').replace(/\s+/g, '')).filter(Boolean).join('+').slice(0, 20) || null,
        departTime: first.departure_airport?.time || null,   // 'yyyy-mm-dd HH:MM'
        arriveTime: last.arrival_airport?.time || null,
        durationMin: Number(it.total_duration) || null,
        stops: Math.max(legs.length - 1, 0),
      };
    })
    .filter((i) => i.airline && i.price > 0);

  if (cache) cache.set(cacheKey, itins);
  return itins;
}

// Tên hãng tự do → key chuẩn (vj/vn/qh/9g/vu); null nếu ngoài 5 hãng VN.
function keyOf(name) {
  return resolveKey(name);
}

// Hành trình rẻ nhất của 1 hãng (khớp theo khoá adapter, fallback so chuỗi 2 chiều).
// Không truyền hãng → rẻ nhất toàn chặng (mọi hãng) — watch không ghi hãng vẫn canh được.
function lowestForAirline(itins, airline) {
  let pick = itins;
  if (airline) {
    const wKey = keyOf(airline);
    const w = String(airline).toLowerCase().trim();
    pick = itins.filter((i) => {
      const iKey = keyOf(i.airline);
      if (wKey && iKey) return wKey === iKey;
      const a = String(i.airline).toLowerCase();
      return a.includes(w) || w.includes(a);
    });
  }
  if (!pick.length) return null;
  return pick.reduce((min, i) => (i.price < min.price ? i : min));
}

// Gom theo hãng → mỗi hãng 1 dòng: giá rẻ nhất + DANH SÁCH CHUYẾN (khung giờ,
// sắp theo giờ cất cánh). Mảng hãng sắp theo giá tăng dần. Shape khớp kết quả
// quoteAllAirlines (Check vé): { key, airline, ok, price, currency, flights[] }.
function quoteByAirline(itins) {
  const byAirline = new Map();
  for (const i of itins) {
    const list = byAirline.get(i.airline) || [];
    list.push(i);
    byAirline.set(i.airline, list);
  }
  return [...byAirline.entries()]
    .map(([airline, list]) => {
      const cheapest = list.reduce((min, i) => (i.price < min.price ? i : min));
      const flights = [...list]
        .sort((a, b) => String(a.departTime || '').localeCompare(String(b.departTime || '')))
        .map(({ flightNo, departTime, arriveTime, durationMin, stops, price }) => ({
          flightNo, departTime, arriveTime, durationMin, stops, price,
        }));
      return {
        key: keyOf(airline) || airline.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        airline,
        ok: true,
        price: cheapest.price,
        currency: cheapest.currency,
        flightNo: cheapest.flightNo,
        departTime: cheapest.departTime,
        source: 'serpapi',
        flights,
      };
    })
    .sort((a, b) => a.price - b.price);
}

module.exports = { enabled, searchRoute, lowestForAirline, quoteByAirline };
