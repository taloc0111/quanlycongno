// controllers/paymentController.js — Lịch sử thanh toán (sổ giao dịch).
const pool = require('../config/database');
const logger = require('../config/logger');

// Tính lại cột paid/paid_amount = tổng các payment, để UI cũ vẫn dùng được.
async function recomputePaid(client, userId, { debtId, passportId, trainTicketId }) {
  if (debtId) {
    await client.query(
      `UPDATE debts SET paid = COALESCE(
         (SELECT SUM(amount) FROM payments WHERE debt_id = $1), 0)
       WHERE id = $1 AND user_id = $2`,
      [debtId, userId]
    );
  } else if (passportId) {
    await client.query(
      `UPDATE passports SET paid_amount = COALESCE(
         (SELECT SUM(amount) FROM payments WHERE passport_id = $1), 0)
       WHERE id = $1 AND user_id = $2`,
      [passportId, userId]
    );
  } else if (trainTicketId) {
    await client.query(
      `UPDATE train_tickets SET paid = COALESCE(
         (SELECT SUM(amount) FROM payments WHERE train_ticket_id = $1), 0)
       WHERE id = $1 AND user_id = $2`,
      [trainTicketId, userId]
    );
  }
}

// GET /api/payments?debtId=  hoặc  ?passportId=
const getPayments = async (req, res) => {
  try {
    const { debtId, passportId, trainTicketId } = req.query;
    // Xem được trong phạm vi (mình + đại lý con); ghi nhận thì giới hạn ở chính mình.
    const ids = req.scope.userIds;
    let result;
    if (debtId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND debt_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, debtId]
      );
    } else if (passportId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND passport_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, passportId]
      );
    } else if (trainTicketId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND train_ticket_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, trainTicketId]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) ORDER BY payment_date DESC, id DESC LIMIT 200',
        [ids]
      );
    }
    res.json(result.rows);
  } catch (error) {
    logger.error('Get payments error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

const createPayment = async (req, res) => {
  const { debtId, passportId, trainTicketId, amount, paymentDate, method, notes, paymentTarget } = req.body;

  const targets = [debtId, passportId, trainTicketId].filter(Boolean);
  if (targets.length !== 1) {
    return res.status(400).json({ error: 'Phải gắn với đúng 1 vé/hộ chiếu' });
  }
  const amt = parseFloat(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Số tiền thanh toán không hợp lệ' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Chỉ chủ sở hữu mới được ghi nhận thanh toán (cấp 1 chỉ xem dữ liệu cấp 2).
    const ownsSql = debtId
      ? ['SELECT 1 FROM debts WHERE id = $1 AND user_id = $2', debtId]
      : passportId
        ? ['SELECT 1 FROM passports WHERE id = $1 AND user_id = $2', passportId]
        : ['SELECT 1 FROM train_tickets WHERE id = $1 AND user_id = $2', trainTicketId];
    const owns = await client.query(ownsSql[0], [ownsSql[1], req.user.id]);
    if (owns.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bạn chỉ có thể ghi nhận thanh toán cho dữ liệu của chính mình' });
    }

    const target = ['self', 'agency'].includes(paymentTarget) ? paymentTarget : 'self';
    const inserted = await client.query(
      `INSERT INTO payments (user_id, debt_id, passport_id, train_ticket_id, amount, payment_date, method, notes, payment_target)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8, $9)
       RETURNING *`,
      [req.user.id, debtId || null, passportId || null, trainTicketId || null, amt, paymentDate || null, method || null, notes || null, target]
    );
    await recomputePaid(client, req.user.id, { debtId, passportId, trainTicketId });
    await client.query('COMMIT');
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create payment error:', error.message);
    res.status(500).json({ error: 'Failed to create payment' });
  } finally {
    client.release();
  }
};

const deletePayment = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'DELETE FROM payments WHERE id = $1 AND user_id = $2 RETURNING debt_id, passport_id, train_ticket_id',
      [id, req.user.id]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }
    const { debt_id, passport_id, train_ticket_id } = found.rows[0];
    await recomputePaid(client, req.user.id, { debtId: debt_id, passportId: passport_id, trainTicketId: train_ticket_id });
    await client.query('COMMIT');
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
