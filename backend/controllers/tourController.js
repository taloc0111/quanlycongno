// controllers/tourController.js — nghiệp vụ Du lịch (bán tour, công nợ + lợi nhuận).
const pool = require('../config/database');
const logger = require('../config/logger');
const { upsertCustomer } = require('../utils/importHelpers');

const STATUSES = ['consulting', 'deposited', 'completed', 'cancelled'];

const getTours = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT t.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.tour_id = t.id AND p.payment_target = 'agency'), 0) AS agency_paid
       FROM tours t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ANY($1)
       ORDER BY t.issue_date DESC, t.id DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get tours error:', error.message);
    res.status(500).json({ error: 'Failed to fetch tours' });
  }
};

const createTour = async (req, res) => {
  const {
    customerName, phoneNumber, tourName, departDate, returnDate, pax,
    issueDate, dueDate, source, sellAmount, costAmount, paid, status, notes, companyId, paymentTarget,
  } = req.body;
  if (!customerName || !sellAmount) return res.status(400).json({ error: 'Cần tên khách và giá bán' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, { name: customerName, phone: phoneNumber, type: 'individual' });
    const paidAmt = parseFloat(paid) || 0;
    const safeStatus = STATUSES.includes(status) ? status : 'deposited';
    const result = await client.query(
      `INSERT INTO tours (
        user_id, customer_id, customer_name, phone_number, tour_name, depart_date, return_date, pax,
        issue_date, due_date, source, sell_amount, cost_amount, paid, status, notes, company_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        req.user.id, customerId, customerName, phoneNumber || '', tourName || '', departDate || null, returnDate || null,
        parseInt(pax, 10) || 1, issueDate || new Date().toISOString().split('T')[0], dueDate || null, source || null,
        parseFloat(sellAmount) || 0, parseFloat(costAmount) || 0, paidAmt, safeStatus, notes || '', companyId || null,
      ]
    );
    if (paidAmt > 0) {
      const target = ['self', 'agency'].includes(paymentTarget) ? paymentTarget : 'self';
      await client.query(
        `INSERT INTO payments (user_id, tour_id, amount, payment_date, method, payment_target)
         VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), 'cash', $5)`,
        [req.user.id, result.rows[0].id, paidAmt, issueDate || null, target]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create tour error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create tour' });
  } finally {
    client.release();
  }
};

const updateTour = async (req, res) => {
  const { id } = req.params;
  const {
    customerName, phoneNumber, tourName, departDate, returnDate, pax,
    issueDate, dueDate, source, sellAmount, costAmount, status, notes, companyId,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, { name: customerName, phone: phoneNumber, type: 'individual' });
    // Không đụng cột paid/payments — tiền trả thêm ghi qua màn Thanh toán.
    const result = await client.query(
      `UPDATE tours SET
        customer_id = $2, customer_name = $3, phone_number = $4, tour_name = $5, depart_date = $6, return_date = $7,
        pax = $8, issue_date = $9, due_date = $10, source = $11, sell_amount = $12, cost_amount = $13,
        status = COALESCE($14, status), notes = $15, company_id = $16
      WHERE id = $1 AND user_id = $17
      RETURNING *`,
      [
        id, customerId, customerName, phoneNumber, tourName || '', departDate || null, returnDate || null,
        parseInt(pax, 10) || 1, issueDate, dueDate || null, source || null,
        parseFloat(sellAmount) || 0, parseFloat(costAmount) || 0,
        STATUSES.includes(status) ? status : null, notes, companyId || null, req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tour not found' });
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Update tour error:', error.message);
    res.status(500).json({ error: 'Failed to update tour' });
  } finally {
    client.release();
  }
};

const deleteTour = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tours WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tour not found' });
    res.json({ message: 'Tour deleted' });
  } catch (error) {
    logger.error('Delete tour error:', error.message);
    res.status(500).json({ error: 'Failed to delete tour' });
  }
};

const bulkDeleteTours = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    const result = await pool.query(
      'DELETE FROM tours WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete tours error:', error.message);
    res.status(500).json({ error: 'Failed to delete tours' });
  }
};

module.exports = { getTours, createTour, updateTour, deleteTour, bulkDeleteTours };
