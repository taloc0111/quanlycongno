// controllers/trainTicketController.js — công nợ vé tàu hỏa (tương tự debtController).
const pool = require('../config/database');
const logger = require('../config/logger');
const { upsertCustomer } = require('../utils/importHelpers');

const getTrainTickets = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT t.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.train_ticket_id = t.id AND p.payment_target = 'agency'), 0) AS agency_paid
       FROM train_tickets t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ANY($1)
       ORDER BY t.issue_date DESC, t.id DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get train tickets error:', error.message);
    res.status(500).json({ error: 'Failed to fetch train tickets' });
  }
};

const createTrainTicket = async (req, res) => {
  const {
    customerName, phoneNumber, trainNo, route, seatClass, departDate,
    issueDate, dueDate, ticketSource, ticketAmount, costAmount, paid, notes, companyId, paymentTarget,
  } = req.body;

  if (!customerName || !ticketAmount) {
    return res.status(400).json({ error: 'Cần tên khách và giá vé' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, {
      name: customerName, phone: phoneNumber, type: 'individual',
    });
    const paidAmt = parseFloat(paid) || 0;
    const result = await client.query(
      `INSERT INTO train_tickets (
        user_id, customer_id, customer_name, phone_number, train_no, route, seat_class,
        depart_date, issue_date, due_date, ticket_source, ticket_amount, cost_amount, paid, notes, company_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        req.user.id, customerId, customerName, phoneNumber || '', trainNo || '', route || '', seatClass || '',
        departDate || null, issueDate || new Date().toISOString().split('T')[0], dueDate || null,
        ticketSource || null, parseFloat(ticketAmount) || 0, parseFloat(costAmount) || 0, paidAmt, notes || '',
        companyId || null,
      ]
    );
    // Khoản trả trước → tạo 1 payment để có audit trail + track payment_target.
    if (paidAmt > 0) {
      const target = ['self', 'agency'].includes(paymentTarget) ? paymentTarget : 'self';
      await client.query(
        `INSERT INTO payments (user_id, train_ticket_id, amount, payment_date, method, payment_target)
         VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), 'cash', $5)`,
        [req.user.id, result.rows[0].id, paidAmt, issueDate || null, target]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create train ticket error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create train ticket' });
  } finally {
    client.release();
  }
};

const updateTrainTicket = async (req, res) => {
  const { id } = req.params;
  const {
    customerName, phoneNumber, trainNo, route, seatClass, departDate,
    issueDate, dueDate, ticketSource, ticketAmount, costAmount, notes, companyId,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, {
      name: customerName, phone: phoneNumber, type: 'individual',
    });
    // Không đụng cột paid/payments — tiền trả thêm ghi qua màn Thanh toán.
    const result = await client.query(
      `UPDATE train_tickets SET
        customer_id = $2, customer_name = $3, phone_number = $4, train_no = $5, route = $6, seat_class = $7,
        depart_date = $8, issue_date = $9, due_date = $10, ticket_source = $11,
        ticket_amount = $12, cost_amount = $13, notes = $14, company_id = $15
      WHERE id = $1 AND user_id = $16
      RETURNING *`,
      [
        id, customerId, customerName, phoneNumber, trainNo || '', route, seatClass || '',
        departDate, issueDate, dueDate || null, ticketSource || null,
        ticketAmount, parseFloat(costAmount) || 0, notes, companyId || null, req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Train ticket not found' });
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Update train ticket error:', error.message);
    res.status(500).json({ error: 'Failed to update train ticket' });
  } finally {
    client.release();
  }
};

const deleteTrainTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM train_tickets WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Train ticket not found' });
    res.json({ message: 'Train ticket deleted' });
  } catch (error) {
    logger.error('Delete train ticket error:', error.message);
    res.status(500).json({ error: 'Failed to delete train ticket' });
  }
};

const bulkDeleteTrainTickets = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    }
    const result = await pool.query(
      'DELETE FROM train_tickets WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete train tickets error:', error.message);
    res.status(500).json({ error: 'Failed to delete train tickets' });
  }
};

module.exports = { getTrainTickets, createTrainTicket, updateTrainTicket, deleteTrainTicket, bulkDeleteTrainTickets };
