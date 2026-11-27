// controllers/walletController.js — Ví trả trước theo khách (đại lý cấp dưới cũng là 1 khách).
// Số dư = SUM(wallet_entries.amount): nạp (+), trừ khi thanh toán (−), hoàn tiền (−), điều chỉnh (±).
// Mọi thao tác ghi đều khoá dòng customers (lockWallet) trước khi đọc số dư → không thể âm do chạy song song.
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { assertAccount } = require('../utils/costItems');
const { walletBalance, lockWallet, targetLabelSql, targetJoinsSql, fmtVnd } = require('../utils/money');
const { todayLocal } = require('../utils/dates');
const v = require('../utils/validate');

// GET /api/wallets — khách có ít nhất 1 entry, trong phạm vi.
const getWallets = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId)) ? [Number(agencyId)] : req.scope.userIds;
    const result = await pool.query(
      `SELECT c.id AS customer_id, c.name AS customer_name, c.phone, u.full_name AS owner_name,
              SUM(w.amount) AS balance, MAX(w.entry_date) AS last_entry_date, COUNT(*)::int AS entries_count
         FROM wallet_entries w
         JOIN customers c ON c.id = w.customer_id
         JOIN users u ON u.id = c.user_id
        WHERE c.user_id = ANY($1)
        GROUP BY c.id, c.name, c.phone, u.full_name
        ORDER BY c.name, c.id`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get wallets error:', error.message);
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
};

// GET /api/wallets/:customerId — số dư + lịch sử.
const getWallet = async (req, res) => {
  const customerId = v.idParam(req.params.customerId);
  try {
    const cust = await pool.query(
      `SELECT c.*, u.full_name AS owner_name, u.username AS owner_username
         FROM customers c JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 AND c.user_id = ANY($2)`,
      [customerId, req.scope.userIds]
    );
    const customer = cust.rows[0];
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    const [balance, entries] = await Promise.all([
      walletBalance(pool, customerId),
      pool.query(
        `SELECT w.id, w.kind, w.amount, w.entry_date, w.account_id, a.name AS account_name, w.payment_id,
                ${targetLabelSql()} AS target_label, w.reconciled, w.notes
           FROM wallet_entries w
           LEFT JOIN money_accounts a ON a.id = w.account_id
           LEFT JOIN payments p ON p.id = w.payment_id
           ${targetJoinsSql('p')}
          WHERE w.customer_id = $1
          ORDER BY w.entry_date DESC, w.id DESC`,
        [customerId]
      ),
    ]);
    res.json({ customer, balance, entries: entries.rows });
  } catch (error) {
    logger.error('Get wallet error:', error.message);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
};

/**
 * Khung chung cho nạp / hoàn / điều chỉnh: khoá ví, kiểm tra, ghi 1 entry.
 * @param {'topup'|'refund'|'adjust'} kind
 */
function makeEntryHandler(kind) {
  return async (req, res) => {
    const customerId = v.idParam(req.params.customerId);
    const raw = v.num(req.body.amount, { required: true, label: 'Số tiền' });
    if (kind === 'adjust' ? raw === 0 : raw <= 0) {
      return res.status(400).json({ error: kind === 'adjust' ? 'Số tiền điều chỉnh phải khác 0' : 'Số tiền phải lớn hơn 0' });
    }
    const signed = kind === 'refund' ? -raw : raw; // nạp +, hoàn −, điều chỉnh giữ dấu
    const entryDate = v.dateStr(req.body.entryDate, { label: 'Ngày' }) || todayLocal();
    const accountId = kind === 'adjust' ? null : v.int(req.body.accountId, { min: 1, label: 'Tài khoản' });
    const notes = v.str(req.body.notes, { label: 'Ghi chú' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cust = await lockWallet(client, customerId);
      if (!cust || cust.user_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
      }
      await assertAccount(client, accountId, req.user.id);
      if (signed < 0) {
        const balance = await walletBalance(client, customerId);
        if (Number(balance) + signed < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: kind === 'refund'
              ? `Số tiền hoàn vượt số dư ví (còn ${fmtVnd(balance)})`
              : `Số dư ví sẽ âm (còn ${fmtVnd(balance)})`,
          });
        }
      }
      const ins = await client.query(
        `INSERT INTO wallet_entries (user_id, customer_id, kind, amount, entry_date, account_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, customerId, kind, signed, entryDate, accountId, notes]
      );
      const balance = await walletBalance(client, customerId);
      await client.query('COMMIT');
      const label = { topup: 'Nạp ví', refund: 'Hoàn ví', adjust: 'Điều chỉnh ví' }[kind];
      logAudit(req, {
        action: kind === 'adjust' ? 'update' : 'create', entity: 'wallet_entry', entityId: ins.rows[0].id,
        summary: `${label} ${cust.name}: ${signed > 0 ? '+' : ''}${fmtVnd(signed)}`,
        details: { customerId, kind, amount: signed, accountId },
      });
      res.status(201).json({ ...ins.rows[0], balance });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
      logger.error(`Wallet ${kind} error:`, error.message);
      res.status(500).json({ error: 'Failed to save wallet entry' });
    } finally {
      client.release();
    }
  };
}

// DELETE /api/wallets/entries/:id — chỉ topup/refund/adjust; charge phải xoá qua payment tương ứng.
const deleteEntry = async (req, res) => {
  const id = v.idParam(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT customer_id, kind, amount FROM wallet_entries WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy giao dịch ví' });
    }
    const entry = found.rows[0];
    if (entry.kind === 'charge') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Khoản trừ ví gắn với thanh toán — hãy xoá thanh toán tương ứng' });
    }
    const cust = await lockWallet(client, entry.customer_id);
    const balance = await walletBalance(client, entry.customer_id);
    if (Number(balance) - Number(entry.amount) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Số dư ví sẽ âm nếu xoá giao dịch này (còn ${fmtVnd(balance)})` });
    }
    await client.query('DELETE FROM wallet_entries WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    await client.query('COMMIT');
    logAudit(req, {
      action: 'delete', entity: 'wallet_entry', entityId: id,
      summary: `Xóa giao dịch ví (${entry.kind} ${fmtVnd(entry.amount)}) của ${cust?.name || ''}`.trim(),
      details: { customerId: entry.customer_id, kind: entry.kind, amount: entry.amount },
    });
    res.json({ message: 'Wallet entry deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete wallet entry error:', error.message);
    res.status(500).json({ error: 'Failed to delete wallet entry' });
  } finally {
    client.release();
  }
};

module.exports = {
  getWallets,
  getWallet,
  topup: makeEntryHandler('topup'),
  refund: makeEntryHandler('refund'),
  adjust: makeEntryHandler('adjust'),
  deleteEntry,
};
