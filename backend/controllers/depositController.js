// controllers/depositController.js — sổ nộp quỹ (cấp 2 nộp lên cấp 1).
const pool = require('../config/database');
const logger = require('../config/logger');

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
  try {
    const { amount, depositDate, method, notes } = req.body;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      return res.status(400).json({ error: 'Số tiền không hợp lệ' });
    }
    const result = await pool.query(
      `INSERT INTO fund_deposits (user_id, amount, deposit_date, method, notes)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5)
       RETURNING *`,
      [req.user.id, amt, depositDate || null, method || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create deposit error:', error.message);
    res.status(500).json({ error: 'Failed to create deposit' });
  }
};

// Sửa/xóa: chỉ trên bản ghi của chính mình (cấp 1 chỉ xem của cấp 2).
const updateDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, depositDate, method, notes } = req.body;
    const result = await pool.query(
      `UPDATE fund_deposits SET amount = $2, deposit_date = $3, method = $4, notes = $5
       WHERE id = $1 AND user_id = $6
       RETURNING *`,
      [id, parseFloat(amount) || 0, depositDate || null, method || null, notes || null, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update deposit error:', error.message);
    res.status(500).json({ error: 'Failed to update deposit' });
  }
};

const deleteDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM fund_deposits WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit not found' });
    res.json({ message: 'Deposit deleted' });
  } catch (error) {
    logger.error('Delete deposit error:', error.message);
    res.status(500).json({ error: 'Failed to delete deposit' });
  }
};

// Tính số dư / nợ với đại lý cấp trên.
// Công thức: đã nộp quỹ + khách trả thẳng vào TK cấp trên − tổng tiền vé phải trả cấp trên.
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

    // Chi tiết thanh toán của khách vào TK cấp trên (để hiện danh sách).
    const agencyPayments = await pool.query(
      `SELECT p.*, d.customer_name, d.ticket_code
       FROM payments p
       LEFT JOIN debts d ON d.id = p.debt_id
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

module.exports = { getDeposits, createDeposit, updateDeposit, deleteDeposit, getBalance };
