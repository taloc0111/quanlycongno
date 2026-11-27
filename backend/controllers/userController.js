// controllers/userController.js — quản lý tài khoản đại lý (cấp dưới).
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const logger = require('../config/logger');
const { resolveFeatures, pickFeatureUpdates } = require('../utils/features');
const { logAudit } = require('../utils/audit');
const v = require('../utils/validate');

const canManage = (role) => role === 'admin' || role === 'agency';
const ROLES = ['user', 'agency', 'admin'];

// Danh sách user trong phạm vi (trừ chính mình) kèm công nợ còn lại (4 loại dịch vụ) + cờ tính năng.
const getUsers = async (req, res) => {
  try {
    const ids = req.scope.userIds.filter((id) => id !== req.user.id);
    if (ids.length === 0) return res.json([]);
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.parent_id, u.created_at, u.trial_ends_at, u.features,
              COALESCE(d.out, 0) + COALESCE(p.out, 0) + COALESCE(tr.out, 0) + COALESCE(tu.out, 0) AS outstanding
       FROM users u
       LEFT JOIN (SELECT user_id, SUM(ticket_amount - paid) out FROM debts GROUP BY user_id) d ON d.user_id = u.id
       LEFT JOIN (SELECT user_id, SUM(total_amount - paid_amount) out FROM passports GROUP BY user_id) p ON p.user_id = u.id
       LEFT JOIN (SELECT user_id, SUM(ticket_amount - paid) out FROM train_tickets GROUP BY user_id) tr ON tr.user_id = u.id
       LEFT JOIN (SELECT user_id, SUM(sell_amount - paid) out FROM tours GROUP BY user_id) tu ON tu.user_id = u.id
       WHERE u.id = ANY($1)
       ORDER BY u.username`,
      [ids]
    );
    res.json(result.rows.map((r) => ({ ...r, features: resolveFeatures(r) })));
  } catch (error) {
    logger.error('Get users error:', error.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// Tạo đại lý cấp dưới. admin có thể gán parentId/role; agency tạo con của chính mình.
const createUser = async (req, res) => {
  if (!canManage(req.scope.role)) {
    return res.status(403).json({ error: 'Bạn không có quyền tạo tài khoản' });
  }
  const username = v.str(req.body.username, { max: 50, required: true, label: 'Tên đăng nhập' });
  if (username.length < 3) throw new v.ValidationError('Tên đăng nhập phải có ít nhất 3 ký tự');
  const password = v.str(req.body.password, { required: true, label: 'Mật khẩu', trim: false });
  if (password.length < 6) throw new v.ValidationError('Mật khẩu phải có ít nhất 6 ký tự');
  const fullName = v.str(req.body.fullName, { max: 255, label: 'Họ tên' });
  const email = v.str(req.body.email, { max: 255, label: 'Email' });
  const role = v.oneOf(req.body.role, ROLES, { label: 'Vai trò' });
  const parentId = v.int(req.body.parentId, { min: 1, label: 'Đại lý cha' });

  try {
    let parent = req.user.id;
    let newRole = 'user';
    if (req.scope.role === 'admin') {
      parent = parentId;
      if (role) newRole = role;
      if (parent !== null) {
        const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [parent]);
        if (exists.rows.length === 0) return res.status(400).json({ error: 'Đại lý cha không tồn tại' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, full_name, email, role, parent_id, created_at, features`,
      [username, hashed, fullName, email, newRole, parent]
    );
    const row = result.rows[0];
    logAudit(req, { action: 'create', entity: 'user', entityId: row.id, summary: `Tạo tài khoản ${row.username} (${row.role})` });
    res.status(201).json({ ...row, features: resolveFeatures(row) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    }
    logger.error('Create user error:', error.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// Sửa thông tin đại lý con (phải nằm trong phạm vi, không phải chính mình).
const updateUser = async (req, res) => {
  if (!canManage(req.scope.role)) return res.status(403).json({ error: 'Không có quyền' });
  const id = v.idParam(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Dùng trang Hồ sơ để sửa thông tin của bạn' });
  if (!req.scope.userIds.includes(id)) return res.status(404).json({ error: 'User not found' });

  const fullName = v.str(req.body.fullName, { max: 255, label: 'Họ tên' });
  const email = v.str(req.body.email, { max: 255, label: 'Email' });
  const role = v.oneOf(req.body.role, ROLES, { label: 'Vai trò' });
  try {
    // chỉ admin được đổi role
    const result = await pool.query(
      `UPDATE users SET full_name = $2, email = $3,
         role = CASE WHEN $4::text IS NOT NULL AND $5 = 'admin' THEN $4 ELSE role END
       WHERE id = $1
       RETURNING id, username, full_name, email, role, parent_id, features`,
      [id, fullName, email, role, req.scope.role]
    );
    const row = result.rows[0];
    logAudit(req, { action: 'update', entity: 'user', entityId: id, summary: `Sửa tài khoản ${row.username}` });
    res.json({ ...row, features: resolveFeatures(row) });
  } catch (error) {
    logger.error('Update user error:', error.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// Quản lý hạn dùng thử của 1 tài khoản con (gia hạn / không giới hạn / thu hồi).
// action: 'extend' (kèm days) | 'unlimited' | 'revoke'.
const setTrial = async (req, res) => {
  if (!canManage(req.scope.role)) return res.status(403).json({ error: 'Không có quyền' });
  const id = v.idParam(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Không thể tự đặt hạn dùng thử cho chính mình' });
  if (!req.scope.userIds.includes(id)) return res.status(404).json({ error: 'User not found' });

  try {
    const { action, days } = req.body;
    let sql;
    let params = [id];
    if (action === 'unlimited') {
      sql = 'UPDATE users SET trial_ends_at = NULL WHERE id = $1 RETURNING id, username, trial_ends_at';
    } else if (action === 'revoke') {
      sql = 'UPDATE users SET trial_ends_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, username, trial_ends_at';
    } else if (action === 'extend') {
      const d = parseInt(days, 10);
      if (!Number.isInteger(d) || d <= 0 || d > 3650) {
        return res.status(400).json({ error: 'Số ngày gia hạn không hợp lệ' });
      }
      // Cộng dồn từ mốc xa hơn giữa "bây giờ" và hạn hiện tại (gia hạn không mất ngày còn lại).
      sql = `UPDATE users SET trial_ends_at =
               GREATEST(CURRENT_TIMESTAMP, COALESCE(trial_ends_at, CURRENT_TIMESTAMP)) + make_interval(days => $2)
             WHERE id = $1 RETURNING id, username, trial_ends_at`;
      params = [id, d];
    } else {
      return res.status(400).json({ error: 'action không hợp lệ' });
    }
    const result = await pool.query(sql, params);
    logAudit(req, { action: 'update', entity: 'user', entityId: id, summary: `Đặt hạn dùng thử (${action}) cho ${result.rows[0].username}`, details: { action, days } });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Set trial error:', error.message);
    res.status(500).json({ error: 'Failed to update trial' });
  }
};

// Xóa đại lý con (xóa luôn dữ liệu của họ — ON DELETE CASCADE). Không xóa khi còn đại lý con
// (parent_id trỏ tới) — phải xóa/chuyển con trước, tránh mồ côi dữ liệu ngoài ý muốn.
const deleteUser = async (req, res) => {
  if (!canManage(req.scope.role)) return res.status(403).json({ error: 'Không có quyền' });
  const id = v.idParam(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Không thể tự xóa chính mình' });
  if (!req.scope.userIds.includes(id)) return res.status(404).json({ error: 'User not found' });

  try {
    const children = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE parent_id = $1', [id]);
    const n = children.rows[0].n;
    if (n > 0) {
      return res.status(400).json({ error: `Đại lý còn ${n} đại lý con, hãy xóa hoặc chuyển trước` });
    }
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    logAudit(req, { action: 'delete', entity: 'user', entityId: id, summary: `Xóa tài khoản ${result.rows[0].username}` });
    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('Delete user error:', error.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

// Bật/tắt tính năng cho 1 tài khoản — CHỈ admin. Gộp vào cột features (JSONB).
const setFeatures = async (req, res) => {
  if (req.scope.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin được bật/tắt tính năng' });
  const id = v.idParam(req.params.id);
  const updates = pickFeatureUpdates(req.body);
  if (!updates) return res.status(400).json({ error: 'Không có tính năng nào để cập nhật (vd { fareWatch: true })' });

  try {
    const result = await pool.query(
      `UPDATE users SET features = features || $2::jsonb WHERE id = $1
       RETURNING id, username, role, features`,
      [id, JSON.stringify(updates)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    logAudit(req, { action: 'update', entity: 'user', entityId: id, summary: `Đổi tính năng cho ${row.username}`, details: updates });
    res.json({ id: row.id, username: row.username, features: resolveFeatures(row) });
  } catch (error) {
    logger.error('Set features error:', error.message);
    res.status(500).json({ error: 'Failed to update features' });
  }
};

// Đặt lại mật khẩu cho tài khoản trong phạm vi quản lý (admin, hoặc đại lý cha). Không áp dụng
// cho chính mình (dùng PUT /api/auth/password có kiểm tra mật khẩu cũ).
const resetUserPassword = async (req, res) => {
  if (!canManage(req.scope.role)) return res.status(403).json({ error: 'Không có quyền' });
  const id = v.idParam(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Dùng trang Hồ sơ để đổi mật khẩu của bạn' });
  if (!req.scope.userIds.includes(id)) return res.status(404).json({ error: 'User not found' });
  const newPassword = v.str(req.body.newPassword, { required: true, label: 'Mật khẩu mới', trim: false });
  if (newPassword.length < 6) throw new v.ValidationError('Mật khẩu mới phải có ít nhất 6 ký tự');

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    const result = await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING username', [id, hashed]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    logAudit(req, { action: 'update', entity: 'user', entityId: id, summary: `Đặt lại mật khẩu cho ${result.rows[0].username}` });
    res.json({ message: 'Đã đặt lại mật khẩu' });
  } catch (error) {
    logger.error('Reset user password error:', error.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

module.exports = { getUsers, createUser, updateUser, setTrial, deleteUser, setFeatures, resetUserPassword };
