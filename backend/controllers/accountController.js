// controllers/accountController.js — Tài khoản tiền (ngân hàng / ví / TK người khác giữ hộ).
// Số dư = opening_balance + tiền vào (payments ≠ ví, nạp ví) − tiền ra (trả NCC, hoàn ví).
// Đọc theo phạm vi (cấp 1 xem cấp 2, chỉ xem); ghi chỉ trên dữ liệu của chính mình.
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { accountListSql, accountFlowsSql, targetLabelSql, targetJoinsSql, fmtVnd } = require('../utils/money');
const v = require('../utils/validate');

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// Field cho phép + validate. partial=true: chỉ đọc field có mặt trong body.
const FIELDS = {
  name: { col: 'name', parse: (x) => v.str(x, { max: 100, required: true, label: 'Tên tài khoản' }) },
  bank: { col: 'bank', parse: (x) => v.str(x, { max: 50, label: 'Ngân hàng' }) },
  accountNumber: { col: 'account_number', parse: (x) => v.str(x, { max: 50, label: 'Số tài khoản' }) },
  holderName: { col: 'holder_name', parse: (x) => v.str(x, { max: 255, label: 'Chủ tài khoản' }) },
  isOwn: { col: 'is_own', parse: (x) => v.bool(x, { label: 'TK của mình' }) ?? true },
  openingBalance: { col: 'opening_balance', parse: (x) => v.num(x, { label: 'Số dư đầu kỳ' }) ?? 0 },
  notes: { col: 'notes', parse: (x) => v.str(x, { label: 'Ghi chú' }) },
  archived: { col: 'archived', parse: (x) => v.bool(x, { label: 'Lưu trữ' }) ?? false },
};

function scopeIds(req) {
  const { agencyId } = req.query;
  return agencyId && req.scope.userIds.includes(Number(agencyId)) ? [Number(agencyId)] : req.scope.userIds;
}

// GET /api/accounts?includeArchived=1
const getAccounts = async (req, res) => {
  try {
    const includeArchived = ['1', 'true'].includes(String(req.query.includeArchived || ''));
    const result = await pool.query(
      `${accountListSql(includeArchived ? '' : 'AND a.archived = FALSE')} ORDER BY a.archived, a.name, a.id`,
      [scopeIds(req)]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get accounts error:', error.message);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
};

// POST /api/accounts
const createAccount = async (req, res) => {
  const b = req.body;
  const vals = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    if (key === 'archived') continue;
    vals[f.col] = f.parse(b[key]);
  }
  try {
    const result = await pool.query(
      `INSERT INTO money_accounts (user_id, name, bank, account_number, holder_name, is_own, opening_balance, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.id, vals.name, vals.bank, vals.account_number, vals.holder_name, vals.is_own, vals.opening_balance, vals.notes]
    );
    const id = result.rows[0].id;
    const row = (await pool.query(`${accountListSql('AND a.id = $2')}`, [[req.user.id], id])).rows[0];
    logAudit(req, { action: 'create', entity: 'money_account', entityId: id, summary: `Tạo tài khoản ${vals.name}`, details: { openingBalance: vals.opening_balance, isOwn: vals.is_own } });
    res.status(201).json(row);
  } catch (error) {
    logger.error('Create account error:', error.message);
    res.status(500).json({ error: 'Failed to create account' });
  }
};

// PUT /api/accounts/:id — cập nhật từng phần (field vắng = giữ nguyên).
const updateAccount = async (req, res) => {
  const id = v.idParam(req.params.id);
  const sets = [];
  const params = [id, req.user.id];
  const changed = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    if (!has(req.body, key)) continue;
    const val = f.parse(req.body[key]);
    params.push(val);
    sets.push(`${f.col} = $${params.length}`);
    changed[key] = val;
  }
  try {
    const exists = await pool.query('SELECT name FROM money_accounts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    if (sets.length > 0) {
      await pool.query(`UPDATE money_accounts SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, params);
      logAudit(req, { action: 'update', entity: 'money_account', entityId: id, summary: `Sửa tài khoản ${changed.name || exists.rows[0].name}`, details: changed });
    }
    const row = (await pool.query(`${accountListSql('AND a.id = $2')}`, [[req.user.id], id])).rows[0];
    res.json(row);
  } catch (error) {
    logger.error('Update account error:', error.message);
    res.status(500).json({ error: 'Failed to update account' });
  }
};

