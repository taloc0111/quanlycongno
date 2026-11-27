// controllers/customerController.js — danh bạ khách hàng + trang chi tiết khách.
const pool = require('../config/database');
const logger = require('../config/logger');
const { assertOwns } = require('../utils/ownership');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

const TYPES = ['individual', 'company'];

// Kiểm tra + chuẩn hoá body tạo/sửa khách. Ném ValidationError (→ 400) khi sai.
function parseCustomerBody(body) {
  const type = v.oneOf(body.type, TYPES, { label: 'Loại khách', fallback: 'individual' });
  return {
    name: v.str(body.name, { max: 255, required: true, label: 'Tên khách hàng' }),
    phone: v.str(body.phone, { max: 20, label: 'Số điện thoại' }),
    email: v.str(body.email, { max: 255, label: 'Email' }),
    address: v.str(body.address, { label: 'Địa chỉ' }),
    idNumber: v.str(body.idNumber, { max: 50, label: 'Số CCCD/CMND' }),
    type,
    creditLimit: v.amount(body.creditLimit, { label: 'Hạn mức nợ' }) ?? 0,
    notes: v.str(body.notes, { label: 'Ghi chú' }),
    birthday: v.dateStr(body.birthday, { label: 'Ngày sinh' }),
    // Chỉ gắn company_id khi là khách loại công ty.
    companyId: type === 'company' ? v.int(body.companyId, { min: 1, label: 'Công ty' }) : null,
  };
}

// Lấy danh sách khách hàng kèm công nợ còn lại (vé máy bay + hộ chiếu + vé tàu + tour − đã trả).
const getCustomers = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT c.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE(d.outstanding, 0) + COALESCE(p.outstanding, 0)
              + COALESCE(tr.outstanding, 0) + COALESCE(tu.outstanding, 0) AS outstanding
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
       LEFT JOIN (
         SELECT customer_id, SUM(ticket_amount - paid) AS outstanding
         FROM train_tickets WHERE user_id = ANY($1) GROUP BY customer_id
       ) tr ON tr.customer_id = c.id
       LEFT JOIN (
         SELECT customer_id, SUM(sell_amount - paid) AS outstanding
         FROM tours WHERE user_id = ANY($1) GROUP BY customer_id
       ) tu ON tu.customer_id = c.id
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

// Chi tiết 1 khách: mọi giao dịch (4 loại) + sổ thanh toán + tổng hợp. Xem được trong
// phạm vi (khách của mình hoặc của đại lý con). ?from=&to= lọc theo ngày giao dịch
// (issue_date; hộ chiếu theo service_date).
const getCustomerDetail = async (req, res) => {
  const id = v.idParam(req.params.id);
  const from = v.dateStr(req.query.from, { label: 'Từ ngày' });
  const to = v.dateStr(req.query.to, { label: 'Đến ngày' });
  try {
    const cust = await pool.query(
      `SELECT c.*, u.full_name AS owner_name, u.username AS owner_username
       FROM customers c JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 AND c.user_id = ANY($2)`,
      [id, req.scope.userIds]
    );
    const customer = cust.rows[0];
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Điều kiện ngày dùng chung: $2 = from, $3 = to (NULL = không lọc).
    const range = (col) => `AND ($2::date IS NULL OR ${col} >= $2) AND ($3::date IS NULL OR ${col} <= $3)`;
    const params = [id, from, to];

    const [debts, passports, trainTickets, tours] = await Promise.all([
      pool.query(`SELECT * FROM debts WHERE customer_id = $1 ${range('issue_date')} ORDER BY issue_date DESC, id DESC`, params),
      pool.query(`SELECT * FROM passports WHERE customer_id = $1 ${range('service_date')} ORDER BY service_date DESC, id DESC`, params),
      pool.query(`SELECT * FROM train_tickets WHERE customer_id = $1 ${range('issue_date')} ORDER BY issue_date DESC, id DESC`, params),
      pool.query(`SELECT * FROM tours WHERE customer_id = $1 ${range('issue_date')} ORDER BY issue_date DESC, id DESC`, params),
    ]);

    // Sổ thanh toán: mọi payment gắn với giao dịch của khách này (theo khoảng ngày của giao dịch).
    const payments = await pool.query(
      `SELECT p.*,
              CASE WHEN p.debt_id IS NOT NULL THEN 'debt'
                   WHEN p.passport_id IS NOT NULL THEN 'passport'
                   WHEN p.train_ticket_id IS NOT NULL THEN 'train'
                   ELSE 'tour' END AS type,
              COALESCE(d.ticket_code, ps.passport_number, tr.train_no, tu.tour_name) AS target_label
       FROM payments p
       LEFT JOIN debts d          ON d.id = p.debt_id
       LEFT JOIN passports ps     ON ps.id = p.passport_id
       LEFT JOIN train_tickets tr ON tr.id = p.train_ticket_id
       LEFT JOIN tours tu         ON tu.id = p.tour_id
       WHERE (d.customer_id = $1 AND ($2::date IS NULL OR d.issue_date >= $2) AND ($3::date IS NULL OR d.issue_date <= $3))
          OR (ps.customer_id = $1 AND ($2::date IS NULL OR ps.service_date >= $2) AND ($3::date IS NULL OR ps.service_date <= $3))
          OR (tr.customer_id = $1 AND ($2::date IS NULL OR tr.issue_date >= $2) AND ($3::date IS NULL OR tr.issue_date <= $3))
          OR (tu.customer_id = $1 AND ($2::date IS NULL OR tu.issue_date >= $2) AND ($3::date IS NULL OR tu.issue_date <= $3))
       ORDER BY p.payment_date DESC, p.id DESC`,
      params
    );

    const sum = (rows, col) => rows.reduce((s, r) => s + Number(r[col] || 0), 0);
    const sold = sum(debts.rows, 'ticket_amount') + sum(passports.rows, 'total_amount') + sum(trainTickets.rows, 'ticket_amount') + sum(tours.rows, 'sell_amount');
    const cost = sum(debts.rows, 'cost_amount') + sum(passports.rows, 'cost_amount') + sum(trainTickets.rows, 'cost_amount') + sum(tours.rows, 'cost_amount');
    const paid = sum(debts.rows, 'paid') + sum(passports.rows, 'paid_amount') + sum(trainTickets.rows, 'paid') + sum(tours.rows, 'paid');

    res.json({
      customer,
      debts: debts.rows,
      passports: passports.rows,
      trainTickets: trainTickets.rows,
      tours: tours.rows,
      payments: payments.rows,
      totals: { sold, cost, paid, outstanding: sold - paid },
    });
  } catch (error) {
    logger.error('Get customer detail error:', error.message);
    res.status(500).json({ error: 'Failed to fetch customer detail' });
  }
};

