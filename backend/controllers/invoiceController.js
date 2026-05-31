// controllers/invoiceController.js — Hóa đơn.
const pool = require('../config/database');
const logger = require('../config/logger');

const getInvoices = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT i.*, c.name AS customer_name, co.name AS company_name, u.full_name AS owner_name
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN companies co ON co.id = i.company_id
       WHERE i.user_id = ANY($1)
       ORDER BY i.issue_date DESC, i.id DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get invoices error:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

const getInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await pool.query(
      `SELECT i.*, c.name AS customer_name, co.name AS company_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN companies co ON co.id = i.company_id
       WHERE i.id = $1 AND i.user_id = ANY($2)`,
      [id, req.scope.userIds]
    );
    if (inv.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const items = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
      [id]
    );
    res.json({ ...inv.rows[0], items: items.rows });
  } catch (error) {
    logger.error('Get invoice error:', error.message);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
};

const createInvoice = async (req, res) => {
  const {
    invoiceNumber, customerId, companyId, issueDate, dueDate, taxAmount, notes, items,
  } = req.body;

  if (!invoiceNumber) return res.status(400).json({ error: 'Số hóa đơn là bắt buộc' });
  const lineItems = Array.isArray(items) ? items : [];
  if (lineItems.length === 0) return res.status(400).json({ error: 'Hóa đơn cần ít nhất 1 dòng' });

  const subtotal = lineItems.reduce(
    (s, it) => s + (parseFloat(it.quantity) || 1) * (parseFloat(it.unitPrice) || 0),
    0
  );
  const tax = parseFloat(taxAmount) || 0;
  const total = subtotal + tax;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await client.query(
      `INSERT INTO invoices (user_id, invoice_number, customer_id, company_id, issue_date, due_date,
         subtotal, tax_amount, total_amount, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.id, invoiceNumber, customerId || null, companyId || null,
       issueDate || null, dueDate || null, subtotal, tax, total, notes || null]
    );
    const invoiceId = inv.rows[0].id;
    for (const it of lineItems) {
      const qty = parseFloat(it.quantity) || 1;
      const price = parseFloat(it.unitPrice) || 0;
      await client.query(
        `INSERT INTO invoice_items (invoice_id, debt_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [invoiceId, it.debtId || null, it.description || '', qty, price, qty * price]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(inv.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Số hóa đơn đã tồn tại' });
    }
    logger.error('Create invoice error:', error.message);
    res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    client.release();
  }
};

const updateInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, dueDate, notes } = req.body;
    const result = await pool.query(
      `UPDATE invoices SET
         status = COALESCE($2, status),
         due_date = COALESCE($3, due_date),
         notes = COALESCE($4, notes)
       WHERE id = $1 AND user_id = $5 RETURNING *`,
      [id, status || null, dueDate || null, notes ?? null, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update invoice error:', error.message);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
};

const deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    logger.error('Delete invoice error:', error.message);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
};

module.exports = { getInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice };
