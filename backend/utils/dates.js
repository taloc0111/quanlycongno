// utils/dates.js — ngày "hôm nay" theo giờ Việt Nam, KHÔNG phụ thuộc múi giờ máy chủ.
// Server (Render/Neon) chạy UTC: new Date().toISOString() lúc 23:30 VN sẽ ra ngày
// hôm trước. Vì vậy tính từ UTC + TZ_OFFSET_HOURS (mặc định 7).

function offsetHours() {
  const n = Number(process.env.TZ_OFFSET_HOURS);
  return Number.isFinite(n) ? n : 7;
}

/** 'YYYY-MM-DD' của hôm nay theo múi giờ cấu hình. */
function todayLocal(now = Date.now()) {
  return new Date(now + offsetHours() * 3600000).toISOString().slice(0, 10);
}

/** Cộng n ngày vào chuỗi 'YYYY-MM-DD' (tính thuần UTC nên không lệch DST). */
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' của tháng hiện tại theo múi giờ cấu hình. */
function currentMonthLocal(now = Date.now()) {
  return todayLocal(now).slice(0, 7);
}

module.exports = { todayLocal, addDays, currentMonthLocal, offsetHours };
