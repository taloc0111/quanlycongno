// controllers/customerController.js
const pool = require('../config/database');
const logger = require('../config/logger');

// Lấy danh sách khách hàng kèm công nợ còn lại (tổng vé + hộ chiếu - đã trả).
const getCustomers = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT c.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE(d.outstanding, 0) + COALESCE(p.outstanding, 0) AS outstanding
       FROM customers c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN (
         SELECT customer_id, SUM(ticket_amount - paid) AS outstanding
         FROM debts WHERE user_id = ANY($1) GROUP BY customer_id
       ) d ON d.customer_id = c.id
       LEFT JOIN (
         SELECT customer_id, SUM(total_amount - paid_amount) AS outstanding
         FROM passports WHERE user_id = ANY($1) GROUP BY customer_id
       ) p ON p.customer_id = c.id
       WHERE c.user_id = ANY($1)
       ORDER BY c.name`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get customers error:', error.message);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
};

const createCustomer = async (req, res) => {
  try {
    const { name, phone, email, address, idNumber, type, creditLimit, notes, birthday, companyId } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên khách hàng là bắt buộc' });

    // Chỉ gắn company_id khi là khách loại công ty.
    const linkedCompany = type === 'company' ? (companyId || null) : null;
    const result = await pool.query(
      `INSERT INTO customers (user_id, name, phone, email, address, id_number, type, credit_limit, notes, birthday, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, name, phone || null, email || null, address || null,
       idNumber || null, type || 'individual', creditLimit || 0, notes || null, birthday || null, linkedCompany]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Đã có khách hàng với số điện thoại này' });
    }
    logger.error('Create customer error:', error.message);
    res.status(500).json({ error: 'Failed to create customer' });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, address, idNumber, type, creditLimit, notes, birthday, companyId } = req.body;

    const linkedCompany = type === 'company' ? (companyId || null) : null;
    const result = await pool.query(
      `UPDATE customers SET
         name=$2, phone=$3, email=$4, address=$5, id_number=$6, type=$7, credit_limit=$8, notes=$9, birthday=$10, company_id=$11
       WHERE id=$1 AND user_id=$12 RETURNING *`,
      [id, name, phone || null, email || null, address || null,
       idNumber || null, type || 'individual', creditLimit || 0, notes || null, birthday || null, linkedCompany, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update customer error:', error.message);
    res.status(500).json({ error: 'Failed to update customer' });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM customers WHERE id=$1 AND user_id=$2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    logger.error('Delete customer error:', error.message);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
};

// Import danh bạ khách hàng từ Excel/CSV. Bỏ qua trùng SĐT (không lỗi).
const importCustomers = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Không có dữ liệu để import' });
    }

    const errors = [];
    const valid = [];
    rows.forEach((row, i) => {
      const line = i + 2;
      const name = (row.name || '').toString().trim();
      if (!name) {
        errors.push({ row: line, message: 'Thiếu tên khách hàng' });
        return;
      }
      valid.push({
        name,
        phone: (row.phone || '').toString().trim() || null,
        email: (row.email || '').toString().trim() || null,
        address: (row.address || '').toString().trim() || null,
        idNumber: (row.idNumber || '').toString().trim() || null,
        type: (row.type || 'individual').toString().trim(),
      });
    });

    if (valid.length === 0) {
      return res.status(400).json({ inserted: 0, errors, error: 'Tất cả các dòng đều lỗi' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      let skipped = 0;
      for (const c of valid) {
        // Bỏ qua nếu đã có khách CÙNG tên VÀ cùng SĐT.
        const exists = c.phone
          ? await client.query('SELECT 1 FROM customers WHERE user_id=$1 AND name=$2 AND phone=$3', [req.user.id, c.name, c.phone])
          : await client.query('SELECT 1 FROM customers WHERE user_id=$1 AND name=$2 AND phone IS NULL', [req.user.id, c.name]);
        if (exists.rows.length > 0) { skipped += 1; continue; }
        await client.query(
          `INSERT INTO customers (user_id, name, phone, email, address, id_number, type)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.user.id, c.name, c.phone, c.email, c.address, c.idNumber, c.type]
        );
        inserted += 1;
      }
      await client.query('COMMIT');
      res.status(201).json({ inserted, skipped, failed: errors.length, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Import customers error:', error.message);
    res.status(500).json({ error: 'Import thất bại: ' + error.message });
  }
};

module.exports = {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomers,
};
