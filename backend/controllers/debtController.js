// controllers/debtController.js
const pool = require('../config/database');
const logger = require('../config/logger');
const { parseAmount, parseDate, upsertCustomer } = require('../utils/importHelpers');

// Get all debts for user
const getDebts = async (req, res) => {
  try {
    // Phạm vi: mình + đại lý con (admin = tất cả). Lọc theo 1 đại lý nếu có ?agencyId.
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT d.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.debt_id = d.id AND p.payment_target = 'agency'), 0) AS agency_paid
       FROM debts d JOIN users u ON u.id = d.user_id
       WHERE d.user_id = ANY($1)
       ORDER BY d.issue_date DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get debts error:', error.message);
    res.status(500).json({ error: 'Failed to fetch debts' });
  }
};

// Create new debt — tự tạo/liên kết khách hàng (customer_id).
const createDebt = async (req, res) => {
  const {
    customerName, phoneNumber, ticketCode, airline, route, flightDate,
    issueDate, dueDate, ticketAmount, costAmount, paid, notes, companyId, paymentTarget
  } = req.body;

  if (!customerName || !ticketAmount) {
    return res.status(400).json({ error: 'Customer name and ticket amount required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, {
      name: customerName, phone: phoneNumber, type: 'individual',
    });
    const paidAmt = parseFloat(paid) || 0;
    const result = await client.query(
      `INSERT INTO debts (
        user_id, customer_id, customer_name, phone_number, ticket_code, airline, route,
        flight_date, issue_date, due_date, ticket_amount, cost_amount, paid, notes, company_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        req.user.id, customerId, customerName, phoneNumber || '', ticketCode || '', airline || '', route || '',
        flightDate || null, issueDate || new Date().toISOString().split('T')[0], dueDate || null,
        parseFloat(ticketAmount) || 0, parseFloat(costAmount) || 0, paidAmt, notes || '',
        companyId || null,
      ]
    );
    // Tạo payment record nếu có số tiền đã trả (để track payment_target).
    if (paidAmt > 0) {
      const target = ['self', 'agency'].includes(paymentTarget) ? paymentTarget : 'self';
      await client.query(
        `INSERT INTO payments (user_id, debt_id, amount, payment_date, method, payment_target)
         VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), 'cash', $5)`,
        [req.user.id, result.rows[0].id, paidAmt, issueDate || null, target]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create debt error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create debt' });
  } finally {
    client.release();
  }
};

// Update debt — cập nhật lại liên kết khách hàng theo tên/SĐT mới.
const updateDebt = async (req, res) => {
  const { id } = req.params;
  const {
    customerName, phoneNumber, ticketCode, airline, route, flightDate,
    issueDate, dueDate, ticketAmount, costAmount, notes, companyId
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const customerId = await upsertCustomer(client, req.user.id, {
      name: customerName, phone: phoneNumber, type: 'individual',
    });
    // KHÔNG cập nhật cột `paid` và KHÔNG đụng bảng payments ở đây:
    // `paid` là tổng suy ra từ payments (xem recomputePaid). Tiền trả thêm
    // được ghi nhận qua màn hình Thanh toán để giữ nguyên lịch sử/audit trail.
    const result = await client.query(
      `UPDATE debts SET
        customer_id = $2, customer_name = $3, phone_number = $4, ticket_code = $5,
        airline = $6, route = $7, flight_date = $8, issue_date = $9, due_date = $10,
        ticket_amount = $11, cost_amount = $12, notes = $13, company_id = $14
      WHERE id = $1 AND user_id = $15
      RETURNING *`,
      [
        id, customerId, customerName, phoneNumber, ticketCode, airline || '', route, flightDate,
        issueDate, dueDate || null, ticketAmount, parseFloat(costAmount) || 0, notes, companyId || null, req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Debt not found' });
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Update debt error:', error.message);
    res.status(500).json({ error: 'Failed to update debt' });
  } finally {
    client.release();
  }
};

// Delete debt
const deleteDebt = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM debts WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Debt not found' });
    }

    res.json({ message: 'Debt deleted' });
  } catch (error) {
    console.error('Delete debt error:', error);
    res.status(500).json({ error: 'Failed to delete debt' });
  }
};

// Bulk import debts
const bulkCreateDebts = async (req, res) => {
  try {
    const { debts } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const results = [];
      for (const debt of debts) {
        const customerId = await upsertCustomer(client, req.user.id, {
          name: debt.customerName, phone: debt.phoneNumber, type: 'individual',
        });
        const result = await client.query(
          `INSERT INTO debts (
            user_id, customer_id, customer_name, phone_number, ticket_code, airline, route,
            flight_date, issue_date, ticket_amount, paid, notes, company_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING *`,
          [
            req.user.id, customerId, debt.customerName, debt.phoneNumber, debt.ticketCode, debt.airline || '', debt.route,
            debt.flightDate, debt.issueDate, debt.ticketAmount, debt.paid, debt.notes, debt.companyId || null
          ]
        );
        results.push(result.rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json({ count: results.length, debts: results });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Bulk create error:', error.message);
    res.status(500).json({ error: 'Failed to bulk import debts' });
  }
};

// Import nhiều dòng nợ từ Excel/CSV: validate trước, chỉ insert dòng hợp lệ,
// trả về số dòng thành công + danh sách lỗi theo từng dòng.
const importDebts = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu để import' });
    }

    const errors = [];
    const valid = [];

    rows.forEach((row, i) => {
      const line = i + 2; // +2: dòng 1 là header trong Excel
      const name = (row.customerName || '').toString().trim();
      if (!name) {
        errors.push({ row: line, message: 'Thiếu tên khách hàng' });
        return;
      }
      const amount = parseAmount(row.ticketAmount);
      if (!Number.isFinite(amount)) {
        errors.push({ row: line, message: `Số tiền vé không hợp lệ: "${row.ticketAmount}"` });
        return;
      }
      const paid = parseAmount(row.paid);
      if (!Number.isFinite(paid)) {
        errors.push({ row: line, message: `Số tiền đã trả không hợp lệ: "${row.paid}"` });
        return;
      }
      const issueDate = parseDate(row.issueDate);
      const flightDate = parseDate(row.flightDate);
      if (issueDate === undefined || flightDate === undefined) {
        errors.push({ row: line, message: 'Ngày sai định dạng (dùng dd/mm/yyyy)' });
        return;
      }
      valid.push({
        customerName: name,
        phoneNumber: (row.phoneNumber || '').toString().trim(),
        ticketCode: (row.ticketCode || '').toString().trim(),
        airline: (row.airline || '').toString().trim(),
        route: (row.route || '').toString().trim(),
        flightDate,
        issueDate,
        ticketAmount: amount,
        paid,
        notes: (row.notes || '').toString().trim(),
      });
    });

    if (valid.length === 0) {
      return res.status(400).json({ inserted: 0, errors, error: 'Tất cả các dòng đều lỗi' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const d of valid) {
        const customerId = await upsertCustomer(client, req.user.id, {
          name: d.customerName,
          phone: d.phoneNumber,
          type: 'individual',
        });
        await client.query(
          `INSERT INTO debts (
            user_id, customer_id, customer_name, phone_number, ticket_code, airline, route,
            flight_date, issue_date, ticket_amount, paid, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            req.user.id, customerId, d.customerName, d.phoneNumber, d.ticketCode, d.airline, d.route,
            d.flightDate, d.issueDate, d.ticketAmount, d.paid, d.notes,
          ]
        );
        inserted += 1;
      }
      await client.query('COMMIT');
      res.status(201).json({ inserted, failed: errors.length, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Import debts error:', error.message);
    res.status(500).json({ error: 'Import thất bại: ' + error.message });
  }
};

module.exports = {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  bulkCreateDebts,
  importDebts,
};