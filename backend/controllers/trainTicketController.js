// controllers/trainTicketController.js — công nợ vé tàu hỏa (tương tự debtController).
const pool = require('../config/database');
const logger = require('../config/logger');
const { parseAmount, parseDate, upsertCustomer } = require('../utils/importHelpers');
const { todayLocal } = require('../utils/dates');
const { assertOwns } = require('../utils/ownership');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

const PAYMENT_TARGETS = ['self', 'agency'];

// Kiểm tra + chuẩn hoá body tạo/sửa vé tàu. Ném ValidationError (→ 400) khi sai.
function parseTrainBody(body) {
  return {
    customerName: v.str(body.customerName, { max: 255, required: true, label: 'Tên khách hàng' }),
    phoneNumber: v.str(body.phoneNumber, { max: 20, label: 'Số điện thoại' }),
    trainNo: v.str(body.trainNo, { max: 50, label: 'Số tàu' }),
    route: v.str(body.route, { max: 100, label: 'Hành trình' }),
    seatClass: v.str(body.seatClass, { max: 100, label: 'Loại chỗ' }),
    departDate: v.dateStr(body.departDate, { label: 'Ngày đi' }),
    issueDate: v.dateStr(body.issueDate, { label: 'Ngày xuất vé' }),
    dueDate: v.dateStr(body.dueDate, { label: 'Hạn thanh toán' }),
    ticketSource: v.str(body.ticketSource, { max: 100, label: 'Nguồn xuất vé' }),
    ticketAmount: v.amount(body.ticketAmount, { required: true, label: 'Giá vé' }),
    costAmount: v.amount(body.costAmount, { label: 'Giá gốc' }) ?? 0,
    paid: v.amount(body.paid, { label: 'Đã trả' }) ?? 0,
    notes: v.str(body.notes, { label: 'Ghi chú' }),
    companyId: v.int(body.companyId, { min: 1, label: 'Công ty' }),
    paymentTarget: v.oneOf(body.paymentTarget, PAYMENT_TARGETS, { label: 'Tài khoản nhận', fallback: 'self' }),
  };
}

const getTrainTickets = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT t.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.train_ticket_id = t.id AND p.payment_target = 'agency'), 0) AS agency_paid
       FROM train_tickets t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ANY($1)
       ORDER BY t.issue_date DESC, t.id DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get train tickets error:', error.message);
    res.status(500).json({ error: 'Failed to fetch train tickets' });
  }
};

