// controllers/paymentController.js — Lịch sử thanh toán (sổ giao dịch).
// Dòng tiền v3: payment ghi nhận tài khoản nhận (account_id) và hình thức 'wallet'
// (trừ ví trả trước của khách — xem docs/MONEY-FLOWS.md).
// v3.1: trả thừa (amount > còn nợ, dịch vụ có khách) → tự tạo phiếu thu, phần thừa vào ví;
// dịch vụ đã huỷ không nhận thanh toán; payment thuộc phiếu thu phải xoá qua phiếu thu.
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { assertAccount } = require('../utils/costItems');
const { walletBalance, lockWallet, fmtVnd } = require('../utils/money');
const { SERVICES, lockService, recomputeServicePaid, typeOfRow, round2 } = require('../utils/services');
const { createReceipt } = require('../utils/receipts');
const { todayLocal } = require('../utils/dates');
const v = require('../utils/validate');

// Cột lọc theo query param (whitelist — ghép thẳng vào SQL).
const FILTERS = [
  ['debtId', 'debt_id'],
  ['passportId', 'passport_id'],
  ['trainTicketId', 'train_ticket_id'],
  ['tourId', 'tour_id'],
];

// GET /api/payments?debtId=  hoặc  ?passportId=  / ?trainTicketId=  / ?tourId=
// Trả thêm account_name (account_id, reconciled, kind, receipt_id có sẵn trong p.*).
const getPayments = async (req, res) => {
  try {
    // Xem được trong phạm vi (mình + đại lý con); ghi nhận thì giới hạn ở chính mình.
    const ids = req.scope.userIds;
    const filter = FILTERS.find(([q]) => req.query[q]);
    const base = `SELECT p.*, a.name AS account_name
                    FROM payments p LEFT JOIN money_accounts a ON a.id = p.account_id
                   WHERE p.user_id = ANY($1)`;
    const result = filter
      ? await pool.query(
          `${base} AND p.${filter[1]} = $2 ORDER BY p.payment_date DESC, p.id DESC`,
          [ids, v.idParam(req.query[filter[0]])]
        )
      : await pool.query(`${base} ORDER BY p.payment_date DESC, p.id DESC LIMIT 200`, [ids]);
    res.json(result.rows);
  } catch (error) {
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Get payments error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

const createPayment = async (req, res) => {
  const debtId = v.int(req.body.debtId, { min: 1, label: 'Vé' });
  const passportId = v.int(req.body.passportId, { min: 1, label: 'Hộ chiếu' });
  const trainTicketId = v.int(req.body.trainTicketId, { min: 1, label: 'Vé tàu' });
  const tourId = v.int(req.body.tourId, { min: 1, label: 'Tour' });
  const targets = [debtId, passportId, trainTicketId, tourId].filter((x) => x !== null);
  if (targets.length !== 1) {
    return res.status(400).json({ error: 'Phải gắn với đúng 1 vé/hộ chiếu/tour' });
  }
  const amt = v.num(req.body.amount, { required: true, label: 'Số tiền thanh toán' });
  if (amt <= 0) {
    return res.status(400).json({ error: 'Số tiền thanh toán không hợp lệ' });
  }
  const paymentDate = v.dateStr(req.body.paymentDate, { label: 'Ngày thanh toán' });
  const method = v.str(req.body.method, { max: 30, label: 'Hình thức' });
  const notes = v.str(req.body.notes, { label: 'Ghi chú' });
  const target = v.oneOf(req.body.paymentTarget, ['self', 'agency'], { label: 'Tài khoản nhận', fallback: 'self' });
  const noOverflow = v.bool(req.body.noOverflow, { label: 'Không chuyển phần thừa vào ví' }) === true;
  const isWallet = method === 'wallet';
  // Trừ ví không phải tiền vào tài khoản nào → bỏ qua accountId.
  const accountId = isWallet ? null : v.int(req.body.accountId, { min: 1, label: 'Tài khoản' });
  const type = debtId ? 'debt' : passportId ? 'passport' : trainTicketId ? 'train' : 'tour';
  const targetId = targets[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Chỉ chủ sở hữu mới được ghi nhận thanh toán (cấp 1 chỉ xem dữ liệu cấp 2). Khoá dòng dịch vụ
    // để số "còn nợ" dùng cho trả thừa không đổi giữa chừng.
    const svc = await lockService(client, type, targetId, req.user.id);
    if (!svc) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bạn chỉ có thể ghi nhận thanh toán cho dữ liệu của chính mình' });
    }
    // Dịch vụ đã huỷ: chỉ nhận tiền khi khách còn nợ phí huỷ (phí > số đã trả), và không vượt số còn nợ.
    if (svc.is_cancelled) {
      const rem = Math.round(Number(svc.remaining) * 100) / 100;
      if (!(rem > 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Dịch vụ đã huỷ và khách không còn nợ, không nhận thanh toán mới' });
      }
      if (amt > rem) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Dịch vụ đã huỷ: chỉ thu tối đa số phí còn nợ ${fmtVnd(rem)}` });
      }
    }
    await assertAccount(client, accountId, req.user.id);

    // Trừ ví: khoá ví của khách TRƯỚC khi đọc số dư → 2 request đồng thời không thể cùng trừ vượt số dư.
    const customerId = svc.customer_id;
    if (isWallet) {
      const cust = customerId ? await lockWallet(client, customerId) : null;
      if (!cust || cust.user_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Dịch vụ chưa gắn khách hàng nên không trừ ví được' });
      }
      const balance = await walletBalance(client, customerId);
      if (Number(balance) < amt) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Ví khách chỉ còn ${fmtVnd(balance)}` });
      }
    }

    // Trả thừa: số tiền > còn nợ và dịch vụ có khách → phiếu thu (phần còn nợ vào dịch vụ, phần thừa vào ví).
    const remaining = round2(svc.remaining);
    if (!isWallet && !noOverflow && customerId && round2(amt) > remaining) {
      const allocation = remaining > 0 ? remaining : 0;
      const out = await createReceipt(client, req.user.id, {
        customerId,
        accountId,
        amount: amt,
        receiptDate: paymentDate || todayLocal(),
        method,
        paymentTarget: target,
        notes,
        allocations: allocation > 0 ? [{ type, id: targetId, amount: allocation }] : [],
      });
      await client.query('COMMIT');
      const overflowToWallet = round2(amt - allocation);
      const row = out.payments[0] || null;
      logAudit(req, {
        action: 'payment', entity: 'payment', entityId: row ? row.id : null,
        summary: `Thu ${fmtVnd(amt)} của ${svc.customer_name}: ${fmtVnd(allocation)} vào ${svc.label || 'dịch vụ'}, thừa ${fmtVnd(overflowToWallet)} vào ví`,
        details: { targetEntity: SERVICES[type].entity, targetId, amount: amt, accountId, method, receiptId: out.receipt.id, overflowToWallet },
      });
      return res.status(201).json(row
        ? { ...row, overflowToWallet, receiptId: out.receipt.id }
        : { id: null, overflowToWallet, receiptId: out.receipt.id });
    }

    const s = SERVICES[type];
    const inserted = await client.query(
      `INSERT INTO payments (user_id, ${s.payCol}, amount, payment_date, method, notes, payment_target, account_id)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, $8)
       RETURNING *`,
      [req.user.id, targetId, amt, paymentDate, method, notes, target, accountId]
    );
    const row = inserted.rows[0];
    if (isWallet) {
      await client.query(
        `INSERT INTO wallet_entries (user_id, customer_id, kind, amount, entry_date, payment_id, notes)
         VALUES ($1, $2, 'charge', $3, $4, $5, $6)`,
        [req.user.id, customerId, -amt, row.payment_date, row.id, notes]
      );
    }
    await recomputeServicePaid(client, type, targetId);
    await client.query('COMMIT');
    logAudit(req, {
      action: 'payment', entity: 'payment', entityId: row.id,
      summary: `Thu ${amt.toLocaleString('vi-VN')}₫ của ${svc.customer_name}${isWallet ? ' (trừ ví)' : ''}`,
      details: { targetEntity: s.entity, targetId, amount: amt, paymentTarget: target, accountId, method },
    });
    res.status(201).json({ ...row, overflowToWallet: 0, receiptId: null });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create payment error:', error.message);
    res.status(500).json({ error: 'Failed to create payment' });
  } finally {
    client.release();
  }
};

