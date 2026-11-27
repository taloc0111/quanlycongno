// utils/ownership.js — kiểm tra bản ghi có thuộc về user hay không (chống IDOR).
// Dùng khi body gửi lên 1 id tham chiếu (companyId, customerId, debtId…):
// id phải tồn tại VÀ user_id = người đang ghi, nếu không → controller trả 400.

// Chỉ cho phép các bảng có cột user_id — tên bảng ghép thẳng vào SQL nên phải whitelist.
const TABLES = new Set([
  'companies', 'customers', 'debts', 'passports', 'train_tickets', 'tours', 'invoices', 'ticket_watches',
  'money_accounts', 'suppliers', 'cost_items',
]);

/**
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} table  tên bảng (phải nằm trong whitelist)
 * @param {*} id          id cần kiểm tra
 * @param {number} userId user đang thao tác
 * @returns {Promise<boolean>} true nếu bản ghi tồn tại và thuộc userId
 */
async function assertOwns(client, table, id, userId) {
  if (!TABLES.has(table)) throw new Error(`assertOwns: bảng không được phép: ${table}`);
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return false;
  const r = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND user_id = $2`, [n, userId]);
  return r.rows.length > 0;
}

module.exports = { assertOwns };