// DELETE /api/accounts/:id — chỉ xoá được tài khoản chưa có giao dịch nào.
const deleteAccount = async (req, res) => {
  const id = v.idParam(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acc = await client.query('SELECT name FROM money_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, req.user.id]);
    if (acc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    }
    const used = await client.query(
      `SELECT EXISTS (SELECT 1 FROM payments WHERE account_id = $1)
           OR EXISTS (SELECT 1 FROM wallet_entries WHERE account_id = $1)
           OR EXISTS (SELECT 1 FROM supplier_payments WHERE account_id = $1) AS used`,
      [id]
    );
    if (used.rows[0].used) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Tài khoản đã có giao dịch, hãy lưu trữ thay vì xoá' });
    }
    await client.query('DELETE FROM money_accounts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    await client.query('COMMIT');
    logAudit(req, { action: 'delete', entity: 'money_account', entityId: id, summary: `Xóa tài khoản ${acc.rows[0].name}` });
    res.json({ message: 'Account deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete account error:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  } finally {
    client.release();
  }
};

// Chữ thường ký tự đầu ("Vé VN123" → "vé VN123") khi đặt trong ngoặc của mô tả.
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function describe(r) {
  if (r.kind === 'payment') return [`Khách ${r.customer_name || ''}`.trim(), r.target_label].filter(Boolean).join(' · ');
  if (r.kind === 'topup') return `Nạp ví · ${r.customer_name || ''}`.trim();
  if (r.kind === 'refund') return `Hoàn ví · ${r.customer_name || ''}`.trim();
  // supplier_payment
  let s = `Trả ${r.supplier_name || ''}`.trim();
  if (r.item_label) s += ` · ${r.item_label}${r.target_label ? ` (${lowerFirst(r.target_label)})` : ''}`;
  return s;
}

// GET /api/accounts/:id/ledger?from&to — sổ chi tiết 1 tài khoản.
const getLedger = async (req, res) => {
  const id = v.idParam(req.params.id);
  const from = v.dateStr(req.query.from, { label: 'Từ ngày' });
  const to = v.dateStr(req.query.to, { label: 'Đến ngày' });
  try {
    const acc = await pool.query(`${accountListSql('AND a.id = $2')}`, [req.scope.userIds, id]);
    const account = acc.rows[0];
    if (!account) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    // opening = số dư đầu kỳ + mọi giao dịch trước `from`; total_in/out trong [from, to].
    const sums = await pool.query(
      `SELECT a.opening_balance + COALESCE(SUM(f.amt_in - f.amt_out) FILTER (WHERE $2::date IS NOT NULL AND f.date < $2), 0) AS opening,
              COALESCE(SUM(f.amt_in)  FILTER (WHERE ($2::date IS NULL OR f.date >= $2) AND ($3::date IS NULL OR f.date <= $3)), 0) AS total_in,
              COALESCE(SUM(f.amt_out) FILTER (WHERE ($2::date IS NULL OR f.date >= $2) AND ($3::date IS NULL OR f.date <= $3)), 0) AS total_out
         FROM money_accounts a
         LEFT JOIN (${accountFlowsSql('= $1')}) f ON TRUE
        WHERE a.id = $1
        GROUP BY a.opening_balance`,
      [id, from, to]
    );
    const s = sums.rows[0];
    const closing = await pool.query('SELECT ($1::numeric + $2::numeric - $3::numeric) AS closing', [s.opening, s.total_in, s.total_out]);

    const rows = await pool.query(
      `SELECT * FROM (
         SELECT 'payment' AS kind, p.id, p.payment_date AS date, 'in' AS direction, p.amount, p.reconciled,
                CASE WHEN p.debt_id IS NOT NULL THEN 'debt' WHEN p.passport_id IS NOT NULL THEN 'passport'
                     WHEN p.train_ticket_id IS NOT NULL THEN 'train' ELSE 'tour' END AS ref_type,
                COALESCE(p.debt_id, p.passport_id, p.train_ticket_id, p.tour_id) AS ref_id,
                COALESCE(d.customer_name, ps.customer_name, tr.customer_name, tu.customer_name) AS customer_name,
                COALESCE(d.customer_id, ps.customer_id, tr.customer_id, tu.customer_id) AS customer_id,
                NULL::text AS supplier_name, NULL::text AS item_label,
                ${targetLabelSql()} AS target_label, p.notes
           FROM payments p ${targetJoinsSql('p')}
          WHERE p.account_id = $1 AND COALESCE(p.method, '') <> 'wallet'
         UNION ALL
         SELECT w.kind, w.id, w.entry_date, CASE WHEN w.kind = 'topup' THEN 'in' ELSE 'out' END, ABS(w.amount), w.reconciled,
                'wallet', w.customer_id, c.name, w.customer_id, NULL, NULL, NULL, w.notes
           FROM wallet_entries w JOIN customers c ON c.id = w.customer_id
          WHERE w.account_id = $1 AND w.kind IN ('topup', 'refund')
         UNION ALL
         SELECT 'supplier_payment', sp.id, sp.pay_date, 'out', sp.amount, sp.reconciled,
                'supplier', sp.supplier_id,
                COALESCE(d.customer_name, ps.customer_name, tr.customer_name, tu.customer_name),
                COALESCE(d.customer_id, ps.customer_id, tr.customer_id, tu.customer_id),
                s.name, ci.label, ${targetLabelSql()}, sp.notes
           FROM supplier_payments sp
           JOIN suppliers s ON s.id = sp.supplier_id
           LEFT JOIN cost_items ci ON ci.id = sp.cost_item_id
           ${targetJoinsSql('ci')}
          WHERE sp.account_id = $1
       ) x
       WHERE ($2::date IS NULL OR x.date >= $2) AND ($3::date IS NULL OR x.date <= $3)
       ORDER BY x.date ASC, x.id ASC`,
      [id, from, to]
    );

    res.json({
      account,
      opening: s.opening,
      rows: rows.rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        date: r.date,
        direction: r.direction,
        amount: r.amount,
        description: describe(r),
        customer_name: r.customer_name,
        customer_id: r.customer_id,
        supplier_name: r.supplier_name,
        reconciled: r.reconciled,
        notes: r.notes,
        ref: { type: r.ref_type, id: r.ref_id },
      })),
      total_in: s.total_in,
      total_out: s.total_out,
      closing: closing.rows[0].closing,
    });
  } catch (error) {
    logger.error('Get account ledger error:', error.message);
    res.status(500).json({ error: 'Failed to fetch ledger' });
  }
};

