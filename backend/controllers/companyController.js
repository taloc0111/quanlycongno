// controllers/companyController.js — công ty / đại lý B2B (riêng theo user).
const pool = require('../config/database');
const logger = require('../config/logger');
const v = require('../utils/validate');

// Kiểm tra + chuẩn hoá body tạo/sửa công ty. Ném ValidationError (→ 400) khi sai.
function parseCompanyBody(body) {
  return {
    name: v.str(body.name, { max: 255, required: true, label: 'Tên công ty' }),
    taxCode: v.str(body.taxCode, { max: 50, label: 'Mã số thuế' }),
    address: v.str(body.address, { label: 'Địa chỉ' }),
    email: v.str(body.email, { max: 255, label: 'Email' }),
    contactPerson: v.str(body.contactPerson, { max: 255, label: 'Người liên hệ' }),
    phone: v.str(body.phone, { max: 20, label: 'Số điện thoại' }),
    creditLimit: v.amount(body.creditLimit, { label: 'Hạn mức nợ' }) ?? 0,
  };
}

const getCompanies = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM companies WHERE user_id = $1 ORDER BY name',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get companies error:', error.message);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
};

const createCompany = async (req, res) => {
  const c = parseCompanyBody(req.body);
  try {
    const result = await pool.query(
      `INSERT INTO companies (user_id, name, tax_code, address, email, contact_person, phone, credit_limit)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [req.user.id, c.name, c.taxCode, c.address, c.email, c.contactPerson, c.phone, c.creditLimit]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create company error:', error.message);
    res.status(500).json({ error: 'Failed to create company' });
  }
};

const updateCompany = async (req, res) => {
  const id = v.idParam(req.params.id);
  const c = parseCompanyBody(req.body);
  try {
    const result = await pool.query(
      `UPDATE companies SET
        name = $2, tax_code = $3, address = $4, email = $5,
        contact_person = $6, phone = $7, credit_limit = $8
      WHERE id = $1 AND user_id = $9
      RETURNING *`,
      [id, c.name, c.taxCode, c.address, c.email, c.contactPerson, c.phone, c.creditLimit, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update company error:', error.message);
    res.status(500).json({ error: 'Failed to update company' });
  }
};

const deleteCompany = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM companies WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json({ message: 'Company deleted' });
  } catch (error) {
    logger.error('Delete company error:', error.message);
    res.status(500).json({ error: 'Failed to delete company' });
  }
};

module.exports = { getCompanies, createCompany, updateCompany, deleteCompany };
