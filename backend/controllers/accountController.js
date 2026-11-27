// controllers/accountController.js — Tài khoản tiền (ngân hàng / ví / TK người khác giữ hộ).
// Số dư (v3.1) = opening_balance + tiền vào − tiền ra; công thức đầy đủ ở utils/money.js (accountFlowsSql).
// Đọc theo phạm vi (cấp 1 xem cấp 2, chỉ xem); ghi chỉ trên dữ liệu của chính mình.
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { accountListSql, accountFlowsSql, ledgerRowsSql, fmtVnd } = require('../utils/money');
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
           OR EXISTS (SELECT 1 FROM supplier_payments WHERE account_id = $1)
           OR EXISTS (SELECT 1 FROM receipts WHERE account_id = $1)
           OR EXISTS (SELECT 1 FROM account_transfers WHERE from_account_id = $1 OR to_account_id = $1)
           OR EXISTS (SELECT 1 FROM account_entries WHERE account_id = $1) AS used`,
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
  switch (r.kind) {
    case 'payment':
      return [`Khách ${r.customer_name || ''}`.trim(), r.target_label].filter(Boolean).join(' · ');
    case 'customer_refund':
      return [`Hoàn tiền khách ${r.customer_name || ''}`.trim(), r.target_label].filter(Boolean).join(' · ');
    case 'receipt': {
      const parts = [r.customer_name ? `Khách ${r.customer_name}` : 'Phiếu thu'];
      if (r.target_label) parts.push(r.target_label);
      if (Number(r.wallet_amount) > 0) parts.push(`vào ví ${fmtVnd(r.wallet_amount)}`);
      return parts.join(' · ');
    }
    case 'topup':
      return `Nạp ví · ${r.customer_name || ''}`.trim();
    case 'refund':
      return `Hoàn ví · ${r.customer_name || ''}`.trim();
    case 'transfer_out': {
      let s = `Chuyển sang ${r.other_account || ''}`.trim();
      if (Number(r.fee) > 0) s += ` (gồm phí ${fmtVnd(r.fee)})`;
      return r.notes ? `${s} · ${r.notes}` : s;
    }
    case 'transfer_in': {
      const s = `Nhận từ ${r.other_account || ''}`.trim();
      return r.notes ? `${s} · ${r.notes}` : s;
    }
    case 'entry_in':
    case 'entry_out':
      return [r.item_label, r.notes].filter(Boolean).join(' · ');
    default: {
      // supplier_payment / supplier_refund
      let s = r.kind === 'supplier_refund' ? `Nhận lại từ ${r.supplier_name || ''}`.trim() : `Trả ${r.supplier_name || ''}`.trim();
      if (r.item_label) s += ` · ${r.item_label}${r.target_label ? ` (${lowerFirst(r.target_label)})` : ''}`;
      return s;
    }
  }
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
      `SELECT * FROM (${ledgerRowsSql()}) x
        WHERE ($2::date IS NULL OR x.date >= $2) AND ($3::date IS NULL OR x.date <= $3)
        ORDER BY x.date ASC, x.id ASC, x.kind ASC`,
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

// Loại giao dịch đối soát → bảng + cột (whitelist, ghép thẳng vào SQL).
// Nhận thêm tên kind của sổ chi tiết làm bí danh (topup/refund → wallet, customer_refund → payment, ...)
// để FE gửi thẳng `row.kind` của ledger.
const RECONCILE = {
  payment: { table: 'payments', col: 'reconciled', amount: 'amount' },
  wallet: { table: 'wallet_entries', col: 'reconciled', amount: 'amount' },
  supplier_payment: { table: 'supplier_payments', col: 'reconciled', amount: 'amount' },
  receipt: { table: 'receipts', col: 'reconciled', amount: 'amount' },
  transfer_in: { table: 'account_transfers', col: 'reconciled_to', amount: 'amount' },
  transfer_out: { table: 'account_transfers', col: 'reconciled_from', amount: 'amount + fee' },
  entry: { table: 'account_entries', col: 'reconciled', amount: 'amount' },
};
const RECONCILE_ALIASES = {
  customer_refund: 'payment',
  topup: 'wallet',
  refund: 'wallet',
  supplier_refund: 'supplier_payment',
  entry_in: 'entry',
  entry_out: 'entry',
};
const RECONCILE_KINDS = [...Object.keys(RECONCILE), ...Object.keys(RECONCILE_ALIASES)];

function parseReconcileItem(item, prefix = '') {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new v.ValidationError(`${prefix}Giao dịch không hợp lệ`);
  const raw = v.oneOf(item.kind, RECONCILE_KINDS, { required: true, label: `${prefix}Loại giao dịch` });
  const id = v.int(item.id, { min: 1, required: true, label: `${prefix}Mã giao dịch` });
  const reconciled = v.bool(item.reconciled, { label: `${prefix}Đã đối soát` });
  if (reconciled === null) throw new v.ValidationError(`${prefix}Đã đối soát là bắt buộc`);
  return { kind: RECONCILE_ALIASES[raw] || raw, id, reconciled };
}

/**
 * Đánh dấu 1 giao dịch (trong transaction / pool). Phiếu thu: đánh dấu cả payments + nạp ví con.
 * @returns {Promise<null|{amount:string}>} null nếu không phải giao dịch của userId.
 */
async function applyReconcile(client, userId, { kind, id, reconciled }) {
  const t = RECONCILE[kind];
  const r = await client.query(
    `UPDATE ${t.table} SET ${t.col} = $1 WHERE id = $2 AND user_id = $3 RETURNING ${t.amount} AS amount`,
    [reconciled, id, userId]
  );
  if (r.rows.length === 0) return null;
  if (kind === 'receipt') {
    await client.query('UPDATE payments SET reconciled = $1 WHERE receipt_id = $2 AND user_id = $3', [reconciled, id, userId]);
    await client.query('UPDATE wallet_entries SET reconciled = $1 WHERE receipt_id = $2 AND user_id = $3', [reconciled, id, userId]);
  }
  return r.rows[0];
}

// PUT /api/accounts/reconcile { kind, id, reconciled } — chỉ trên dữ liệu của mình.
const reconcile = async (req, res) => {
  const item = parseReconcileItem(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await applyReconcile(client, req.user.id, item);
    if (!r) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    }
    await client.query('COMMIT');
    logAudit(req, {
      action: 'update', entity: 'reconcile', entityId: item.id,
      summary: `${item.reconciled ? 'Đánh dấu' : 'Bỏ'} đối soát ${item.kind} #${item.id} (${fmtVnd(Math.abs(Number(r.amount)))})`,
      details: { kind: item.kind, reconciled: item.reconciled },
    });
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Reconcile error:', error.message);
    res.status(500).json({ error: 'Failed to reconcile' });
  } finally {
    client.release();
  }
};

