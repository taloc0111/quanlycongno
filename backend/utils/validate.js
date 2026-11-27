// utils/validate.js — bộ kiểm tra dữ liệu đầu vào tối giản cho controller.
// Mọi helper ném ValidationError (status 400, thông báo tiếng Việt) khi sai;
// error handler toàn cục trong app.js đổi lỗi này thành HTTP 400.
//
// Quy ước chung:
//   - undefined / null / '' (chuỗi trắng) = "bỏ trống" → trả null (hoặc 400 nếu required).
//   - Số/ngày nhận cả chuỗi lẫn số; '' được đổi thành null để ghi NULL vào DB.

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Số thực. Trả null nếu bỏ trống (trừ khi required).
 * @param {*} v
 * @param {{min?:number,max?:number,required?:boolean,label?:string}} opts
 */
function num(v, { min, max, required = false, label = 'Giá trị' } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`${label} là bắt buộc`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new ValidationError(`${label} không hợp lệ`);
  if (min !== undefined && n < min) throw new ValidationError(`${label} phải ≥ ${min}`);
  if (max !== undefined && n > max) throw new ValidationError(`${label} phải ≤ ${max}`);
  return n;
}

/** Số nguyên (id, số khách...). Trả null nếu bỏ trống. */
function int(v, { min, max, required = false, label = 'Giá trị' } = {}) {
  const n = num(v, { min, max, required, label });
  if (n === null) return null;
  if (!Number.isInteger(n)) throw new ValidationError(`${label} phải là số nguyên`);
  return n;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/** Ngày dạng 'YYYY-MM-DD' (chấp nhận ISO đầy đủ, chỉ lấy phần ngày). Trả null nếu bỏ trống. */
function dateStr(v, { required = false, label = 'Ngày' } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`${label} là bắt buộc`);
    return null;
  }
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  const m = s.match(DATE_RE);
  if (!m) throw new ValidationError(`${label} sai định dạng (yyyy-mm-dd)`);
  const [, y, mo, d] = m;
  const check = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) {
    throw new ValidationError(`${label} không tồn tại`);
  }
  return `${y}-${mo}-${d}`;
}

/** Chuỗi (trim). Trả null nếu bỏ trống và không required. Giới hạn độ dài theo cột VARCHAR. */
function str(v, { max, required = false, label = 'Giá trị', trim = true } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`${label} là bắt buộc`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError(`${label} không hợp lệ`);
  const s = trim ? String(v).trim() : String(v);
  if (max !== undefined && s.length > max) throw new ValidationError(`${label} tối đa ${max} ký tự`);
  return s;
}

/** Một trong các giá trị cho phép. Bỏ trống → fallback (mặc định null). */
function oneOf(v, allowed, { required = false, label = 'Giá trị', fallback = null } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`${label} là bắt buộc`);
    return fallback;
  }
  if (!allowed.includes(v)) throw new ValidationError(`${label} không hợp lệ (${allowed.join(' | ')})`);
  return v;
}

/** Boolean từ form (true/false/'true'/'false'/1/0). Bỏ trống → null. */
function bool(v, { label = 'Giá trị' } = {}) {
  if (v === undefined || v === null || v === '') return null;
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  throw new ValidationError(`${label} phải là true/false`);
}

/** Số tiền: số thực ≥ 0 (không nhận âm). */
function amount(v, { required = false, label = 'Số tiền' } = {}) {
  return num(v, { min: 0, required, label });
}

/** id trên URL (:id) — phải là số nguyên dương, sai thì 400 thay vì 500 từ Postgres. */
function idParam(v, label = 'ID') {
  const n = int(v, { min: 1, required: true, label });
  return n;
}

module.exports = { ValidationError, isBlank, num, int, dateStr, str, oneOf, bool, amount, idParam };