// Loại giao dịch đối soát → bảng (whitelist).
const RECONCILE_TABLES = { payment: 'payments', wallet: 'wallet_entries', supplier_payment: 'supplier_payments' };

// PUT /api/accounts/reconcile { kind, id, reconciled } — chỉ trên dữ liệu của mình.
const reconcile = async (req, res) => {
  const kind = v.oneOf(req.body.kind, Object.keys(RECONCILE_TABLES), { required: true, label: 'Loại giao dịch' });
  const id = v.int(req.body.id, { min: 1, required: true, label: 'Mã giao dịch' });
  const reconciled = v.bool(req.body.reconciled, { label: 'Đã đối soát' });
  if (reconciled === null) return res.status(400).json({ error: 'Đã đối soát là bắt buộc' });
  try {
    const r = await pool.query(
      `UPDATE ${RECONCILE_TABLES[kind]} SET reconciled = $1 WHERE id = $2 AND user_id = $3 RETURNING id, amount`,
      [reconciled, id, req.user.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    logAudit(req, {
      action: 'update', entity: 'reconcile', entityId: id,
      summary: `${reconciled ? 'Đánh dấu' : 'Bỏ'} đối soát ${kind} #${id} (${fmtVnd(Math.abs(Number(r.rows[0].amount)))})`,
      details: { kind, reconciled },
    });
    res.json({ ok: true });
  } catch (error) {
    logger.error('Reconcile error:', error.message);
    res.status(500).json({ error: 'Failed to reconcile' });
  }
};

module.exports = { getAccounts, createAccount, updateAccount, deleteAccount, getLedger, reconcile };
