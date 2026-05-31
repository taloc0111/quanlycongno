// controllers/passportController.js
const pool = require('../config/database');
const logger = require('../config/logger');
const { parseAmount, parseDate, upsertCustomer } = require('../utils/importHelpers');

// Get all passports for user
const getPassports = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT p.*, u.full_name AS owner_name, u.username AS owner_username
       FROM passports p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ANY($1)
       ORDER BY p.service_date DESC, p.created_at DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get passports error:', error.message);
    res.status(500).json({ error: 'Failed to fetch passports' });
  }
};

// Create new passport — tự tạo/liên kết khách hàng (customer_id).
const createPassport = async (req, res) => {
  const {
    passportNumber, customerName, phoneNumber, address, serviceDate,
    totalAmount, paidAmount, notes, companyId
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, {
      name: customerName, phone: phoneNumber, address, type: 'individual',
    });
    const result = await client.query(
      `INSERT INTO passports (
        user_id, customer_id, passport_number, customer_name, phone_number, address, service_date,
        total_amount, paid_amount, notes, company_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        req.user.id, customerId,
        passportNumber || '', customerName, phoneNumber, address || '', serviceDate,
        totalAmount, paidAmount || 0, notes || '', companyId || null,
      ]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create passport error:', error.message);
    res.status(500).json({ error: 'Failed to create passport: ' + error.message });
  } finally {
    client.release();
  }
};

// Update passport — cập nhật lại liên kết khách hàng theo tên/SĐT mới.
const updatePassport = async (req, res) => {
  const { id } = req.params;
  const {
    passportNumber, customerName, phoneNumber, address, serviceDate,
    totalAmount, paidAmount, notes, companyId
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerId = await upsertCustomer(client, req.user.id, {
      name: customerName, phone: phoneNumber, address, type: 'individual',
    });
    const result = await client.query(
      `UPDATE passports SET
        customer_id = $2, passport_number = $3, customer_name = $4, phone_number = $5, address = $6,
        service_date = $7, total_amount = $8, paid_amount = $9,
        notes = $10, company_id = $11, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $12
      RETURNING *`,
      [
        id, customerId,
        passportNumber || '', customerName, phoneNumber, address || '', serviceDate,
        totalAmount, paidAmount || 0, notes || '', companyId || null, req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Passport not found' });
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Update passport error:', error.message);
    res.status(500).json({ error: 'Failed to update passport: ' + error.message });
  } finally {
    client.release();
  }
};

// Delete passport
const deletePassport = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM passports WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Passport not found' });
    }

    console.log('✅ Passport deleted:', id);
    res.json({ message: 'Passport deleted' });
  } catch (error) {
    console.error('❌ Delete passport error:', error);
    res.status(500).json({ error: 'Failed to delete passport' });
  }
};

// Bulk import passports
const bulkCreatePassports = async (req, res) => {
  try {
    const { passports } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const results = [];
      for (const passport of passports) {
        const result = await client.query(
          `INSERT INTO passports (
            user_id, passport_number, customer_name, phone_number, address, service_date,
            total_amount, paid_amount, notes, company_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            req.user.id, 
            passport.passportNumber || '', 
            passport.customerName, 
            passport.phoneNumber, 
            passport.address || '', 
            passport.serviceDate,
            passport.totalAmount, 
            passport.paidAmount || 0, 
            passport.notes || '', 
            passport.companyId || null
          ]
        );
        results.push(result.rows[0]);
      }

      await client.query('COMMIT');
      console.log('✅ Bulk created:', results.length, 'passports');
      res.status(201).json({ count: results.length, passports: results });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Bulk create error:', error);
    res.status(500).json({ error: 'Failed to bulk import passports' });
  }
};

// Import nhiều hồ sơ hộ chiếu từ Excel/CSV.
const importPassports = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu để import' });
    }

    const errors = [];
    const valid = [];

    rows.forEach((row, i) => {
      const line = i + 2;
      const name = (row.customerName || '').toString().trim();
      if (!name) {
        errors.push({ row: line, message: 'Thiếu tên khách hàng' });
        return;
      }
      const total = parseAmount(row.totalAmount);
      if (!Number.isFinite(total)) {
        errors.push({ row: line, message: `Tổng tiền không hợp lệ: "${row.totalAmount}"` });
        return;
      }
      const paid = parseAmount(row.paidAmount);
      if (!Number.isFinite(paid)) {
        errors.push({ row: line, message: `Tiền đã trả không hợp lệ: "${row.paidAmount}"` });
        return;
      }
      const serviceDate = parseDate(row.serviceDate);
      if (!serviceDate) {
        errors.push({ row: line, message: 'Thiếu/sai ngày làm dịch vụ (dd/mm/yyyy)' });
        return;
      }
      valid.push({
        passportNumber: (row.passportNumber || '').toString().trim(),
        customerName: name,
        phoneNumber: (row.phoneNumber || '').toString().trim(),
        address: (row.address || '').toString().trim(),
        serviceDate,
        totalAmount: total,
        paidAmount: paid,
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
      for (const p of valid) {
        const customerId = await upsertCustomer(client, req.user.id, {
          name: p.customerName,
          phone: p.phoneNumber,
          address: p.address,
          type: 'individual',
        });
        await client.query(
          `INSERT INTO passports (
            user_id, customer_id, passport_number, customer_name, phone_number, address,
            service_date, total_amount, paid_amount, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            req.user.id, customerId, p.passportNumber, p.customerName, p.phoneNumber, p.address,
            p.serviceDate, p.totalAmount, p.paidAmount, p.notes,
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
    logger.error('Import passports error:', error.message);
    res.status(500).json({ error: 'Import thất bại: ' + error.message });
  }
};

module.exports = {
  getPassports,
  createPassport,
  updatePassport,
  deletePassport,
  bulkCreatePassports,
  importPassports,
};