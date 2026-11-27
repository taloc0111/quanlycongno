// controllers/depositController.js — sổ nộp quỹ (cấp 2 nộp lên cấp 1).
const pool = require('../config/database');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

// Kiểm tra + chuẩn hoá body. Số tiền có thể ÂM (điều chỉnh đầu kỳ = nợ cũ) nhưng không được 0.
function parseDepositBody(body) {
  const amount = v.num(body.amount, { required: true, label: 'Số tiền' });
  if (amount === 0) throw new v.ValidationError('Số tiền không hợp lệ');
  return {
    amount,
    depositDate: v.dateStr(body.depositDate, { label: 'Ngày nộp' }),
    method: v.str(body.method, { max: 30, label: 'Hình thức' }),
    notes: v.str(body.notes, { label: 'Ghi chú' }),
  };
}

// Xem: chính mình + đại lý con (admin = tất cả). Lọc 1 đại lý bằng ?agencyId.
const getDeposits = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const result = await pool.query(
      `SELECT d.*, u.full_name AS owner_name, u.username AS owner_username
       FROM fund_deposits d JOIN users u ON u.id = d.user_id
       WHERE d.user_id = ANY($1)
       ORDER BY d.deposit_date DESC, d.id DESC`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get deposits error:', error.message);
    res.status(500).json({ error: 'Failed to fetch deposits' });
  }
};

// Tạo: chỉ ghi cho chính mình.
const createDeposit = async (req, res) => {
  const d = parseDepositBody(req.body);
  try {
    const result = await pool.query(
      `INSERT INTO fund_deposits (user_id, amount, deposit_date, method, notes)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5)
       RETURNING *`,
      [req.user.id, d.amount, d.depositDate, d.method, d.notes]
    );
    const row = result.rows[0];
    logAudit(req, { action: 'create', entity: 'deposit', entityId: row.id, summary: `Nộp quỹ ${d.amount.toLocaleString('vi-VN')}₫`, details: { amount: d.amount, method: d.method } });
    res.status(201).json(row);
  } catch (error) {
    logger.error('Create deposit error:', error.message);
    res.status(500).json({ error: 'Failed to create deposit' });
  }
};

// Sửa/xóa: chỉ trên bản ghi của chính mình (cấp 1 chỉ xem của cấp 2).
const updateDeposit = async (req, res) => {
  const id = v.idParam(req.params.id);
  const d = parseDepositBody(req.body);
  try {
    const result = await pool.query(
      `UPDATE fund_deposits SET amount = $2, deposit_date = COALESCE($3, deposit_date), method = $4, notes = $5
       WHERE id = $1 AND user_id = $6
       RETURNING *`,
      [id, d.amount, d.depositDate, d.method, d.notes, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit not found' });
    logAudit(req, { action: 'update', entity: 'deposit', entityId: id, summary: `Sửa lần nộp quỹ #${id}`, details: { amount: d.amount } });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update deposit error:', error.message);
    res.status(500).json({ error: 'Failed to update deposit' });
  }
};

const deleteDeposit = async (req, res) => {
  const id = v.idParam(req.params.id);
  try {
    const result = await pool.query(
      'DELETE FROM fund_deposits WHERE id = $1 AND user_id = $2 RETURNING id, amount',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit not found' });
    logAudit(req, { action: 'delete', entity: 'deposit', entityId: id, summary: `Xóa lần nộp quỹ ${Number(result.rows[0].amount).toLocaleString('vi-VN')}₫` });
    res.json({ message: 'Deposit deleted' });
  } catch (error) {
    logger.error('Delete deposit error:', error.message);
    res.status(500).json({ error: 'Failed to delete deposit' });
  }
};

// Xóa nhiều lần nộp quỹ cùng lúc (chỉ của chính mình).
const bulkDeleteDeposits = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Không có bản ghi nào để xóa' });
    }
    const result = await pool.query(
      'DELETE FROM fund_deposits WHERE id = ANY($1) AND user_id = $2 RETURNING id',
      [ids.map(Number).filter(Number.isFinite), req.user.id]
    );
    if (result.rows.length > 0) {
      logAudit(req, { action: 'delete', entity: 'deposit', summary: `Xóa ${result.rows.length} lần nộp quỹ`, details: { ids: result.rows.map((r) => r.id) } });
    }
    res.json({ deleted: result.rows.length });
  } catch (error) {
    logger.error('Bulk delete deposits error:', error.message);
    res.status(500).json({ error: 'Failed to delete deposits' });
  }
};

// Tính số dư / nợ với đại lý cấp trên.
// Công thức: đã nộp quỹ (gồm điều chỉnh đầu kỳ, âm = nợ cũ) + khách trả thẳng vào TK cấp trên.
// Âm = còn nợ cấp trên, dương = dư.
const getBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    // Tổng đã nộp quỹ (fund_deposits) — bao gồm cả điều chỉnh đầu kỳ (âm = nợ cũ).
    const depositRes = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM fund_deposits WHERE user_id = $1',
      [userId]
    );
    const totalDeposited = Number(depositRes.rows[0].total);

    // Tổng khách trả thẳng vào TK cấp trên (payments.payment_target = 'agency').
    const agencyPayRes = await pool.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM payments p
       WHERE p.user_id = $1 AND p.payment_target = 'agency'`,
      [userId]
    );
    const totalCustomerToAgency = Number(agencyPayRes.rows[0].total);

    // Chi tiết thanh toán của khách vào TK cấp trên (để hiện danh sách) — đủ 4 loại giao dịch.
    const agencyPayments = await pool.query(
      `SELECT p.*,
              COALESCE(d.customer_name, ps.customer_name, tr.customer_name, tu.customer_name) AS customer_name,
              COALESCE(d.ticket_code, ps.passport_number, tr.train_no, tu.tour_name) AS ticket_code,
              CASE WHEN p.debt_id IS NOT NULL THEN 'debt'
                   WHEN p.passport_id IS NOT NULL THEN 'passport'
                   WHEN p.train_ticket_id IS NOT NULL THEN 'train'
                   ELSE 'tour' END AS type
       FROM payments p
       LEFT JOIN debts d          ON d.id = p.debt_id
       LEFT JOIN passports ps     ON ps.id = p.passport_id
       LEFT JOIN train_tickets tr ON tr.id = p.train_ticket_id
       LEFT JOIN tours tu         ON tu.id = p.tour_id
       WHERE p.user_id = $1 AND p.payment_target = 'agency'
       ORDER BY p.payment_date DESC, p.id DESC`,
      [userId]
    );

    // Số dư = tổng nộp quỹ + tổng khách trả cấp trên. Âm = còn nợ, dương = dư.
    const balance = totalDeposited + totalCustomerToAgency;

    res.json({
      totalDeposited,
      totalCustomerToAgency,
      balance,
      agencyPayments: agencyPayments.rows,
    });
  } catch (error) {
    logger.error('Get balance error:', error.message);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
};

module.exports = { getDeposits, createDeposit, updateDeposit, deleteDeposit, bulkDeleteDeposits, getBalance };
