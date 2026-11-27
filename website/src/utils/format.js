// utils/format.js — định dạng tiền & ngày tiếng Việt + tiện ích ngày KHÔNG lệch múi giờ.
//
// Quy ước: mọi ngày trao đổi với API là chuỗi 'YYYY-MM-DD' (cột DATE Postgres).
// Không dùng `new Date().toISOString()` để lấy "hôm nay" vì nó trả theo UTC —
// trước 7h sáng giờ Việt Nam sẽ ra ngày hôm qua.

export const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
    .format(Number(value) || 0);

export const formatNumber = (value) =>
  new Intl.NumberFormat('vi-VN').format(Number(value) || 0);

/** Viết tắt tiền cho thẻ thống kê: 12.5tr, 1.2tỷ. */
export const formatCompact = (value) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace('.0', '')} tỷ`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1).replace('.0', '')} tr`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)} k`;
  return `${sign}${abs}`;
};

/** Lấy 'YYYY-MM-DD' từ Date theo giờ máy (local). */
export const toYmd = (d) => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Hôm nay dạng 'YYYY-MM-DD' theo giờ máy. */
export const today = () => toYmd(new Date());

/** Cộng/trừ ngày trên chuỗi 'YYYY-MM-DD' (không đụng múi giờ). */
export const addDays = (ymd, n) => {
  const base = ymd ? ymdToDate(ymd) : new Date();
  base.setDate(base.getDate() + n);
  return toYmd(base);
};

/** 'YYYY-MM-DD' → Date lúc 00:00 giờ máy (tránh parse UTC). */
export const ymdToDate = (ymd) => {
  const s = normalizeYmd(ymd);
  if (!s) return new Date(NaN);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Chuẩn hoá mọi kiểu ngày từ API/Excel về 'YYYY-MM-DD' hoặc ''.
 * Nhận: 'YYYY-MM-DD', ISO có 'T' (TIMESTAMPTZ), Date, 'dd/mm/yyyy'.
 */
export const normalizeYmd = (value) => {
  if (!value) return '';
  if (value instanceof Date) return toYmd(value);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    // Giá trị TIMESTAMPTZ: lấy theo giờ máy để hiện đúng ngày người dùng thấy.
    return toYmd(new Date(s));
  }
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
};

/** Hiển thị dd/mm/yyyy. An toàn với 'YYYY-MM-DD', ISO, Date. */
export const formatDate = (value) => {
  const s = normalizeYmd(value);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

/** Hiển thị dd/mm/yyyy HH:MM cho TIMESTAMPTZ. */
export const formatDateTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 'YYYY-MM' của 1 ngày (dùng cho lọc tháng). */
export const monthOf = (value) => normalizeYmd(value).slice(0, 7);

/** 'YYYY-MM' → 'Tháng M/YYYY'. */
export const formatMonth = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `T${Number(m)}/${y}`;
};

/** Số ngày từ hôm nay tới ngày cho trước (âm = đã qua). */
export const daysUntil = (ymd) => {
  const s = normalizeYmd(ymd);
  if (!s) return null;
  const diff = ymdToDate(s).getTime() - ymdToDate(today()).getTime();
  return Math.round(diff / 86400000);
};

/** Ép số từ chuỗi DB ("3000000.00") hoặc input; NaN → 0. */
export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
