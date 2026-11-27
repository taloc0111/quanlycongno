// controllers/paymentController.js — Lịch sử thanh toán (sổ giao dịch).
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

// Tính lại cột paid/paid_amount = tổng các payment, để UI cũ vẫn dùng được.
async function recomputePaid(client, userId, { debtId, passportId, trainTicketId, tourId }) {
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
  } else if (tourId) {
    await client.query(
      `UPDATE tours SET paid = COALESCE(
         (SELECT SUM(amount) FROM payments WHERE tour_id = $1), 0)
       WHERE id = $1 AND user_id = $2`,
      [tourId, userId]
    );
  }
}

// GET /api/payments?debtId=  hoặc  ?passportId=  / ?trainTicketId=  / ?tourId=
const getPayments = async (req, res) => {
  try {
    const { debtId, passportId, trainTicketId, tourId } = req.query;
    // Xem được trong phạm vi (mình + đại lý con); ghi nhận thì giới hạn ở chính mình.
    const ids = req.scope.userIds;
    let result;
    if (debtId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND debt_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, v.idParam(debtId)]
      );
    } else if (passportId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND passport_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, v.idParam(passportId)]
      );
    } else if (trainTicketId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND train_ticket_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, v.idParam(trainTicketId)]
      );
    } else if (tourId) {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) AND tour_id = $2 ORDER BY payment_date DESC, id DESC',
        [ids, v.idParam(tourId)]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM payments WHERE user_id = ANY($1) ORDER BY payment_date DESC, id DESC LIMIT 200',
        [ids]
      );
    }
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Chỉ chủ sở hữu mới được ghi nhận thanh toán (cấp 1 chỉ xem dữ liệu cấp 2).
    const ownsSql = debtId
      ? ['SELECT customer_name FROM debts WHERE id = $1 AND user_id = $2', debtId]
      : passportId
        ? ['SELECT customer_name FROM passports WHERE id = $1 AND user_id = $2', passportId]
        : trainTicketId
          ? ['SELECT customer_name FROM train_tickets WHERE id = $1 AND user_id = $2', trainTicketId]
          : ['SELECT customer_name FROM tours WHERE id = $1 AND user_id = $2', tourId];
    const owns = await client.query(ownsSql[0], [ownsSql[1], req.user.id]);
    if (owns.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bạn chỉ có thể ghi nhận thanh toán cho dữ liệu của chính mình' });
    }

    const inserted = await client.query(
      `INSERT INTO payments (user_id, debt_id, passport_id, train_ticket_id, tour_id, amount, payment_date, method, notes, payment_target)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8, $9, $10)
       RETURNING *`,
      [req.user.id, debtId, passportId, trainTicketId, tourId, amt, paymentDate, method, notes, target]
    );
    await recomputePaid(client, req.user.id, { debtId, passportId, trainTicketId, tourId });
    await client.query('COMMIT');
    const row = inserted.rows[0];
    const entity = debtId ? 'debt' : passportId ? 'passport' : trainTicketId ? 'train_ticket' : 'tour';
    logAudit(req, {
      action: 'payment', entity: 'payment', entityId: row.id,
      summary: `Thu ${amt.toLocaleString('vi-VN')}₫ của ${owns.rows[0].customer_name}`,
      details: { targetEntity: entity, targetId: targets[0], amount: amt, paymentTarget: target },
    });
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create payment error:', error.message);
    res.status(500).json({ error: 'Failed to create payment' });
  } finally {
    client.release();
  }
};

const deletePayment = async (req, res) => {
  const id = v.idParam(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'DELETE FROM payments WHERE id = $1 AND user_id = $2 RETURNING debt_id, passport_id, train_ticket_id, tour_id, amount',
      [id, req.user.id]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }
    const { debt_id, passport_id, train_ticket_id, tour_id, amount } = found.rows[0];
    await recomputePaid(client, req.user.id, { debtId: debt_id, passportId: passport_id, trainTicketId: train_ticket_id, tourId: tour_id });
    await client.query('COMMIT');
    logAudit(req, {
      action: 'delete', entity: 'payment', entityId: id,
      summary: `Xóa khoản thu ${Number(amount).toLocaleString('vi-VN')}₫`,
      details: { debtId: debt_id, passportId: passport_id, trainTicketId: train_ticket_id, tourId: tour_id },
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
