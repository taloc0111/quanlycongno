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
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Số tiền nộp không hợp lệ' });
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

module.exports = { getDeposits, createDeposit, updateDeposit, deleteDeposit };
