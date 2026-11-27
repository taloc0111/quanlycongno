// controllers/invoiceController.js — Hóa đơn.
const pool = require('../config/database');
const logger = require('../config/logger');
const { assertOwns } = require('../utils/ownership');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

const STATUSES = ['unpaid', 'partial', 'paid', 'cancelled'];

// Kiểm tra danh sách dòng hoá đơn → [{ debtId, description, quantity, unitPrice, amount }] + subtotal.
function parseItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new v.ValidationError('Hóa đơn cần ít nhất 1 dòng');
  const lines = items.map((it, i) => {
    const row = it && typeof it === 'object' ? it : {};
    const qty = v.num(row.quantity, { min: 0, label: `Số lượng dòng ${i + 1}` }) ?? 1;
    const price = v.amount(row.unitPrice, { label: `Đơn giá dòng ${i + 1}` }) ?? 0;
    return {
      debtId: v.int(row.debtId, { min: 1, label: `Vé ở dòng ${i + 1}` }),
      description: v.str(row.description, { label: `Mô tả dòng ${i + 1}` }) ?? '',
      quantity: qty,
      unitPrice: price,
      amount: qty * price,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, subtotal };
}

// Kiểm tra customerId/companyId/debtId của các dòng đều thuộc user đang ghi. Trả thông báo lỗi hoặc null.
async function checkRefs(client, userId, { customerId, companyId, lines }) {
  if (customerId !== null && customerId !== undefined && !(await assertOwns(client, 'customers', customerId, userId))) {
    return 'Khách hàng không hợp lệ';
  }
  if (companyId !== null && companyId !== undefined && !(await assertOwns(client, 'companies', companyId, userId))) {
    return 'Công ty không hợp lệ';
  }
  for (const l of lines || []) {
    if (l.debtId !== null && !(await assertOwns(client, 'debts', l.debtId, userId))) {
      return `Vé #${l.debtId} không hợp lệ`;
    }
  }
  return null;
}

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
  const id = v.idParam(req.params.id);
  try {
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
  const invoiceNumber = v.str(req.body.invoiceNumber, { max: 50, required: true, label: 'Số hóa đơn' });
  const customerId = v.int(req.body.customerId, { min: 1, label: 'Khách hàng' });
  const companyId = v.int(req.body.companyId, { min: 1, label: 'Công ty' });
  const issueDate = v.dateStr(req.body.issueDate, { label: 'Ngày lập' });
  const dueDate = v.dateStr(req.body.dueDate, { label: 'Hạn thanh toán' });
  const tax = v.amount(req.body.taxAmount, { label: 'Thuế' }) ?? 0;
  const notes = v.str(req.body.notes, { label: 'Ghi chú' });
  const status = v.oneOf(req.body.status, STATUSES, { label: 'Trạng thái', fallback: 'unpaid' });
  const { lines, subtotal } = parseItems(req.body.items);
  const total = subtotal + tax;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const refErr = await checkRefs(client, req.user.id, { customerId, companyId, lines });
    if (refErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: refErr });
    }
    const inv = await client.query(
      `INSERT INTO invoices (user_id, invoice_number, customer_id, company_id, issue_date, due_date,
         subtotal, tax_amount, total_amount, notes, status)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [req.user.id, invoiceNumber, customerId, companyId, issueDate, dueDate, subtotal, tax, total, notes, status]
    );
    const invoiceId = inv.rows[0].id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, debt_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [invoiceId, l.debtId, l.description, l.quantity, l.unitPrice, l.amount]
      );
    }
    await client.query('COMMIT');
    logAudit(req, { action: 'create', entity: 'invoice', entityId: invoiceId, summary: `Lập hóa đơn ${invoiceNumber}`, details: { total, items: lines.length } });
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

// Cập nhật từng phần: field không gửi = giữ nguyên; gửi null = xoá (due_date/notes/customer/company);
// gửi `items` = thay toàn bộ dòng và tính lại subtotal/total trong 1 transaction.
const updateInvoice = async (req, res) => {
  const id = v.idParam(req.params.id);
  const b = req.body;
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

  const sets = [];
  const params = [id, req.user.id];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  const status = has('status') ? v.oneOf(b.status, STATUSES, { required: true, label: 'Trạng thái' }) : undefined;
  const customerId = has('customerId') ? v.int(b.customerId, { min: 1, label: 'Khách hàng' }) : undefined;
  const companyId = has('companyId') ? v.int(b.companyId, { min: 1, label: 'Công ty' }) : undefined;
  const parsed = has('items') ? parseItems(b.items) : null;
  const tax = has('taxAmount') ? (v.amount(b.taxAmount, { label: 'Thuế' }) ?? 0) : undefined;

  if (status !== undefined) push('status', status);
  if (has('invoiceNumber')) push('invoice_number', v.str(b.invoiceNumber, { max: 50, required: true, label: 'Số hóa đơn' }));
  if (customerId !== undefined) push('customer_id', customerId);
  if (companyId !== undefined) push('company_id', companyId);
  if (has('issueDate')) push('issue_date', v.dateStr(b.issueDate, { required: true, label: 'Ngày lập' }));
  if (has('dueDate')) push('due_date', v.dateStr(b.dueDate, { label: 'Hạn thanh toán' }));
  if (has('notes')) push('notes', v.str(b.notes, { label: 'Ghi chú' }));
  if (parsed) push('subtotal', parsed.subtotal);
  if (tax !== undefined) push('tax_amount', tax);
  if (sets.length === 0) return res.status(400).json({ error: 'Không có trường nào để cập nhật' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const refErr = await checkRefs(client, req.user.id, { customerId, companyId, lines: parsed ? parsed.lines : [] });
    if (refErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: refErr });
    }
    const result = await client.query(
      `UPDATE invoices SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (parsed) {
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
      for (const l of parsed.lines) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, debt_id, description, quantity, unit_price, amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, l.debtId, l.description, l.quantity, l.unitPrice, l.amount]
        );
      }
    }
    // total luôn = subtotal + tax sau khi cập nhật (dù đổi items hay chỉ đổi thuế).
    const final = await client.query(
      `UPDATE invoices SET total_amount = subtotal + tax_amount WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    const row = final.rows[0];
    logAudit(req, { action: 'update', entity: 'invoice', entityId: id, summary: `Sửa hóa đơn ${row.invoice_number}`, details: { fields: sets.map((s) => s.split(' =')[0]) } });
    res.json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Số hóa đơn đã tồn tại' });
    }
    logger.error('Update invoice error:', error.message);
    res.status(500).json({ error: 'Failed to update invoice' });
  } finally {
    client.release();
  }
};

const deleteInvoice = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id, invoice_number',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    logAudit(req, { action: 'delete', entity: 'invoice', entityId: id, summary: `Xóa hóa đơn ${result.rows[0].invoice_number}` });
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    logger.error('Delete invoice error:', error.message);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
};

module.exports = { getInvoices, getInvoice, createInvoice, updateInvoice, deleteInvoice };