const createCustomer = async (req, res) => {
  const c = parseCustomerBody(req.body);
  try {
    if (c.companyId !== null && !(await assertOwns(pool, 'companies', c.companyId, req.user.id))) {
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const result = await pool.query(
      `INSERT INTO customers (user_id, name, phone, email, address, id_number, type, credit_limit, notes, birthday, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, c.name, c.phone, c.email, c.address, c.idNumber, c.type, c.creditLimit, c.notes, c.birthday, c.companyId]
    );
    const row = result.rows[0];
    logAudit(req, { action: 'create', entity: 'customer', entityId: row.id, summary: `Tạo khách ${row.name}` });
    res.status(201).json(row);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Đã có khách hàng với số điện thoại này' });
    }
    logger.error('Create customer error:', error.message);
    res.status(500).json({ error: 'Failed to create customer' });
  }
};

const updateCustomer = async (req, res) => {
  const id = v.idParam(req.params.id);
  const c = parseCustomerBody(req.body);
  try {
    if (c.companyId !== null && !(await assertOwns(pool, 'companies', c.companyId, req.user.id))) {
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const result = await pool.query(
      `UPDATE customers SET
         name=$2, phone=$3, email=$4, address=$5, id_number=$6, type=$7, credit_limit=$8, notes=$9, birthday=$10, company_id=$11
       WHERE id=$1 AND user_id=$12 RETURNING *`,
      [id, c.name, c.phone, c.email, c.address, c.idNumber, c.type, c.creditLimit, c.notes, c.birthday, c.companyId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    logAudit(req, { action: 'update', entity: 'customer', entityId: id, summary: `Sửa khách ${c.name}` });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update customer error:', error.message);
    res.status(500).json({ error: 'Failed to update customer' });
  }
};

const deleteCustomer = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM customers WHERE id=$1 AND user_id=$2 RETURNING id, name',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    logAudit(req, { action: 'delete', entity: 'customer', entityId: id, summary: `Xóa khách ${result.rows[0].name}` });
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    logger.error('Delete customer error:', error.message);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
};

// Xóa nhiều khách hàng cùng lúc (chỉ của chính mình).
const bulkDeleteCustomers = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    }
    const result = await pool.query(
      'DELETE FROM customers WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    if (result.rows.length > 0) {
      logAudit(req, { action: 'delete', entity: 'customer', summary: `Xóa ${result.rows.length} khách`, details: { ids: result.rows.map((r) => r.id) } });
    }
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete customers error:', error.message);
    res.status(500).json({ error: 'Failed to delete customers' });
  }
};

// Import danh bạ khách hàng từ Excel/CSV. Bỏ qua trùng (tên + SĐT), không lỗi.
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
      const type = (row.type || 'individual').toString().trim();
      valid.push({
        name: name.slice(0, 255),
        phone: (row.phone || '').toString().trim().slice(0, 20) || null,
        email: (row.email || '').toString().trim().slice(0, 255) || null,
        address: (row.address || '').toString().trim() || null,
        idNumber: (row.idNumber || '').toString().trim().slice(0, 50) || null,
        type: TYPES.includes(type) ? type : 'individual',
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
      logAudit(req, { action: 'create', entity: 'customer', summary: `Import ${inserted} khách từ file`, details: { inserted, skipped, failed: errors.length } });
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
  getCustomerDetail,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  bulkDeleteCustomers,
  importCustomers,
};
