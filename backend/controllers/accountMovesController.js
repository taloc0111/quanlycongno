// controllers/accountMovesController.js — Dòng tiền v3.1: chuyển tiền giữa 2 tài khoản
// (account_transfers, phí trừ ở TK nguồn) và thu chi khác ngoài vé (account_entries).
// Đọc theo phạm vi (cấp 1 xem cấp 2); ghi chỉ trên dữ liệu của mình. Xoá = hoàn tác số dư cả 2 TK.
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { assertOwns } = require('../utils/ownership');
const { fmtVnd } = require('../utils/money');
const { todayLocal } = require('../utils/dates');
const v = require('../utils/validate');

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

function scopeIds(req) {
  const { agencyId } = req.query;
  return agencyId && req.scope.userIds.includes(Number(agencyId)) ? [Number(agencyId)] : req.scope.userIds;
}

async function assertOwnAccount(client, accountId, userId) {
  if (!(await assertOwns(client, 'money_accounts', accountId, userId))) {
    throw new v.ValidationError('Tài khoản không hợp lệ');
  }
}

// ---------------------------------------------------------------------------
// Chuyển tiền
// ---------------------------------------------------------------------------
const TRANSFER_SELECT = `
  SELECT t.*, fa.name AS from_account_name, ta.name AS to_account_name, u.full_name AS owner_name
    FROM account_transfers t
    JOIN money_accounts fa ON fa.id = t.from_account_id
    JOIN money_accounts ta ON ta.id = t.to_account_id
    JOIN users u ON u.id = t.user_id`;

// GET /api/accounts/transfers?accountId=
const getTransfers = async (req, res) => {
  const accountId = v.int(req.query.accountId, { min: 1, label: 'Tài khoản' });
  try {
    const r = await pool.query(
      `${TRANSFER_SELECT}
        WHERE t.user_id = ANY($1) AND ($2::int IS NULL OR t.from_account_id = $2 OR t.to_account_id = $2)
        ORDER BY t.transfer_date DESC, t.id DESC`,
      [scopeIds(req), accountId]
    );
    res.json(r.rows);
  } catch (error) {
    logger.error('Get transfers error:', error.message);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
};

// POST /api/accounts/transfers { fromAccountId*, toAccountId*, amount*>0, fee=0, transferDate, notes }
const createTransfer = async (req, res) => {
  const fromId = v.int(req.body.fromAccountId, { min: 1, required: true, label: 'Tài khoản chuyển' });
  const toId = v.int(req.body.toAccountId, { min: 1, required: true, label: 'Tài khoản nhận' });
  const amount = v.num(req.body.amount, { required: true, label: 'Số tiền' });
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  const fee = v.amount(req.body.fee, { label: 'Phí chuyển' }) ?? 0;
  const transferDate = v.dateStr(req.body.transferDate, { label: 'Ngày chuyển' }) || todayLocal();
  const notes = v.str(req.body.notes, { label: 'Ghi chú' });
  if (fromId === toId) return res.status(400).json({ error: 'Tài khoản chuyển và nhận phải khác nhau' });
  try {
    await assertOwnAccount(pool, fromId, req.user.id);
    await assertOwnAccount(pool, toId, req.user.id);
    const ins = await pool.query(
      `INSERT INTO account_transfers (user_id, from_account_id, to_account_id, amount, fee, transfer_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.id, fromId, toId, amount, fee, transferDate, notes]
    );
    const row = (await pool.query(`${TRANSFER_SELECT} WHERE t.id = $1`, [ins.rows[0].id])).rows[0];
    logAudit(req, {
      action: 'create', entity: 'account_transfer', entityId: row.id,
      summary: `Chuyển ${fmtVnd(amount)} từ ${row.from_account_name} sang ${row.to_account_name}${fee > 0 ? ` (phí ${fmtVnd(fee)})` : ''}`,
      details: { fromAccountId: fromId, toAccountId: toId, amount, fee, transferDate },
    });
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create transfer error:', error.message);
    res.status(500).json({ error: 'Failed to create transfer' });
  }
};

// DELETE /api/accounts/transfers/:id — số dư 2 TK tự về như trước (số dư tính từ giao dịch).
const deleteTransfer = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const del = await pool.query(
      'DELETE FROM account_transfers WHERE id = $1 AND user_id = $2 RETURNING from_account_id, to_account_id, amount, fee',
      [id, req.user.id]
    );
    if (del.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy giao dịch chuyển tiền' });
    const t = del.rows[0];
    logAudit(req, {
      action: 'delete', entity: 'account_transfer', entityId: id,
      summary: `Xóa chuyển tiền ${fmtVnd(t.amount)}`,
      details: { fromAccountId: t.from_account_id, toAccountId: t.to_account_id, amount: t.amount, fee: t.fee },
    });
    res.json({ message: 'Transfer deleted' });
  } catch (error) {
    logger.error('Delete transfer error:', error.message);
    res.status(500).json({ error: 'Failed to delete transfer' });
  }
};

// ---------------------------------------------------------------------------
// Thu chi khác
// ---------------------------------------------------------------------------
const DIRECTIONS = ['in', 'out'];
const ENTRY_FIELDS = {
  accountId: { col: 'account_id', parse: (x) => v.int(x, { min: 1, required: true, label: 'Tài khoản' }) },
  direction: { col: 'direction', parse: (x) => v.oneOf(x, DIRECTIONS, { required: true, label: 'Chiều tiền' }) },
  amount: {
    col: 'amount',
    parse: (x) => {
      const n = v.num(x, { required: true, label: 'Số tiền' });
      if (n <= 0) throw new v.ValidationError('Số tiền phải lớn hơn 0');
      return n;
    },
  },
  entryDate: { col: 'entry_date', parse: (x) => v.dateStr(x, { label: 'Ngày' }) || todayLocal() },
  category: { col: 'category', parse: (x) => v.str(x, { max: 50, label: 'Danh mục' }) || 'Khác' },
  notes: { col: 'notes', parse: (x) => v.str(x, { label: 'Ghi chú' }) },
};

const ENTRY_SELECT = `
  SELECT e.*, a.name AS account_name, u.full_name AS owner_name
    FROM account_entries e
    JOIN money_accounts a ON a.id = e.account_id
    JOIN users u ON u.id = e.user_id`;

// GET /api/accounts/entries?accountId=&from=&to=&category=
const getEntries = async (req, res) => {
  const accountId = v.int(req.query.accountId, { min: 1, label: 'Tài khoản' });
  const from = v.dateStr(req.query.from, { label: 'Từ ngày' });
  const to = v.dateStr(req.query.to, { label: 'Đến ngày' });
  const category = v.str(req.query.category, { max: 50, label: 'Danh mục' });
  try {
    const r = await pool.query(
      `${ENTRY_SELECT}
        WHERE e.user_id = ANY($1)
          AND ($2::int IS NULL OR e.account_id = $2)
          AND ($3::date IS NULL OR e.entry_date >= $3)
          AND ($4::date IS NULL OR e.entry_date <= $4)
          AND ($5::text IS NULL OR e.category = $5)
        ORDER BY e.entry_date DESC, e.id DESC`,
      [scopeIds(req), accountId, from, to, category]
    );
    res.json(r.rows);
  } catch (error) {
    logger.error('Get entries error:', error.message);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
};

// POST /api/accounts/entries { accountId*, direction*, amount*>0, entryDate, category, notes }
const createEntry = async (req, res) => {
  const vals = {};
  for (const [key, f] of Object.entries(ENTRY_FIELDS)) vals[f.col] = f.parse(req.body[key]);
  try {
    await assertOwnAccount(pool, vals.account_id, req.user.id);
    const ins = await pool.query(
      `INSERT INTO account_entries (user_id, account_id, direction, amount, entry_date, category, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.id, vals.account_id, vals.direction, vals.amount, vals.entry_date, vals.category, vals.notes]
    );
    const row = (await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [ins.rows[0].id])).rows[0];
    logAudit(req, {
      action: 'create', entity: 'account_entry', entityId: row.id,
      summary: `${vals.direction === 'in' ? 'Thu' : 'Chi'} khác ${fmtVnd(vals.amount)} · ${vals.category} (${row.account_name})`,
      details: { accountId: vals.account_id, direction: vals.direction, amount: vals.amount, category: vals.category },
    });
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create entry error:', error.message);
    res.status(500).json({ error: 'Failed to create entry' });
  }
};

// PUT /api/accounts/entries/:id — cập nhật từng phần (field vắng = giữ nguyên).
const updateEntry = async (req, res) => {
  const id = v.idParam(req.params.id);
  const sets = [];
  const params = [id, req.user.id];
  const changed = {};
  for (const [key, f] of Object.entries(ENTRY_FIELDS)) {
    if (!has(req.body, key)) continue;
    const val = f.parse(req.body[key]);
    params.push(val);
    sets.push(`${f.col} = $${params.length}`);
    changed[key] = val;
  }
  try {
    const exists = await pool.query('SELECT id FROM account_entries WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy khoản thu chi' });
    if (has(changed, 'accountId')) await assertOwnAccount(pool, changed.accountId, req.user.id);
    if (sets.length > 0) {
      await pool.query(`UPDATE account_entries SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, params);
      logAudit(req, { action: 'update', entity: 'account_entry', entityId: id, summary: `Sửa khoản thu chi #${id}`, details: changed });
    }
    const row = (await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [id])).rows[0];
    res.json(row);
  } catch (error) {
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Update entry error:', error.message);
    res.status(500).json({ error: 'Failed to update entry' });
  }
};

// DELETE /api/accounts/entries/:id
const deleteEntry = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const del = await pool.query(
      'DELETE FROM account_entries WHERE id = $1 AND user_id = $2 RETURNING account_id, direction, amount, category',
      [id, req.user.id]
    );
    if (del.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy khoản thu chi' });
    const e = del.rows[0];
    logAudit(req, {
      action: 'delete', entity: 'account_entry', entityId: id,
      summary: `Xóa khoản ${e.direction === 'in' ? 'thu' : 'chi'} khác ${fmtVnd(e.amount)} · ${e.category}`,
      details: { accountId: e.account_id, direction: e.direction, amount: e.amount },
    });
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    logger.error('Delete entry error:', error.message);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
};

module.exports = { getTransfers, createTransfer, deleteTransfer, getEntries, createEntry, updateEntry, deleteEntry };
