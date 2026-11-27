// controllers/debtController.js — công nợ vé máy bay.
const pool = require('../config/database');
const logger = require('../config/logger');
const { parseAmount, parseDate, upsertCustomer } = require('../utils/importHelpers');
const { todayLocal } = require('../utils/dates');
const { assertOwns } = require('../utils/ownership');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');
const ci = require('../utils/costItems');

const PAYMENT_TARGETS = ['self', 'agency'];
const TICKET_KINDS = ['normal', 'down']; // down = vé đạo / vé xuất giảm

// Kiểm tra + chuẩn hoá body tạo/sửa vé. Ném ValidationError (→ 400) khi sai.
function parseDebtBody(body) {
  return {
    customerName: v.str(body.customerName, { max: 255, required: true, label: 'Tên khách hàng' }),
    phoneNumber: v.str(body.phoneNumber, { max: 20, label: 'Số điện thoại' }),
    ticketCode: v.str(body.ticketCode, { max: 50, label: 'Mã vé' }),
    airline: v.str(body.airline, { max: 50, label: 'Hãng bay' }),
    route: v.str(body.route, { max: 50, label: 'Hành trình' }),
    flightDate: v.dateStr(body.flightDate, { label: 'Ngày bay' }),
    issueDate: v.dateStr(body.issueDate, { label: 'Ngày xuất vé' }),
    dueDate: v.dateStr(body.dueDate, { label: 'Hạn thanh toán' }),
    ticketSource: v.str(body.ticketSource, { max: 100, label: 'Nguồn xuất vé' }),
    ticketAmount: v.amount(body.ticketAmount, { required: true, label: 'Tiền vé' }),
    costAmount: v.amount(body.costAmount, { label: 'Giá gốc' }) ?? 0,
    paid: v.amount(body.paid, { label: 'Đã trả' }) ?? 0,
    notes: v.str(body.notes, { label: 'Ghi chú' }),
    companyId: v.int(body.companyId, { min: 1, label: 'Công ty' }),
    paymentTarget: v.oneOf(body.paymentTarget, PAYMENT_TARGETS, { label: 'Tài khoản nhận', fallback: 'self' }),
    // Dòng tiền v3: null = không gửi (sửa: giữ nguyên).
    ticketKind: v.oneOf(body.ticketKind, TICKET_KINDS, { label: 'Loại vé' }),
    ...ci.parseMoneyFields(body),
  };
}

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
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.debt_id = d.id AND p.payment_target = 'agency'), 0) AS agency_paid,
              ${ci.costItemsSelectSql('debt', 'd')}
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
  const d = parseDebtBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (d.companyId !== null && !(await assertOwns(client, 'companies', d.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    await ci.assertAccount(client, d.accountId, req.user.id);
    const customerId = await upsertCustomer(client, req.user.id, {
      name: d.customerName, phone: d.phoneNumber, type: 'individual',
    });
    const issueDate = d.issueDate || todayLocal();
    const result = await client.query(
      `INSERT INTO debts (
        user_id, customer_id, customer_name, phone_number, ticket_code, airline, route,
        flight_date, issue_date, due_date, ticket_source, ticket_amount, cost_amount, paid, notes, company_id,
        ticket_kind, cost_pending
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        req.user.id, customerId, d.customerName, d.phoneNumber || '', d.ticketCode || '', d.airline || '', d.route || '',
        d.flightDate, issueDate, d.dueDate,
        d.ticketSource, d.ticketAmount, d.costAmount, d.paid, d.notes || '',
        d.companyId, d.ticketKind || 'normal', d.costPending === true,
      ]
    );
    // Tạo payment record nếu có số tiền đã trả (để track payment_target + tài khoản nhận).
    if (d.paid > 0) {
      await client.query(
        `INSERT INTO payments (user_id, debt_id, amount, payment_date, method, payment_target, account_id)
         VALUES ($1, $2, $3, $4, 'cash', $5, $6)`,
        [req.user.id, result.rows[0].id, d.paid, issueDate, d.paymentTarget, d.accountId]
      );
    }
    const costSummary = await ci.applyCostItems(client, req.user.id, 'debt', result.rows[0].id, d.costItems);
    const row = await ci.loadServiceRow(client, 'debt', result.rows[0].id);
    await client.query('COMMIT');
    logAudit(req, { action: 'create', entity: 'debt', entityId: row.id, summary: `Tạo vé ${row.ticket_code || ''} cho ${row.customer_name}`, details: { ticketAmount: d.ticketAmount, paid: d.paid } });
    ci.auditCostItems(req, 'debt', row.id, costSummary);
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create debt error:', error.message);
    res.status(500).json({ error: 'Failed to create debt' });
  } finally {
    client.release();
  }
};

// Update debt — cập nhật lại liên kết khách hàng theo tên/SĐT mới.
const updateDebt = async (req, res) => {
  const id = v.idParam(req.params.id);
  const d = parseDebtBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (d.companyId !== null && !(await assertOwns(client, 'companies', d.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const customerId = await upsertCustomer(client, req.user.id, {
      name: d.customerName, phone: d.phoneNumber, type: 'individual',
    });
    // KHÔNG cập nhật cột `paid` và KHÔNG đụng bảng payments ở đây:
    // `paid` là tổng suy ra từ payments (xem recomputePaid). Tiền trả thêm
    // được ghi nhận qua màn hình Thanh toán để giữ nguyên lịch sử/audit trail.
    // cost_amount: không gửi khoá costAmount → giữ nguyên (không vô tình về 0);
    // ticket_kind / cost_pending: không gửi → giữ nguyên. Có dòng giá vốn thì
    // applyCostItems ghi đè cost_amount = tổng các dòng.
    const result = await client.query(
      `UPDATE debts SET
        customer_id = $2, customer_name = $3, phone_number = $4, ticket_code = $5,
        airline = $6, route = $7, flight_date = $8, issue_date = $9, due_date = $10,
        ticket_source = $11, ticket_amount = $12, cost_amount = COALESCE($13, cost_amount), notes = $14, company_id = $15,
        ticket_kind = COALESCE($17, ticket_kind), cost_pending = COALESCE($18, cost_pending)
      WHERE id = $1 AND user_id = $16
      RETURNING id`,
      [
        id, customerId, d.customerName, d.phoneNumber, d.ticketCode, d.airline || '', d.route, d.flightDate,
        d.issueDate, d.dueDate, d.ticketSource, d.ticketAmount, d.costAmountSent ? d.costAmount : null, d.notes, d.companyId, req.user.id,
        d.ticketKind, d.costPending,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Debt not found' });
    }
    const costSummary = await ci.applyCostItems(client, req.user.id, 'debt', id, d.costItems);
    const row = await ci.loadServiceRow(client, 'debt', id);
    await client.query('COMMIT');
    logAudit(req, { action: 'update', entity: 'debt', entityId: id, summary: `Sửa vé ${d.ticketCode || ''} của ${d.customerName}` });
    ci.auditCostItems(req, 'debt', id, costSummary);
    res.json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Update debt error:', error.message);
    res.status(500).json({ error: 'Failed to update debt' });
  } finally {
    client.release();
  }
};

// Delete debt
const deleteDebt = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM debts WHERE id = $1 AND user_id = $2 RETURNING id, customer_name, ticket_code',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Debt not found' });
    }

    const row = result.rows[0];
    logAudit(req, { action: 'delete', entity: 'debt', entityId: id, summary: `Xóa vé ${row.ticket_code || ''} của ${row.customer_name}` });
    res.json({ message: 'Debt deleted' });
  } catch (error) {
    logger.error('Delete debt error:', error.message);
    res.status(500).json({ error: 'Failed to delete debt' });
  }
};

// Đánh dấu đã/chưa check-in online cho khách.
const setCheckin = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const { checkedIn } = req.body;
    const result = await pool.query(
      'UPDATE debts SET checked_in = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [!!checkedIn, id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Debt not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Set checkin error:', error.message);
    res.status(500).json({ error: 'Failed to update check-in' });
  }
};

// Xóa nhiều bản ghi cùng lúc (chỉ xóa của chính mình). payments tự xóa theo (ON DELETE CASCADE).
const bulkDeleteDebts = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    }
    const result = await pool.query(
      'DELETE FROM debts WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    if (result.rows.length > 0) {
      logAudit(req, { action: 'delete', entity: 'debt', summary: `Xóa ${result.rows.length} vé`, details: { ids: result.rows.map((r) => r.id) } });
    }
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete debts error:', error.message);
    res.status(500).json({ error: 'Failed to delete debts' });
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
      if (!Number.isFinite(amount) || amount < 0) {
        errors.push({ row: line, message: `Số tiền vé không hợp lệ: "${row.ticketAmount}"` });
        return;
      }
      const paid = parseAmount(row.paid);
      if (!Number.isFinite(paid) || paid < 0) {
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
        customerName: name.slice(0, 255),
        phoneNumber: (row.phoneNumber || '').toString().trim().slice(0, 20),
        ticketCode: (row.ticketCode || '').toString().trim().slice(0, 50),
        airline: (row.airline || '').toString().trim().slice(0, 50),
        route: (row.route || '').toString().trim().slice(0, 50),
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
        const issueDate = d.issueDate || todayLocal();
        const ins = await client.query(
          `INSERT INTO debts (
            user_id, customer_id, customer_name, phone_number, ticket_code, airline, route,
            flight_date, issue_date, ticket_amount, paid, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [
            req.user.id, customerId, d.customerName, d.phoneNumber, d.ticketCode, d.airline, d.route,
            d.flightDate, issueDate, d.ticketAmount, d.paid, d.notes,
          ]
        );
        // Khoản đã trả trong file → 1 dòng payments để sổ thanh toán khớp cột paid.
        if (d.paid > 0) {
          await client.query(
            `INSERT INTO payments (user_id, debt_id, amount, payment_date, method, payment_target, notes)
             VALUES ($1, $2, $3, $4, 'cash', 'self', 'Import từ file')`,
            [req.user.id, ins.rows[0].id, d.paid, issueDate]
          );
        }
        inserted += 1;
      }
      await client.query('COMMIT');
      logAudit(req, { action: 'create', entity: 'debt', summary: `Import ${inserted} vé từ file`, details: { inserted, failed: errors.length } });
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
  setCheckin,
  bulkDeleteDebts,
  importDebts,
};
