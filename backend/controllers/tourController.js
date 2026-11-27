// controllers/tourController.js — nghiệp vụ Du lịch (bán tour, công nợ + lợi nhuận).
const pool = require('../config/database');
const logger = require('../config/logger');
const { parseAmount, parseDate, upsertCustomer } = require('../utils/importHelpers');
const { todayLocal } = require('../utils/dates');
const { assertOwns } = require('../utils/ownership');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');
const ci = require('../utils/costItems');

const STATUSES = ['consulting', 'deposited', 'completed', 'cancelled'];
const PAYMENT_TARGETS = ['self', 'agency'];

// Kiểm tra + chuẩn hoá body tạo/sửa tour. Ném ValidationError (→ 400) khi sai.
function parseTourBody(body) {
  return {
    customerName: v.str(body.customerName, { max: 255, required: true, label: 'Tên khách hàng' }),
    phoneNumber: v.str(body.phoneNumber, { max: 20, label: 'Số điện thoại' }),
    tourName: v.str(body.tourName, { max: 255, label: 'Tên tour' }),
    departDate: v.dateStr(body.departDate, { label: 'Ngày đi' }),
    returnDate: v.dateStr(body.returnDate, { label: 'Ngày về' }),
    pax: v.int(body.pax, { min: 1, max: 10000, label: 'Số khách' }) ?? 1,
    issueDate: v.dateStr(body.issueDate, { label: 'Ngày bán' }),
    dueDate: v.dateStr(body.dueDate, { label: 'Hạn thanh toán' }),
    source: v.str(body.source, { max: 100, label: 'Nguồn/đối tác' }),
    sellAmount: v.amount(body.sellAmount, { required: true, label: 'Giá bán' }),
    costAmount: v.amount(body.costAmount, { label: 'Giá gốc' }) ?? 0,
    paid: v.amount(body.paid, { label: 'Đã trả' }) ?? 0,
    status: v.oneOf(body.status, STATUSES, { label: 'Trạng thái' }),
    notes: v.str(body.notes, { label: 'Ghi chú' }),
    companyId: v.int(body.companyId, { min: 1, label: 'Công ty' }),
    paymentTarget: v.oneOf(body.paymentTarget, PAYMENT_TARGETS, { label: 'Tài khoản nhận', fallback: 'self' }),
    ...ci.parseMoneyFields(body), // Dòng tiền v3: costPending, costItems, accountId
  };
}

const getTours = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT t.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.tour_id = t.id AND p.payment_target = 'agency'), 0) AS agency_paid,
              ${ci.costItemsSelectSql('tour', 't')}
       FROM tours t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ANY($1)
       ORDER BY t.issue_date DESC, t.id DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get tours error:', error.message);
    res.status(500).json({ error: 'Failed to fetch tours' });
  }
};