const MAX_BATCH = 1000;

// PUT /api/accounts/reconcile-batch { items:[{kind,id,reconciled}] } → { updated } — tất cả hoặc không gì cả.
const reconcileBatch = async (req, res) => {
  const raw = req.body.items;
  if (!Array.isArray(raw) || raw.length === 0) return res.status(400).json({ error: 'Danh sách giao dịch không hợp lệ' });
  if (raw.length > MAX_BATCH) return res.status(400).json({ error: `Tối đa ${MAX_BATCH} giao dịch mỗi lần` });
  const items = raw.map((it, i) => parseReconcileItem(it, `Dòng ${i + 1}: `));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let updated = 0;
    for (const it of items) {
      const r = await applyReconcile(client, req.user.id, it);
      if (!r) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Giao dịch không hợp lệ: ${it.kind} #${it.id}` });
      }
      updated += 1;
    }
    await client.query('COMMIT');
    logAudit(req, {
      action: 'update', entity: 'reconcile',
      summary: `Khớp sao kê: ${updated} giao dịch`,
      details: { items: items.map((it) => ({ kind: it.kind, id: it.id, reconciled: it.reconciled })) },
    });
    res.json({ updated });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Reconcile batch error:', error.message);
    res.status(500).json({ error: 'Failed to reconcile' });
  } finally {
    client.release();
  }
};

module.exports = { getAccounts, createAccount, updateAccount, deleteAccount, getLedger, reconcile, reconcileBatch };
