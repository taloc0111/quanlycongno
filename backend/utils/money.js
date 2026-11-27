// utils/money.js — SQL dùng chung cho "Dòng tiền v3" (docs/MONEY-FLOWS.md):
// số dư tài khoản (list + sổ chi tiết + stats), nhãn dịch vụ, số dư ví khách.
// Tiền trả về dạng chuỗi numeric (giống các API hiện có); số đếm ép ::int.

// Số tiền 1 phiếu thu đi qua tài khoản = tổng payments con (không phải trừ ví) + nạp ví từ phiếu.
// Tính từ dòng con (không lấy receipts.amount) để sổ luôn khớp số dư kể cả khi 1 dịch vụ con bị xoá.
const receiptAmountSql = (r) => `(
  COALESCE((SELECT SUM(rp.amount) FROM payments rp WHERE rp.receipt_id = ${r}.id AND COALESCE(rp.method, '') <> 'wallet'), 0)
  + COALESCE((SELECT SUM(rw.amount) FROM wallet_entries rw WHERE rw.receipt_id = ${r}.id AND rw.kind = 'topup'), 0))`;
const receiptHasChildrenSql = (r) => `(EXISTS (SELECT 1 FROM payments rp WHERE rp.receipt_id = ${r}.id)
  OR EXISTS (SELECT 1 FROM wallet_entries rw WHERE rw.receipt_id = ${r}.id))`;

/**
 * Các luồng tiền đi qua tài khoản — mỗi dòng 1 giao dịch (amt_in / amt_out luôn ≥ 0).
 * Công thức v3.1 (docs/MONEY-FLOWS.md):
 *   payments lẻ (method ≠ 'wallet', không thuộc phiếu thu; dòng hoàn âm → tiền ra)
 *   + phiếu thu (1 dòng = tổng payments con + nạp ví từ phiếu)
 *   + nạp ví − hoàn ví (nạp không thuộc phiếu thu)
 *   − trả NCC (âm = NCC trả lại → tiền vào)
 *   + chuyển đến − (chuyển đi + phí) + thu khác − chi khác
 * Trừ ví (charge) / hoàn vé vào ví (credit) KHÔNG phải tiền qua tài khoản nên không có ở đây.
 * @param {string} accountCond điều kiện SQL áp lên cột tài khoản (vd "= $1",
 *   "IN (SELECT id FROM money_accounts WHERE user_id = ANY($1))").
 */
function accountFlowsSql(accountCond) {
  return `
    SELECT (CASE WHEN p.amount < 0 THEN 'customer_refund' ELSE 'payment' END)::text AS kind, p.id, p.account_id,
           p.payment_date AS date, GREATEST(p.amount, 0) AS amt_in, GREATEST(-p.amount, 0) AS amt_out, p.reconciled
      FROM payments p
     WHERE p.account_id ${accountCond} AND COALESCE(p.method, '') <> 'wallet' AND p.receipt_id IS NULL
    UNION ALL
    SELECT 'receipt', r.id, r.account_id, r.receipt_date, ${receiptAmountSql('r')}, 0::numeric, r.reconciled
      FROM receipts r
     WHERE r.account_id ${accountCond} AND ${receiptHasChildrenSql('r')}
    UNION ALL
    SELECT 'topup', w.id, w.account_id, w.entry_date, w.amount, 0::numeric, w.reconciled
      FROM wallet_entries w
     WHERE w.account_id ${accountCond} AND w.kind = 'topup' AND w.receipt_id IS NULL
    UNION ALL
    SELECT 'refund', w.id, w.account_id, w.entry_date, 0::numeric, ABS(w.amount), w.reconciled
      FROM wallet_entries w
     WHERE w.account_id ${accountCond} AND w.kind = 'refund'
    UNION ALL
    SELECT CASE WHEN sp.amount < 0 THEN 'supplier_refund' ELSE 'supplier_payment' END, sp.id, sp.account_id,
           sp.pay_date, GREATEST(-sp.amount, 0), GREATEST(sp.amount, 0), sp.reconciled
      FROM supplier_payments sp
     WHERE sp.account_id ${accountCond}
    UNION ALL
    SELECT 'transfer_out', t.id, t.from_account_id, t.transfer_date, 0::numeric, t.amount + t.fee, t.reconciled_from
      FROM account_transfers t
     WHERE t.from_account_id ${accountCond}
    UNION ALL
    SELECT 'transfer_in', t.id, t.to_account_id, t.transfer_date, t.amount, 0::numeric, t.reconciled_to
      FROM account_transfers t
     WHERE t.to_account_id ${accountCond}
    UNION ALL
    SELECT CASE WHEN e.direction = 'in' THEN 'entry_in' ELSE 'entry_out' END, e.id, e.account_id, e.entry_date,
           CASE WHEN e.direction = 'in' THEN e.amount ELSE 0 END,
           CASE WHEN e.direction = 'out' THEN e.amount ELSE 0 END, e.reconciled
      FROM account_entries e
     WHERE e.account_id ${accountCond}`;
}