const createTrainTicket = async (req, res) => {
  const t = parseTrainBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (t.companyId !== null && !(await assertOwns(client, 'companies', t.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const customerId = await upsertCustomer(client, req.user.id, {
      name: t.customerName, phone: t.phoneNumber, type: 'individual',
    });
    const issueDate = t.issueDate || todayLocal();
    const result = await client.query(
      `INSERT INTO train_tickets (
        user_id, customer_id, customer_name, phone_number, train_no, route, seat_class,
        depart_date, issue_date, due_date, ticket_source, ticket_amount, cost_amount, paid, notes, company_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        req.user.id, customerId, t.customerName, t.phoneNumber || '', t.trainNo || '', t.route || '', t.seatClass || '',
        t.departDate, issueDate, t.dueDate,
        t.ticketSource, t.ticketAmount, t.costAmount, t.paid, t.notes || '',
        t.companyId,
      ]
    );
    // Khoản trả trước → tạo 1 payment để có audit trail + track payment_target.
    if (t.paid > 0) {
      await client.query(
        `INSERT INTO payments (user_id, train_ticket_id, amount, payment_date, method, payment_target)
         VALUES ($1, $2, $3, $4, 'cash', $5)`,
        [req.user.id, result.rows[0].id, t.paid, issueDate, t.paymentTarget]
      );
    }
    await client.query('COMMIT');
    const row = result.rows[0];
    logAudit(req, { action: 'create', entity: 'train_ticket', entityId: row.id, summary: `Tạo vé tàu ${row.train_no || ''} cho ${row.customer_name}`, details: { ticketAmount: t.ticketAmount, paid: t.paid } });
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create train ticket error:', error.message);
    res.status(500).json({ error: 'Failed to create train ticket' });
  } finally {
    client.release();
  }
};

const updateTrainTicket = async (req, res) => {
  const id = v.idParam(req.params.id);
  const t = parseTrainBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (t.companyId !== null && !(await assertOwns(client, 'companies', t.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const customerId = await upsertCustomer(client, req.user.id, {
      name: t.customerName, phone: t.phoneNumber, type: 'individual',
    });
    // Không đụng cột paid/payments — tiền trả thêm ghi qua màn Thanh toán.
    const result = await client.query(
      `UPDATE train_tickets SET
        customer_id = $2, customer_name = $3, phone_number = $4, train_no = $5, route = $6, seat_class = $7,
        depart_date = $8, issue_date = $9, due_date = $10, ticket_source = $11,
        ticket_amount = $12, cost_amount = $13, notes = $14, company_id = $15
      WHERE id = $1 AND user_id = $16
      RETURNING *`,
      [
        id, customerId, t.customerName, t.phoneNumber, t.trainNo || '', t.route, t.seatClass || '',
        t.departDate, t.issueDate, t.dueDate, t.ticketSource,
        t.ticketAmount, t.costAmount, t.notes, t.companyId, req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Train ticket not found' });
    }
    await client.query('COMMIT');
    logAudit(req, { action: 'update', entity: 'train_ticket', entityId: id, summary: `Sửa vé tàu ${t.trainNo || ''} của ${t.customerName}` });
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Update train ticket error:', error.message);
    res.status(500).json({ error: 'Failed to update train ticket' });
  } finally {
    client.release();
  }
};

const deleteTrainTicket = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM train_tickets WHERE id = $1 AND user_id = $2 RETURNING id, customer_name, train_no',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Train ticket not found' });
    const row = result.rows[0];
    logAudit(req, { action: 'delete', entity: 'train_ticket', entityId: id, summary: `Xóa vé tàu ${row.train_no || ''} của ${row.customer_name}` });
    res.json({ message: 'Train ticket deleted' });
  } catch (error) {
    logger.error('Delete train ticket error:', error.message);
    res.status(500).json({ error: 'Failed to delete train ticket' });
  }
};

const bulkDeleteTrainTickets = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    }
    const result = await pool.query(
      'DELETE FROM train_tickets WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    if (result.rows.length > 0) {
      logAudit(req, { action: 'delete', entity: 'train_ticket', summary: `Xóa ${result.rows.length} vé tàu`, details: { ids: result.rows.map((r) => r.id) } });
    }
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete train tickets error:', error.message);
    res.status(500).json({ error: 'Failed to delete train tickets' });
  }
};

// Import vé tàu từ Excel/CSV (giống importDebts): validate từng dòng, insert dòng hợp lệ
// trong 1 transaction, tạo payments khi có tiền đã trả.
const importTrainTickets = async (req, res) => {
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
      const amount = parseAmount(row.ticketAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        errors.push({ row: line, message: `Giá vé không hợp lệ: "${row.ticketAmount}"` });
        return;
      }
      const cost = parseAmount(row.costAmount);
      if (!Number.isFinite(cost) || cost < 0) {
        errors.push({ row: line, message: `Giá gốc không hợp lệ: "${row.costAmount}"` });
        return;
      }
      const paid = parseAmount(row.paid);
      if (!Number.isFinite(paid) || paid < 0) {
        errors.push({ row: line, message: `Số tiền đã trả không hợp lệ: "${row.paid}"` });
        return;
      }
      const departDate = parseDate(row.departDate);
      const issueDate = parseDate(row.issueDate);
      if (departDate === undefined || issueDate === undefined) {
        errors.push({ row: line, message: 'Ngày sai định dạng (dùng dd/mm/yyyy)' });
        return;
      }
      valid.push({
        customerName: name.slice(0, 255),
        phoneNumber: (row.phoneNumber || '').toString().trim().slice(0, 20),
        trainNo: (row.trainNo || '').toString().trim().slice(0, 50),
        route: (row.route || '').toString().trim().slice(0, 100),
        seatClass: (row.seatClass || '').toString().trim().slice(0, 100),
        departDate,
        issueDate,
        ticketAmount: amount,
        costAmount: cost,
        paid,
        notes: (row.notes || '').toString().trim(),
        ticketSource: (row.ticketSource || '').toString().trim().slice(0, 100) || null,
      });
    });

    if (valid.length === 0) {
      return res.status(400).json({ inserted: 0, errors, error: 'Tất cả các dòng đều lỗi' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const t of valid) {
        const customerId = await upsertCustomer(client, req.user.id, {
          name: t.customerName, phone: t.phoneNumber, type: 'individual',
        });
        const issueDate = t.issueDate || todayLocal();
        const ins = await client.query(
          `INSERT INTO train_tickets (
            user_id, customer_id, customer_name, phone_number, train_no, route, seat_class,
            depart_date, issue_date, ticket_source, ticket_amount, cost_amount, paid, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [
            req.user.id, customerId, t.customerName, t.phoneNumber, t.trainNo, t.route, t.seatClass,
            t.departDate, issueDate, t.ticketSource, t.ticketAmount, t.costAmount, t.paid, t.notes,
          ]
        );
        if (t.paid > 0) {
          await client.query(
            `INSERT INTO payments (user_id, train_ticket_id, amount, payment_date, method, payment_target, notes)
             VALUES ($1, $2, $3, $4, 'cash', 'self', 'Import từ file')`,
            [req.user.id, ins.rows[0].id, t.paid, issueDate]
          );
        }
        inserted += 1;
      }
      await client.query('COMMIT');
      logAudit(req, { action: 'create', entity: 'train_ticket', summary: `Import ${inserted} vé tàu từ file`, details: { inserted, failed: errors.length } });
      res.status(201).json({ inserted, failed: errors.length, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Import train tickets error:', error.message);
    res.status(500).json({ error: 'Import thất bại: ' + error.message });
  }
};

module.exports = {
  getTrainTickets, createTrainTicket, updateTrainTicket, deleteTrainTicket, bulkDeleteTrainTickets, importTrainTickets,
};
