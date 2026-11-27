// controllers/passportController.js — dịch vụ làm hộ chiếu.
const pool = require('../config/database');
const logger = require('../config/logger');
const { parseAmount, parseDate, upsertCustomer } = require('../utils/importHelpers');
const { assertOwns } = require('../utils/ownership');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

const PAYMENT_TARGETS = ['self', 'agency'];

// Kiểm tra + chuẩn hoá body tạo/sửa hộ chiếu. Ném ValidationError (→ 400) khi sai.
function parsePassportBody(body) {
  return {
    passportNumber: v.str(body.passportNumber, { max: 50, label: 'Số hộ chiếu' }),
    customerName: v.str(body.customerName, { max: 255, required: true, label: 'Tên khách hàng' }),
    phoneNumber: v.str(body.phoneNumber, { max: 20, label: 'Số điện thoại' }),
    address: v.str(body.address, { max: 255, label: 'Địa chỉ' }),
    serviceDate: v.dateStr(body.serviceDate, { required: true, label: 'Ngày làm dịch vụ' }),
    dueDate: v.dateStr(body.dueDate, { label: 'Hạn thanh toán' }),
    totalAmount: v.amount(body.totalAmount, { required: true, label: 'Tổng tiền' }),
    costAmount: v.amount(body.costAmount, { label: 'Giá gốc' }) ?? 0,
    paidAmount: v.amount(body.paidAmount, { label: 'Đã trả' }) ?? 0,
    notes: v.str(body.notes, { label: 'Ghi chú' }),
    companyId: v.int(body.companyId, { min: 1, label: 'Công ty' }),
    paymentTarget: v.oneOf(body.paymentTarget, PAYMENT_TARGETS, { label: 'Tài khoản nhận', fallback: 'self' }),
  };
}

// Get all passports for user
const getPassports = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT p.*, u.full_name AS owner_name, u.username AS owner_username,
              COALESCE((SELECT SUM(pay.amount) FROM payments pay WHERE pay.passport_id = p.id AND pay.payment_target = 'agency'), 0) AS agency_paid
       FROM passports p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ANY($1)
       ORDER BY p.service_date DESC, p.created_at DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get passports error:', error.message);
    res.status(500).json({ error: 'Failed to fetch passports' });
  }
};

