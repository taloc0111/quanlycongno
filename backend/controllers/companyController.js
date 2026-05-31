// controllers/companyController.js
const pool = require('../config/database');

const getCompanies = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM companies WHERE user_id = $1 ORDER BY name',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
};

const createCompany = async (req, res) => {
  try {
    const { name, taxCode, address, email, contactPerson, phone, creditLimit } = req.body;

    const result = await pool.query(
      `INSERT INTO companies (user_id, name, tax_code, address, email, contact_person, phone, credit_limit)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [req.user.id, name, taxCode, address, email, contactPerson, phone, creditLimit || 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Failed to create company' });
  }
};

const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, taxCode, address, email, contactPerson, phone, creditLimit } = req.body;

    const result = await pool.query(
      `UPDATE companies SET
        name = $2, tax_code = $3, address = $4, email = $5,
        contact_person = $6, phone = $7, credit_limit = $8
      WHERE id = $1 AND user_id = $9
      RETURNING *`,
      [id, name, taxCode, address, email, contactPerson, phone, creditLimit || 0, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Failed to update company' });
  }
};

const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      'DELETE FROM companies WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({ message: 'Company deleted' });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ error: 'Failed to delete company' });
  }
};

module.exports = { getCompanies, createCompany, updateCompany, deleteCompany };