const createTour = async (req, res) => {
  const t = parseTourBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (t.companyId !== null && !(await assertOwns(client, 'companies', t.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    await ci.assertAccount(client, t.accountId, req.user.id);
    const customerId = await upsertCustomer(client, req.user.id, { name: t.customerName, phone: t.phoneNumber, type: 'individual' });
    const issueDate = t.issueDate || todayLocal();
    const result = await client.query(
      `INSERT INTO tours (
        user_id, customer_id, customer_name, phone_number, tour_name, depart_date, return_date, pax,
        issue_date, due_date, source, sell_amount, cost_amount, paid, status, notes, company_id, cost_pending
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        req.user.id, customerId, t.customerName, t.phoneNumber || '', t.tourName || '', t.departDate, t.returnDate,
        t.pax, issueDate, t.dueDate, t.source,
        t.sellAmount, t.costAmount, t.paid, t.status || 'deposited', t.notes || '', t.companyId, t.costPending === true,
      ]
    );
    if (t.paid > 0) {
      await client.query(
        `INSERT INTO payments (user_id, tour_id, amount, payment_date, method, payment_target, account_id)
         VALUES ($1, $2, $3, $4, 'cash', $5, $6)`,
        [req.user.id, result.rows[0].id, t.paid, issueDate, t.paymentTarget, t.accountId]
      );
    }
    const costSummary = await ci.applyCostItems(client, req.user.id, 'tour', result.rows[0].id, t.costItems);
    const row = await ci.loadServiceRow(client, 'tour', result.rows[0].id);
    await client.query('COMMIT');
    logAudit(req, { action: 'create', entity: 'tour', entityId: row.id, summary: `Tạo tour ${row.tour_name || ''} cho ${row.customer_name}`, details: { sellAmount: t.sellAmount, paid: t.paid } });
    ci.auditCostItems(req, 'tour', row.id, costSummary);
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Create tour error:', error.message);
    res.status(500).json({ error: 'Failed to create tour' });
  } finally {
    client.release();
  }
};

const updateTour = async (req, res) => {
  const id = v.idParam(req.params.id);
  const t = parseTourBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (t.companyId !== null && !(await assertOwns(client, 'companies', t.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const customerId = await upsertCustomer(client, req.user.id, { name: t.customerName, phone: t.phoneNumber, type: 'individual' });
    // Không đụng cột paid/payments — tiền trả thêm ghi qua màn Thanh toán.
    const result = await client.query(
      `UPDATE tours SET
        customer_id = $2, customer_name = $3, phone_number = $4, tour_name = $5, depart_date = $6, return_date = $7,
        pax = $8, issue_date = $9, due_date = $10, source = $11, sell_amount = $12, cost_amount = COALESCE($13, cost_amount),
        status = COALESCE($14, status), notes = $15, company_id = $16, cost_pending = COALESCE($18, cost_pending)
      WHERE id = $1 AND user_id = $17
      RETURNING id`,
      [
        id, customerId, t.customerName, t.phoneNumber, t.tourName || '', t.departDate, t.returnDate,
        t.pax, t.issueDate, t.dueDate, t.source,
        t.sellAmount, t.costAmountSent ? t.costAmount : null,
        t.status, t.notes, t.companyId, req.user.id, t.costPending,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tour not found' });
    }
    const costSummary = await ci.applyCostItems(client, req.user.id, 'tour', id, t.costItems);
    const row = await ci.loadServiceRow(client, 'tour', id);
    await client.query('COMMIT');
    logAudit(req, { action: 'update', entity: 'tour', entityId: id, summary: `Sửa tour ${t.tourName || ''} của ${t.customerName}` });
    ci.auditCostItems(req, 'tour', id, costSummary);
    res.json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Update tour error:', error.message);
    res.status(500).json({ error: 'Failed to update tour' });
  } finally {
    client.release();
  }
};

const deleteTour = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query('DELETE FROM tours WHERE id = $1 AND user_id = $2 RETURNING id, customer_name, tour_name', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tour not found' });
    const row = result.rows[0];
    logAudit(req, { action: 'delete', entity: 'tour', entityId: id, summary: `Xóa tour ${row.tour_name || ''} của ${row.customer_name}` });
    res.json({ message: 'Tour deleted' });
  } catch (error) {
    logger.error('Delete tour error:', error.message);
    res.status(500).json({ error: 'Failed to delete tour' });
  }
};

const bulkDeleteTours = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    const result = await pool.query(
      'DELETE FROM tours WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    if (result.rows.length > 0) {
      logAudit(req, { action: 'delete', entity: 'tour', summary: `Xóa ${result.rows.length} tour`, details: { ids: result.rows.map((r) => r.id) } });
    }
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete tours error:', error.message);
    res.status(500).json({ error: 'Failed to delete tours' });
  }
};

// Import tour từ Excel/CSV (giống importDebts).
const importTours = async (req, res) => {
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
      const sell = parseAmount(row.sellAmount);
      if (!Number.isFinite(sell) || sell < 0) {
        errors.push({ row: line, message: `Giá bán không hợp lệ: "${row.sellAmount}"` });
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
      const returnDate = parseDate(row.returnDate);
      const issueDate = parseDate(row.issueDate);
      if (departDate === undefined || returnDate === undefined || issueDate === undefined) {
        errors.push({ row: line, message: 'Ngày sai định dạng (dùng dd/mm/yyyy)' });
        return;
      }
      const paxRaw = row.pax === undefined || row.pax === null || row.pax === '' ? 1 : parseInt(row.pax, 10);
      if (!Number.isInteger(paxRaw) || paxRaw < 1) {
        errors.push({ row: line, message: `Số khách không hợp lệ: "${row.pax}"` });
        return;
      }
      valid.push({
        customerName: name.slice(0, 255),
        phoneNumber: (row.phoneNumber || '').toString().trim().slice(0, 20),
        tourName: (row.tourName || '').toString().trim().slice(0, 255),
        departDate,
        returnDate,
        pax: paxRaw,
        issueDate,
        sellAmount: sell,
        costAmount: cost,
        paid,
        notes: (row.notes || '').toString().trim(),
        source: (row.source || '').toString().trim().slice(0, 100) || null,
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
          `INSERT INTO tours (
            user_id, customer_id, customer_name, phone_number, tour_name, depart_date, return_date, pax,
            issue_date, source, sell_amount, cost_amount, paid, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [
            req.user.id, customerId, t.customerName, t.phoneNumber, t.tourName, t.departDate, t.returnDate, t.pax,
            issueDate, t.source, t.sellAmount, t.costAmount, t.paid, t.notes,
          ]
        );
        if (t.paid > 0) {
          await client.query(
            `INSERT INTO payments (user_id, tour_id, amount, payment_date, method, payment_target, notes)
             VALUES ($1, $2, $3, $4, 'cash', 'self', 'Import từ file')`,
            [req.user.id, ins.rows[0].id, t.paid, issueDate]
          );
        }
        inserted += 1;
      }
      await client.query('COMMIT');
      logAudit(req, { action: 'create', entity: 'tour', summary: `Import ${inserted} tour từ file`, details: { inserted, failed: errors.length } });
      res.status(201).json({ inserted, failed: errors.length, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Import tours error:', error.message);
    res.status(500).json({ error: 'Import thất bại: ' + error.message });
  }
};

module.exports = { getTours, createTour, updateTour, deleteTour, bulkDeleteTours, importTours };
