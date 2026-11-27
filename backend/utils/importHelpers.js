// utils/importHelpers.js — Hàm dùng chung cho việc import dữ liệu từ Excel/CSV.

/**
 * Chuyển chuỗi tiền tệ về số. Chấp nhận "1.000.000", "1,000,000", "1000000 đ".
 * @returns {number} NaN nếu không hợp lệ.
 */
function parseAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  // Bỏ mọi ký tự không phải số/dấu trừ/chấm; loại dấu phân cách nghìn.
  const cleaned = String(value).replace(/[^\d.,-]/g, '').replace(/(\d)[.,](?=\d{3}\b)/g, '$1');
  const normalized = cleaned.replace(/,/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Chuẩn hoá ngày về 'YYYY-MM-DD'. Chấp nhận Date, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd.
 * @returns {string|null} null nếu rỗng hoặc không nhận dạng được.
 */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Lấy thành phần LOCAL (ngày Excel đọc ra là 00:00 giờ máy) — toISOString() (UTC)
    // sẽ lùi 1 ngày ở múi giờ dương.
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = String(value).trim();

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return validYmd(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return validYmd(s.slice(0, 10));

  return undefined; // undefined = có nhập nhưng sai định dạng (phân biệt với null = bỏ trống)
}

// 'YYYY-MM-DD' phải là ngày có thật (31/02, 99/99 → undefined) để không văng lỗi từ Postgres.
function validYmd(ymd) {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return ok ? ymd : undefined;
}

/**
 * Tìm hoặc tạo khách hàng trong 1 transaction. Trả về customer_id (hoặc null nếu thiếu tên).
 * Định danh = (tên + SĐT): chỉ gộp khi CÙNG tên VÀ cùng SĐT. Tên khác = khách khác.
 */
async function upsertCustomer(client, userId, { name, phone, email, address, type } = {}) {
  const cleanName = (name || '').toString().trim();
  if (!cleanName) return null;
  const cleanPhone = phone ? String(phone).trim() : null;

  const found = cleanPhone
    ? await client.query(
        'SELECT id FROM customers WHERE user_id = $1 AND name = $2 AND phone = $3 LIMIT 1',
        [userId, cleanName, cleanPhone]
      )
    : await client.query(
        'SELECT id FROM customers WHERE user_id = $1 AND name = $2 AND phone IS NULL LIMIT 1',
        [userId, cleanName]
      );
  if (found.rows[0]) return found.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO customers (user_id, name, phone, email, address, type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, cleanName, cleanPhone, email || null, address || null, type || 'individual']
  );
  return inserted.rows[0].id;
}

module.exports = { parseAmount, parseDate, upsertCustomer };
