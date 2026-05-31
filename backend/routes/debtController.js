// controllers/debtController.js
const pool = require('../config/database');

// Get all debts for user
const getDebts = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM debts WHERE user_id = $1 ORDER BY service_date DESC, created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get debts error:', error);
    res.status(500).json({ error: 'Failed to fetch debts' });
  }
};

// Create new debt
const createDebt = async (req, res) => {
  try {
    const {
      customerName, phoneNumber, address, serviceDate,
      totalAmount, paidAmount, notes, companyId
    } = req.body;

    console.log('Creating debt with data:', {
      customerName, phoneNumber, address, serviceDate,
      totalAmount, paidAmount, notes
    });

    const result = await pool.query(
      `INSERT INTO debts (
        user_id, customer_name, phone_number, address, service_date,
        ticket_amount, paid, notes, company_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        req.user.id, 
        customerName, 
        phoneNumber, 
        address || '', 
        serviceDate,
        totalAmount, 
        paidAmount || 0, 
        notes || '', 
        companyId || null
      ]
    );

    console.log('✅ Debt created:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Create debt error:', error);
    res.status(500).json({ error: 'Failed to create debt: ' + error.message });
  }
};

// Update debt
const updateDebt = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerName, phoneNumber, address, serviceDate,
      totalAmount, paidAmount, notes, companyId
    } = req.body;

    const result = await pool.query(
      `UPDATE debts SET
        customer_name = $2, phone_number = $3, address = $4,
        service_date = $5, ticket_amount = $6, paid = $7,
        notes = $8, company_id = $9, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $10
      RETURNING *`,
      [
        id, 
        customerName, 
        phoneNumber, 
        address || '', 
        serviceDate,
        totalAmount, 
        paidAmount || 0, 
        notes || '', 
        companyId || null, 
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Debt not found' });
    }

    console.log('✅ Debt updated:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Update debt error:', error);
    res.status(500).json({ error: 'Failed to update debt: ' + error.message });
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

    console.log('✅ Debt deleted:', id);
    res.json({ message: 'Debt deleted' });
  } catch (error) {
    console.error('❌ Delete debt error:', error);
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
        const result = await client.query(
          `INSERT INTO debts (
            user_id, customer_name, phone_number, address, service_date,
            ticket_amount, paid, notes, company_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [
            req.user.id, 
            debt.customerName, 
            debt.phoneNumber, 
            debt.address || '', 
            debt.serviceDate,
            debt.totalAmount, 
            debt.paidAmount || 0, 
            debt.notes || '', 
            debt.companyId || null
          ]
        );
        results.push(result.rows[0]);
      }

      await client.query('COMMIT');
      console.log('✅ Bulk created:', results.length, 'debts');
      res.status(201).json({ count: results.length, debts: results });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Bulk create error:', error);
    res.status(500).json({ error: 'Failed to bulk import debts' });
  }
};

module.exports = {
  getDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  bulkCreateDebts
};