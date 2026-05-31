// controllers/userController.js — quản lý tài khoản đại lý (cấp dưới).
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const logger = require('../config/logger');

const canManage = (role) => role === 'admin' || role === 'agency';

// Danh sách user trong phạm vi (trừ chính mình) kèm công nợ còn lại.
const getUsers = async (req, res) => {
  try {
    const ids = req.scope.userIds.filter((id) => id !== req.user.id);
    if (ids.length === 0) return res.json([]);
    const result = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.parent_id, u.created_at,
              COALESCE(d.out, 0) + COALESCE(p.out, 0) AS outstanding
       FROM users u
       LEFT JOIN (SELECT user_id, SUM(ticket_amount - paid) out FROM debts GROUP BY user_id) d ON d.user_id = u.id
       LEFT JOIN (SELECT user_id, SUM(total_amount - paid_amount) out FROM passports GROUP BY user_id) p ON p.user_id = u.id
       WHERE u.id = ANY($1)
       ORDER BY u.username`,
      [ids]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get users error:', error.message);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// Tạo đại lý cấp dưới. admin có thể gán parentId/role; agency tạo con của chính mình.
const createUser = async (req, res) => {
  try {
    if (!canManage(req.scope.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền tạo tài khoản' });
    }
    const { username, password, fullName, email, role, parentId } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Cần tên đăng nhập và mật khẩu' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }

    let parent = req.user.id;
    let newRole = 'user';
    if (req.scope.role === 'admin') {
      parent = parentId || null;
      if (role && ['user', 'agency', 'admin'].includes(role)) newRole = role;
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, full_name, email, role, parent_id, created_at`,
      [username, hashed, fullName || null, email || null, newRole, parent]
    );
    res.status(201).json(result.rows[0]);
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
  try {
    if (!canManage(req.scope.role)) return res.status(403).json({ error: 'Không có quyền' });
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(400).json({ error: 'Dùng trang Hồ sơ để sửa thông tin của bạn' });
    if (!req.scope.userIds.includes(id)) return res.status(404).json({ error: 'User not found' });

    const { fullName, email, role } = req.body;
    // chỉ admin được đổi role
    const result = await pool.query(
      `UPDATE users SET full_name = $2, email = $3,
         role = CASE WHEN $4::text IS NOT NULL AND $5 = 'admin' THEN $4 ELSE role END
       WHERE id = $1
       RETURNING id, username, full_name, email, role, parent_id`,
      [id, fullName || null, email || null, role || null, req.scope.role]
    );
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update user error:', error.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// Xóa đại lý con (xóa luôn dữ liệu của họ — ON DELETE CASCADE).
const deleteUser = async (req, res) => {
  try {
    if (!canManage(req.scope.role)) return res.status(403).json({ error: 'Không có quyền' });
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(400).json({ error: 'Không thể tự xóa chính mình' });
    if (!req.scope.userIds.includes(id)) return res.status(404).json({ error: 'User not found' });

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('Delete user error:', error.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser };
