// controllers/supplierController.js — Nhà cung cấp (F1, người làm down, khác) + tiền trả NCC.
// balance = tổng giá vốn gắn NCC − tổng đã trả NCC = mình còn nợ họ (âm = NCC đang giữ tiền của mình, v3.1).
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { assertAccount, recomputeCostItemPaid } = require('../utils/costItems');
const { targetLabelSql, targetTypeSql, targetJoinsSql, fmtVnd } = require('../utils/money');
const { todayLocal } = require('../utils/dates');
const v = require('../utils/validate');

const KINDS = ['f1', 'down', 'other'];
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const FIELDS = {
  name: { col: 'name', parse: (x) => v.str(x, { max: 255, required: true, label: 'Tên nhà cung cấp' }) },
  kind: { col: 'kind', parse: (x) => v.oneOf(x, KINDS, { label: 'Loại nhà cung cấp', fallback: 'other' }) },
  phone: { col: 'phone', parse: (x) => v.str(x, { max: 20, label: 'Số điện thoại' }) },
  notes: { col: 'notes', parse: (x) => v.str(x, { label: 'Ghi chú' }) },
};

// Danh sách NCC kèm tổng giá vốn / đã trả / còn nợ. $1 = mảng user_id; extraWhere lọc thêm trên s.
function supplierListSql(extraWhere = '') {
  return `
    SELECT s.*, u.full_name AS owner_name,
           COALESCE(c.total_cost, 0) AS total_cost,
           COALESCE(p.total_paid, 0) AS total_paid,
           COALESCE(c.total_cost, 0) - COALESCE(p.total_paid, 0) AS balance,
           COALESCE(c.items_count, 0)::int AS items_count,
           COALESCE(c.unpaid_items, 0)::int AS unpaid_items
      FROM suppliers s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN (
        SELECT supplier_id, SUM(amount) AS total_cost, COUNT(*) AS items_count,
               COUNT(*) FILTER (WHERE amount > paid_amount) AS unpaid_items
          FROM cost_items WHERE supplier_id IS NOT NULL GROUP BY supplier_id
      ) c ON c.supplier_id = s.id
      LEFT JOIN (
        SELECT supplier_id, SUM(amount) AS total_paid FROM supplier_payments GROUP BY supplier_id
      ) p ON p.supplier_id = s.id
     WHERE s.user_id = ANY($1) ${extraWhere}`;
}

const getSuppliers = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId)) ? [Number(agencyId)] : req.scope.userIds;
    const result = await pool.query(`${supplierListSql()} ORDER BY s.name, s.id`, [ids]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get suppliers error:', error.message);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
};

const createSupplier = async (req, res) => {
  const vals = {};
  for (const [key, f] of Object.entries(FIELDS)) vals[f.col] = f.parse(req.body[key]);
  try {
    const ins = await pool.query(
      'INSERT INTO suppliers (user_id, name, kind, phone, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.user.id, vals.name, vals.kind, vals.phone, vals.notes]
    );
    const id = ins.rows[0].id;
    const row = (await pool.query(supplierListSql('AND s.id = $2'), [[req.user.id], id])).rows[0];
    logAudit(req, { action: 'create', entity: 'supplier', entityId: id, summary: `Tạo nhà cung cấp ${vals.name}`, details: { kind: vals.kind } });
    res.status(201).json(row);
  } catch (error) {
    logger.error('Create supplier error:', error.message);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
};

// PUT /api/suppliers/:id — từng phần.
const updateSupplier = async (req, res) => {
  const id = v.idParam(req.params.id);
  const sets = [];
  const params = [id, req.user.id];
  const changed = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    if (!has(req.body, key)) continue;
    const val = f.parse(req.body[key]);
    params.push(val);
    sets.push(`${f.col} = $${params.length}`);
    changed[key] = val;
  }
  try {
    const exists = await pool.query('SELECT name FROM suppliers WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    if (sets.length > 0) {
      await pool.query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, params);
      logAudit(req, { action: 'update', entity: 'supplier', entityId: id, summary: `Sửa nhà cung cấp ${changed.name || exists.rows[0].name}`, details: changed });
    }
    const row = (await pool.query(supplierListSql('AND s.id = $2'), [[req.user.id], id])).rows[0];
    res.json(row);
  } catch (error) {
    logger.error('Update supplier error:', error.message);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
};

// DELETE /api/suppliers/:id — chặn khi còn dòng giá vốn hoặc thanh toán (không để mất lịch sử).
const deleteSupplier = async (req, res) => {
  const id = v.idParam(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query('SELECT name FROM suppliers WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, req.user.id]);
    if (s.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    }
    const used = await client.query(
      `SELECT EXISTS (SELECT 1 FROM cost_items WHERE supplier_id = $1)
           OR EXISTS (SELECT 1 FROM supplier_payments WHERE supplier_id = $1) AS used`,
      [id]
    );
    if (used.rows[0].used) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nhà cung cấp đã có giá vốn hoặc thanh toán, không xoá được' });
    }
    await client.query('DELETE FROM suppliers WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    await client.query('COMMIT');
    logAudit(req, { action: 'delete', entity: 'supplier', entityId: id, summary: `Xóa nhà cung cấp ${s.rows[0].name}` });
    res.json({ message: 'Supplier deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete supplier error:', error.message);
    res.status(500).json({ error: 'Failed to delete supplier' });
  } finally {
    client.release();
  }
};

// GET /api/suppliers/:id/ledger — dòng giá vốn + thanh toán của 1 NCC.
const getSupplierLedger = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const sup = await pool.query(supplierListSql('AND s.id = $2'), [req.scope.userIds, id]);
    const supplier = sup.rows[0];
    if (!supplier) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });

    const [items, payments] = await Promise.all([
      pool.query(
        `SELECT ci.id, ci.label, ci.kind, ci.amount, ci.paid_amount, ci.due_date, ci.created_at,
                ${targetTypeSql('ci')} AS target_type,
                COALESCE(ci.debt_id, ci.passport_id, ci.train_ticket_id, ci.tour_id) AS target_id,
                COALESCE(d.customer_name, ps.customer_name, tr.customer_name, tu.customer_name) AS customer_name,
                ${targetLabelSql()} AS target_label
           FROM cost_items ci ${targetJoinsSql('ci')}
          WHERE ci.supplier_id = $1
          ORDER BY ci.created_at DESC, ci.id DESC`,
        [id]
      ),
      pool.query(
        `SELECT sp.id, sp.amount, sp.pay_date, sp.account_id, a.name AS account_name,
                sp.cost_item_id, ci.label AS cost_item_label, sp.reconciled, sp.notes
           FROM supplier_payments sp
           LEFT JOIN money_accounts a ON a.id = sp.account_id
           LEFT JOIN cost_items ci ON ci.id = sp.cost_item_id
          WHERE sp.supplier_id = $1
          ORDER BY sp.pay_date DESC, sp.id DESC`,
        [id]
      ),
    ]);

    res.json({
      supplier,
      items: items.rows.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.kind, // v3.1: cost | refund (NCC hoàn, âm) | change (phí đổi)
        amount: r.amount,
        paid_amount: r.paid_amount,
        due_date: r.due_date,
        created_at: r.created_at,
        target: { type: r.target_type, id: r.target_id, customer_name: r.customer_name, label: r.target_label },
      })),
      payments: payments.rows,
      total_cost: supplier.total_cost,
      total_paid: supplier.total_paid,
      balance: supplier.balance,
    });
  } catch (error) {
    logger.error('Get supplier ledger error:', error.message);
    res.status(500).json({ error: 'Failed to fetch supplier ledger' });
  }
};

// POST /api/suppliers/:id/payments { amount*>0, payDate, accountId, costItemId, notes, direction: 'out'|'in' }
// direction 'in' (v3.1) = NCC trả lại tiền cho mình → lưu amount ÂM (tiền VÀO tài khoản).
const createSupplierPayment = async (req, res) => {
  const id = v.idParam(req.params.id);
  const amount = v.num(req.body.amount, { required: true, label: 'Số tiền' });
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  const payDate = v.dateStr(req.body.payDate, { label: 'Ngày trả' }) || todayLocal();
  const accountId = v.int(req.body.accountId, { min: 1, label: 'Tài khoản' });
  const costItemId = v.int(req.body.costItemId, { min: 1, label: 'Dòng giá vốn' });
  const notes = v.str(req.body.notes, { label: 'Ghi chú' });
  const direction = v.oneOf(req.body.direction, ['out', 'in'], { label: 'Chiều tiền', fallback: 'out' });
  const signed = direction === 'in' ? -amount : amount;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sup = await client.query('SELECT name FROM suppliers WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (sup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    }
    await assertAccount(client, accountId, req.user.id);
    if (costItemId !== null) {
      // Dòng giá vốn phải thuộc chính NCC này (và của mình). Khoá dòng để tính lại paid_amount an toàn.
      const item = await client.query(
        'SELECT id FROM cost_items WHERE id = $1 AND supplier_id = $2 AND user_id = $3 FOR UPDATE',
        [costItemId, id, req.user.id]
      );
      if (item.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Dòng giá vốn không thuộc nhà cung cấp này' });
      }
    }
    const ins = await client.query(
      `INSERT INTO supplier_payments (user_id, supplier_id, cost_item_id, account_id, amount, pay_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, id, costItemId, accountId, signed, payDate, notes]
    );
    await recomputeCostItemPaid(client, costItemId);
    await client.query('COMMIT');
    const row = ins.rows[0];
    logAudit(req, {
      action: 'payment', entity: 'supplier_payment', entityId: row.id,
      summary: direction === 'in' ? `Nhận lại từ ${sup.rows[0].name} ${fmtVnd(amount)}` : `Trả ${sup.rows[0].name} ${fmtVnd(amount)}`,
      details: { supplierId: id, costItemId, accountId, amount: signed, direction },
    });
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create supplier payment error:', error.message);
    res.status(500).json({ error: 'Failed to create supplier payment' });
  } finally {
    client.release();
  }
};

// DELETE /api/suppliers/payments/:paymentId — tính lại paid_amount của dòng giá vốn liên quan.
const deleteSupplierPayment = async (req, res) => {
  const paymentId = v.idParam(req.params.paymentId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query(
      'DELETE FROM supplier_payments WHERE id = $1 AND user_id = $2 RETURNING supplier_id, cost_item_id, amount',
      [paymentId, req.user.id]
    );
    if (del.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy khoản trả' });
    }
    const { supplier_id, cost_item_id, amount } = del.rows[0];
    await recomputeCostItemPaid(client, cost_item_id);
    await client.query('COMMIT');
    logAudit(req, {
      action: 'delete', entity: 'supplier_payment', entityId: paymentId,
      summary: `Xóa khoản trả NCC ${fmtVnd(amount)}`,
      details: { supplierId: supplier_id, costItemId: cost_item_id },
    });
    res.json({ message: 'Supplier payment deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete supplier payment error:', error.message);
    res.status(500).json({ error: 'Failed to delete supplier payment' });
  } finally {
    client.release();
  }
};

module.exports = {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierLedger,
  createSupplierPayment,
  deleteSupplierPayment,
};