/**
 * Các dòng sổ chi tiết của 1 tài khoản ($1 = account id) kèm cột mô tả. PHẢI khớp từng dòng
 * với accountFlowsSql('= $1') để luỹ kế = số dư cuối kỳ. Cột: kind, id, date, direction,
 * amount (≥ 0), reconciled, ref_type, ref_id, customer_name, customer_id, supplier_name,
 * item_label, target_label, notes, wallet_amount, fee, other_account.
 */
function ledgerRowsSql() {
  const cust = 'COALESCE(d.customer_name, ps.customer_name, tr.customer_name, tu.customer_name)';
  const custId = 'COALESCE(d.customer_id, ps.customer_id, tr.customer_id, tu.customer_id)';
  return `
    SELECT (CASE WHEN p.amount < 0 THEN 'customer_refund' ELSE 'payment' END)::text AS kind, p.id, p.payment_date AS date,
           (CASE WHEN p.amount < 0 THEN 'out' ELSE 'in' END)::text AS direction, ABS(p.amount) AS amount, p.reconciled,
           (${targetTypeSql('p')})::text AS ref_type,
           COALESCE(p.debt_id, p.passport_id, p.train_ticket_id, p.tour_id) AS ref_id,
           ${cust}::text AS customer_name, ${custId} AS customer_id,
           NULL::text AS supplier_name, NULL::text AS item_label, (${targetLabelSql()})::text AS target_label, p.notes,
           NULL::numeric AS wallet_amount, NULL::numeric AS fee, NULL::text AS other_account
      FROM payments p ${targetJoinsSql('p')}
     WHERE p.account_id = $1 AND COALESCE(p.method, '') <> 'wallet' AND p.receipt_id IS NULL
    UNION ALL
    SELECT 'receipt', r.id, r.receipt_date, 'in', ${receiptAmountSql('r')}, r.reconciled,
           'receipt', r.id, c.name, r.customer_id, NULL, NULL,
           (SELECT string_agg(${targetLabelSql()}, ', ' ORDER BY p.id)
              FROM payments p ${targetJoinsSql('p')} WHERE p.receipt_id = r.id),
           r.notes,
           COALESCE((SELECT SUM(rw.amount) FROM wallet_entries rw WHERE rw.receipt_id = r.id AND rw.kind = 'topup'), 0),
           NULL, NULL
      FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.account_id = $1 AND ${receiptHasChildrenSql('r')}
    UNION ALL
    SELECT w.kind, w.id, w.entry_date, CASE WHEN w.kind = 'topup' THEN 'in' ELSE 'out' END, ABS(w.amount), w.reconciled,
           'wallet', w.customer_id, c.name, w.customer_id, NULL, NULL, NULL, w.notes, NULL, NULL, NULL
      FROM wallet_entries w JOIN customers c ON c.id = w.customer_id
     WHERE w.account_id = $1 AND ((w.kind = 'topup' AND w.receipt_id IS NULL) OR w.kind = 'refund')
    UNION ALL
    SELECT CASE WHEN sp.amount < 0 THEN 'supplier_refund' ELSE 'supplier_payment' END, sp.id, sp.pay_date,
           CASE WHEN sp.amount < 0 THEN 'in' ELSE 'out' END, ABS(sp.amount), sp.reconciled,
           'supplier', sp.supplier_id, ${cust}, ${custId},
           s.name, ci.label, ${targetLabelSql()}, sp.notes, NULL, NULL, NULL
      FROM supplier_payments sp
      JOIN suppliers s ON s.id = sp.supplier_id
      LEFT JOIN cost_items ci ON ci.id = sp.cost_item_id
      ${targetJoinsSql('ci')}
     WHERE sp.account_id = $1
    UNION ALL
    SELECT 'transfer_out', t.id, t.transfer_date, 'out', t.amount + t.fee, t.reconciled_from,
           'transfer', t.id, NULL, NULL, NULL, NULL, NULL, t.notes, NULL, t.fee, ta.name
      FROM account_transfers t JOIN money_accounts ta ON ta.id = t.to_account_id
     WHERE t.from_account_id = $1
    UNION ALL
    SELECT 'transfer_in', t.id, t.transfer_date, 'in', t.amount, t.reconciled_to,
           'transfer', t.id, NULL, NULL, NULL, NULL, NULL, t.notes, NULL, t.fee, fa.name
      FROM account_transfers t JOIN money_accounts fa ON fa.id = t.from_account_id
     WHERE t.to_account_id = $1
    UNION ALL
    SELECT CASE WHEN e.direction = 'in' THEN 'entry_in' ELSE 'entry_out' END, e.id, e.entry_date, e.direction,
           e.amount, e.reconciled, 'entry', e.id, NULL, NULL, NULL, e.category, NULL, e.notes, NULL, NULL, NULL
      FROM account_entries e
     WHERE e.account_id = $1`;
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
  ledgerRowsSql,
  accountListSql,
  targetLabelSql,
  targetTypeSql,
  targetJoinsSql,
  walletBalance,
  lockWallet,
  fmtVnd,
};
