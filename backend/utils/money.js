// utils/money.js — SQL dùng chung cho "Dòng tiền v3" (docs/MONEY-FLOWS.md):
// số dư tài khoản (list + sổ chi tiết + stats), nhãn dịch vụ, số dư ví khách.
// Tiền trả về dạng chuỗi numeric (giống các API hiện có); số đếm ép ::int.

/**
 * Các luồng tiền đi qua tài khoản — mỗi dòng 1 giao dịch (amt_in / amt_out luôn ≥ 0).
 *   vào: payments (method ≠ 'wallet') + wallet_entries topup
 *   ra : supplier_payments + |wallet_entries refund|
 * Trừ ví (charge) KHÔNG phải tiền vào tài khoản nên không có ở đây.
 * @param {string} accountCond điều kiện SQL áp lên cột account_id (vd "= $1",
 *   "IN (SELECT id FROM money_accounts WHERE user_id = ANY($1))").
 */
function accountFlowsSql(accountCond) {
  return `
    SELECT 'payment'::text AS kind, p.id, p.account_id, p.payment_date AS date,
           p.amount AS amt_in, 0::numeric AS amt_out, p.reconciled
      FROM payments p
     WHERE p.account_id ${accountCond} AND COALESCE(p.method, '') <> 'wallet'
    UNION ALL
    SELECT 'topup', w.id, w.account_id, w.entry_date, w.amount, 0::numeric, w.reconciled
      FROM wallet_entries w
     WHERE w.account_id ${accountCond} AND w.kind = 'topup'
    UNION ALL
    SELECT 'refund', w.id, w.account_id, w.entry_date, 0::numeric, ABS(w.amount), w.reconciled
      FROM wallet_entries w
     WHERE w.account_id ${accountCond} AND w.kind = 'refund'
    UNION ALL
    SELECT 'supplier_payment', sp.id, sp.account_id, sp.pay_date, 0::numeric, sp.amount, sp.reconciled
      FROM supplier_payments sp
     WHERE sp.account_id ${accountCond}`;
}

/**
 * Danh sách tài khoản kèm total_in / total_out / balance / unreconciled_count.
 * $1 = mảng user_id trong phạm vi. `extraWhere` nối thêm điều kiện lên bảng a.
 */
function accountListSql(extraWhere = '') {
  const scopeCond = 'IN (SELECT id FROM money_accounts WHERE user_id = ANY($1))';
  return `
    SELECT a.*, u.full_name AS owner_name,
           COALESCE(f.total_in, 0)  AS total_in,
           COALESCE(f.total_out, 0) AS total_out,
           a.opening_balance + COALESCE(f.total_in, 0) - COALESCE(f.total_out, 0) AS balance,
           COALESCE(f.unreconciled_count, 0)::int AS unreconciled_count
      FROM money_accounts a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN (
        SELECT account_id, SUM(amt_in) AS total_in, SUM(amt_out) AS total_out,
               COUNT(*) FILTER (WHERE NOT reconciled) AS unreconciled_count
          FROM (${accountFlowsSql(scopeCond)}) flows
         GROUP BY account_id
      ) f ON f.account_id = a.id
     WHERE a.user_id = ANY($1) ${extraWhere}`;
}

/**
 * Nhãn ngắn của 1 dịch vụ ("Vé VN123 HAN-SGN", "Hộ chiếu P123", "Vé tàu SE7 HN-Vinh", "Tour Đà Lạt")
 * từ 4 alias bảng đã LEFT JOIN.
 */
function targetLabelSql(d = 'd', ps = 'ps', tr = 'tr', tu = 'tu') {
  return `CASE
    WHEN ${d}.id  IS NOT NULL THEN concat_ws(' ', 'Vé', NULLIF(${d}.ticket_code, ''), NULLIF(${d}.route, ''))
    WHEN ${ps}.id IS NOT NULL THEN concat_ws(' ', 'Hộ chiếu', NULLIF(${ps}.passport_number, ''))
    WHEN ${tr}.id IS NOT NULL THEN concat_ws(' ', 'Vé tàu', NULLIF(${tr}.train_no, ''), NULLIF(${tr}.route, ''))
    WHEN ${tu}.id IS NOT NULL THEN concat_ws(' ', 'Tour', NULLIF(${tu}.tour_name, ''))
  END`;
}

/** Loại dịch vụ ('debt'|'passport'|'train'|'tour') theo các cột *_id của 1 bảng (payments / cost_items). */
function targetTypeSql(alias) {
  return `CASE WHEN ${alias}.debt_id IS NOT NULL THEN 'debt'
               WHEN ${alias}.passport_id IS NOT NULL THEN 'passport'
               WHEN ${alias}.train_ticket_id IS NOT NULL THEN 'train'
               WHEN ${alias}.tour_id IS NOT NULL THEN 'tour' END`;
}

/** LEFT JOIN 4 bảng dịch vụ theo các cột *_id của alias (payments / cost_items). */
function targetJoinsSql(alias) {
  return `
    LEFT JOIN debts d          ON d.id  = ${alias}.debt_id
    LEFT JOIN passports ps     ON ps.id = ${alias}.passport_id
    LEFT JOIN train_tickets tr ON tr.id = ${alias}.train_ticket_id
    LEFT JOIN tours tu         ON tu.id = ${alias}.tour_id`;
}

/** Số dư ví hiện tại của 1 khách (chuỗi numeric). Gọi sau khi đã khoá dòng customers nếu sắp ghi. */
async function walletBalance(client, customerId) {
  const r = await client.query(
    'SELECT COALESCE(SUM(amount), 0) AS balance FROM wallet_entries WHERE customer_id = $1',
    [customerId]
  );
  return r.rows[0].balance;
}

/**
 * Khoá ví của 1 khách (SELECT … FOR UPDATE trên dòng customers) để mọi thao tác
 * đọc-số-dư-rồi-ghi chạy tuần tự — chống 2 lần trừ ví cùng lúc vượt số dư.
 * @returns {Promise<object|null>} dòng customers (id, user_id, name) hoặc null nếu không có.
 */
async function lockWallet(client, customerId) {
  const r = await client.query('SELECT id, user_id, name FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
  return r.rows[0] || null;
}

/** Định dạng tiền VN cho thông báo lỗi / audit ("1.500.000₫"). */
function fmtVnd(x) {
  return `${Number(x).toLocaleString('vi-VN')}₫`;
}

module.exports = {
  accountFlowsSql,
  accountListSql,
  targetLabelSql,
  targetTypeSql,
  targetJoinsSql,
  walletBalance,
  lockWallet,
  fmtVnd,
};