// Create new passport — tự tạo/liên kết khách hàng (customer_id).
const createPassport = async (req, res) => {
  const p = parsePassportBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (p.companyId !== null && !(await assertOwns(client, 'companies', p.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const customerId = await upsertCustomer(client, req.user.id, {
      name: p.customerName, phone: p.phoneNumber, address: p.address, type: 'individual',
    });
    const result = await client.query(
      `INSERT INTO passports (
        user_id, customer_id, passport_number, customer_name, phone_number, address, service_date, due_date,
        total_amount, cost_amount, paid_amount, notes, company_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        req.user.id, customerId,
        p.passportNumber || '', p.customerName, p.phoneNumber, p.address || '', p.serviceDate, p.dueDate,
        p.totalAmount, p.costAmount, p.paidAmount, p.notes || '', p.companyId,
      ]
    );
    // Khoản trả trước → 1 dòng payments (sổ thanh toán = nguồn sự thật của paid_amount).
    if (p.paidAmount > 0) {
      await client.query(
        `INSERT INTO payments (user_id, passport_id, amount, payment_date, method, payment_target)
         VALUES ($1, $2, $3, $4, 'cash', $5)`,
        [req.user.id, result.rows[0].id, p.paidAmount, p.serviceDate, p.paymentTarget]
      );
    }
    await client.query('COMMIT');
    const row = result.rows[0];
    logAudit(req, { action: 'create', entity: 'passport', entityId: row.id, summary: `Tạo hộ chiếu cho ${row.customer_name}`, details: { totalAmount: p.totalAmount, paidAmount: p.paidAmount } });
    res.status(201).json(row);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Create passport error:', error.message);
    res.status(500).json({ error: 'Failed to create passport' });
  } finally {
    client.release();
  }
};

// Update passport — cập nhật lại liên kết khách hàng theo tên/SĐT mới.
// KHÔNG đụng paid_amount (suy ra từ payments) — tiền trả thêm ghi qua màn Thanh toán.
const updatePassport = async (req, res) => {
  const id = v.idParam(req.params.id);
  const p = parsePassportBody(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (p.companyId !== null && !(await assertOwns(client, 'companies', p.companyId, req.user.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Công ty không hợp lệ' });
    }
    const customerId = await upsertCustomer(client, req.user.id, {
      name: p.customerName, phone: p.phoneNumber, address: p.address, type: 'individual',
    });
    const result = await client.query(
      `UPDATE passports SET
        customer_id = $2, passport_number = $3, customer_name = $4, phone_number = $5, address = $6,
        service_date = $7, due_date = $8, total_amount = $9, cost_amount = $10,
        notes = $11, company_id = $12
      WHERE id = $1 AND user_id = $13
      RETURNING *`,
      [
        id, customerId,
        p.passportNumber || '', p.customerName, p.phoneNumber, p.address || '', p.serviceDate, p.dueDate,
        p.totalAmount, p.costAmount, p.notes || '', p.companyId, req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Passport not found' });
    }
    await client.query('COMMIT');
    logAudit(req, { action: 'update', entity: 'passport', entityId: id, summary: `Sửa hộ chiếu của ${p.customerName}` });
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Update passport error:', error.message);
    res.status(500).json({ error: 'Failed to update passport' });
  } finally {
    client.release();
  }
};

// Delete passport
const deletePassport = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM passports WHERE id = $1 AND user_id = $2 RETURNING id, customer_name',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Passport not found' });
    }

    logAudit(req, { action: 'delete', entity: 'passport', entityId: id, summary: `Xóa hộ chiếu của ${result.rows[0].customer_name}` });
    res.json({ message: 'Passport deleted' });
  } catch (error) {
    logger.error('Delete passport error:', error.message);
    res.status(500).json({ error: 'Failed to delete passport' });
  }
};

// Xóa nhiều hộ chiếu cùng lúc (chỉ của chính mình). payments tự xóa theo (ON DELETE CASCADE).
const bulkDeletePassports = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    }
    const result = await pool.query(
      'DELETE FROM passports WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    if (result.rows.length > 0) {
      logAudit(req, { action: 'delete', entity: 'passport', summary: `Xóa ${result.rows.length} hộ chiếu`, details: { ids: result.rows.map((r) => r.id) } });
    }
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete passports error:', error.message);
    res.status(500).json({ error: 'Failed to delete passports' });
  }
};

// Import nhiều hồ sơ hộ chiếu từ Excel/CSV.
const importPassports = async (req, res) => {
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
      const total = parseAmount(row.totalAmount);
      if (!Number.isFinite(total) || total < 0) {
        errors.push({ row: line, message: `Tổng tiền không hợp lệ: "${row.totalAmount}"` });
        return;
      }
      const paid = parseAmount(row.paidAmount);
      if (!Number.isFinite(paid) || paid < 0) {
        errors.push({ row: line, message: `Tiền đã trả không hợp lệ: "${row.paidAmount}"` });
        return;
      }
      const serviceDate = parseDate(row.serviceDate);
      if (!serviceDate) {
        errors.push({ row: line, message: 'Thiếu/sai ngày làm dịch vụ (dd/mm/yyyy)' });
        return;
      }
      valid.push({
        passportNumber: (row.passportNumber || '').toString().trim().slice(0, 50),
        customerName: name.slice(0, 255),
        phoneNumber: (row.phoneNumber || '').toString().trim().slice(0, 20),
        address: (row.address || '').toString().trim().slice(0, 255),
        serviceDate,
        totalAmount: total,
        paidAmount: paid,
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
      for (const p of valid) {
        const customerId = await upsertCustomer(client, req.user.id, {
          name: p.customerName,
          phone: p.phoneNumber,
          address: p.address,
          type: 'individual',
        });
        const ins = await client.query(
          `INSERT INTO passports (
            user_id, customer_id, passport_number, customer_name, phone_number, address,
            service_date, total_amount, paid_amount, notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            req.user.id, customerId, p.passportNumber, p.customerName, p.phoneNumber, p.address,
            p.serviceDate, p.totalAmount, p.paidAmount, p.notes,
          ]
        );
        if (p.paidAmount > 0) {
          await client.query(
            `INSERT INTO payments (user_id, passport_id, amount, payment_date, method, payment_target, notes)
             VALUES ($1, $2, $3, $4, 'cash', 'self', 'Import từ file')`,
            [req.user.id, ins.rows[0].id, p.paidAmount, p.serviceDate]
          );
        }
        inserted += 1;
      }
      await client.query('COMMIT');
      logAudit(req, { action: 'create', entity: 'passport', summary: `Import ${inserted} hộ chiếu từ file`, details: { inserted, failed: errors.length } });
      res.status(201).json({ inserted, failed: errors.length, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Import passports error:', error.message);
    res.status(500).json({ error: 'Import thất bại: ' + error.message });
  }
};

module.exports = {
  getPassports,
  createPassport,
  updatePassport,
  deletePassport,
  bulkDeletePassports,
  importPassports,
};