// Xoá payment: wallet_entries gắn với nó tự xoá theo (ON DELETE CASCADE):
//   charge (−) → tiền trả lại ví; credit (+, hoàn vé vào ví) → trừ lại ví, chặn nếu ví sẽ âm.
// Payment thuộc phiếu thu → phải xoá cả phiếu (giữ phiếu khớp tổng).
const deletePayment = async (req, res) => {
  const id = v.idParam(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const peek = await client.query('SELECT * FROM payments WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (peek.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }
    // Khoá dịch vụ TRƯỚC (cùng thứ tự với ghi thanh toán: dịch vụ → khách) rồi mới khoá payment / ví.
    const type = typeOfRow(peek.rows[0]);
    await lockService(client, type, peek.rows[0][SERVICES[type].payCol], req.user.id);
    const found = await client.query('SELECT * FROM payments WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, req.user.id]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }
    const p = found.rows[0];
    if (p.receipt_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Khoản thu thuộc phiếu thu nhiều vé — hãy xoá phiếu thu' });
    }
    const credits = await client.query(
      `SELECT customer_id, SUM(amount) AS amount FROM wallet_entries
        WHERE payment_id = $1 AND amount > 0 GROUP BY customer_id ORDER BY customer_id`,
      [id]
    );
    for (const c of credits.rows) {
      await lockWallet(client, c.customer_id);
      const balance = await walletBalance(client, c.customer_id);
      if (Number(balance) - Number(c.amount) < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Số dư ví sẽ âm nếu xoá khoản này (ví còn ${fmtVnd(balance)})` });
      }
    }
    await client.query('DELETE FROM payments WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    await recomputeServicePaid(client, type, p[SERVICES[type].payCol]);
    await client.query('COMMIT');
    logAudit(req, {
      action: 'delete', entity: 'payment', entityId: id,
      summary: `Xóa khoản ${p.kind === 'refund' ? 'hoàn' : 'thu'} ${Number(p.amount).toLocaleString('vi-VN')}₫${p.method === 'wallet' ? ' (ví)' : ''}`,
      details: { debtId: p.debt_id, passportId: p.passport_id, trainTicketId: p.train_ticket_id, tourId: p.tour_id, kind: p.kind },
    });
    res.json({ message: 'Payment deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete payment error:', error.message);
    res.status(500).json({ error: 'Failed to delete payment' });
  } finally {
    client.release();
  }
};

module.exports = { getPayments, createPayment, deletePayment };
