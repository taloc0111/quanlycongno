// controllers/receiptController.js — Phiếu thu nhiều vé (Dòng tiền v3.1, docs/MONEY-FLOWS.md):
// 1 lần khách chuyển tiền → chia cho nhiều dịch vụ, phần thừa vào ví khách.
// Xoá phiếu = xoá payments con + nạp ví (CASCADE), tính lại đã trả; không cho ví khách âm.
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { lockWallet, walletBalance, fmtVnd, targetTypeSql, targetLabelSql, targetJoinsSql } = require('../utils/money');
const { parseAllocations, createReceipt } = require('../utils/receipts');
const { recomputeServicePaid, typeOfRow, lockService, SERVICES } = require('../utils/services');
const { todayLocal } = require('../utils/dates');
const v = require('../utils/validate');

const PAYMENT_TARGETS = ['self', 'agency'];

const RECEIPT_SELECT = `
  SELECT r.*, a.name AS account_name, c.name AS customer_name, u.full_name AS owner_name,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'type', ${targetTypeSql('p')},
                    'id', COALESCE(p.debt_id, p.passport_id, p.train_ticket_id, p.tour_id),
                    'label', ${targetLabelSql()},
                    'amount', p.amount::text,
                    'payment_id', p.id
                  ) ORDER BY p.id)
             FROM payments p ${targetJoinsSql('p')}
            WHERE p.receipt_id = r.id
         ), '[]'::json) AS allocations,
         COALESCE((SELECT SUM(w.amount) FROM wallet_entries w WHERE w.receipt_id = r.id AND w.kind = 'topup'), 0) AS wallet_amount
    FROM receipts r
    LEFT JOIN money_accounts a ON a.id = r.account_id
    LEFT JOIN customers c ON c.id = r.customer_id
    JOIN users u ON u.id = r.user_id`;

// GET /api/receipts?customerId=
const getReceipts = async (req, res) => {
  const customerId = v.int(req.query.customerId, { min: 1, label: 'Khách hàng' });
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId)) ? [Number(agencyId)] : req.scope.userIds;
    const r = await pool.query(
      `${RECEIPT_SELECT}
        WHERE r.user_id = ANY($1) AND ($2::int IS NULL OR r.customer_id = $2)
        ORDER BY r.receipt_date DESC, r.id DESC`,
      [ids, customerId]
    );
    res.json(r.rows);
  } catch (error) {
    logger.error('Get receipts error:', error.message);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
};

// POST /api/receipts { accountId, receiptDate, method, paymentTarget, notes, customerId?, amount*>0, allocations:[{type,id,amount}] }
const createReceiptHandler = async (req, res) => {
  const b = req.body;
  const amount = v.num(b.amount, { required: true, label: 'Số tiền' });
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  const method = v.str(b.method, { max: 30, label: 'Hình thức' });
  if (method === 'wallet') return res.status(400).json({ error: 'Phiếu thu không dùng hình thức trừ ví' });
  const input = {
    amount,
    method,
    accountId: v.int(b.accountId, { min: 1, label: 'Tài khoản' }),
    customerId: v.int(b.customerId, { min: 1, label: 'Khách hàng' }),
    receiptDate: v.dateStr(b.receiptDate, { label: 'Ngày thu' }) || todayLocal(),
    paymentTarget: v.oneOf(b.paymentTarget, PAYMENT_TARGETS, { label: 'Tài khoản nhận', fallback: 'self' }),
    notes: v.str(b.notes, { label: 'Ghi chú' }),
    allocations: parseAllocations(b.allocations),
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await createReceipt(client, req.user.id, input);
    await client.query('COMMIT');
    const receipt = (await pool.query(`${RECEIPT_SELECT} WHERE r.id = $1`, [out.receipt.id])).rows[0];
    logAudit(req, {
      action: 'payment', entity: 'receipt', entityId: out.receipt.id,
      summary: `Phiếu thu ${fmtVnd(amount)}${receipt.customer_name ? ` của ${receipt.customer_name}` : ''}: ${out.payments.length} dịch vụ${out.walletTopup ? `, vào ví ${fmtVnd(out.walletTopup.amount)}` : ''}`,
      details: { amount, accountId: input.accountId, customerId: input.customerId, allocations: input.allocations, walletTopup: out.walletTopup ? Number(out.walletTopup.amount) : 0 },
    });
    res.status(201).json({ receipt, payments: out.payments, walletTopup: out.walletTopup });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create receipt error:', error.message);
    res.status(500).json({ error: 'Failed to create receipt' });
  } finally {
    client.release();
  }
};

// DELETE /api/receipts/:id
const deleteReceipt = async (req, res) => {
  const id = v.idParam(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM receipts WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, req.user.id]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy phiếu thu' });
    }
    const children = await client.query(
      `SELECT ${Object.values(SERVICES).map((s) => s.payCol).join(', ')} FROM payments WHERE receipt_id = $1`,
      [id]
    );
    // Khoá dịch vụ con TRƯỚC ví (cùng thứ tự với ghi thanh toán: dịch vụ → khách) để không deadlock.
    const targets = children.rows
      .map((p) => { const type = typeOfRow(p); return { type, id: p[SERVICES[type].payCol] }; })
      .sort((a, b) => (a.type === b.type ? a.id - b.id : a.type < b.type ? -1 : 1));
    for (const t of targets) await lockService(client, t.type, t.id, req.user.id);
    // Phần thừa đã vào ví: khoá ví rồi kiểm tra xoá xong không âm (khách có thể đã tiêu).
    const tops = await client.query(
      `SELECT customer_id, SUM(amount) AS amount FROM wallet_entries WHERE receipt_id = $1 GROUP BY customer_id ORDER BY customer_id`,
      [id]
    );
    for (const t of tops.rows) {
      await lockWallet(client, t.customer_id);
      const balance = await walletBalance(client, t.customer_id);
      if (Number(balance) - Number(t.amount) < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Ví khách đã dùng phần tiền thừa của phiếu thu (ví còn ${fmtVnd(balance)}) — không xoá được` });
      }
    }
    await client.query('DELETE FROM receipts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    for (const t of targets) await recomputeServicePaid(client, t.type, t.id);
    await client.query('COMMIT');
    const r = found.rows[0];
    logAudit(req, {
      action: 'delete', entity: 'receipt', entityId: id,
      summary: `Xóa phiếu thu ${fmtVnd(r.amount)} (${children.rows.length} dịch vụ${tops.rows.length ? ', trừ lại ví' : ''})`,
      details: { amount: r.amount, customerId: r.customer_id, accountId: r.account_id },
    });
    res.json({ message: 'Receipt deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete receipt error:', error.message);
    res.status(500).json({ error: 'Failed to delete receipt' });
  } finally {
    client.release();
  }
};

module.exports = { getReceipts, createReceipt: createReceiptHandler, deleteReceipt };
