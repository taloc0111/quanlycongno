// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const env = require('../config/env');
const logger = require('../config/logger');

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role || 'user',
      // Mốc hết hạn dùng thử (epoch ms) nhúng vào token để middleware chặn không cần query DB.
      trialEndsAt: user.trial_ends_at ? new Date(user.trial_ends_at).getTime() : null,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpire }
  );
}

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    // So sánh kể cả khi không tìm thấy user để tránh lộ thông tin qua thời gian phản hồi.
    const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordMatch = await bcrypt.compare(password, hash);

    if (!user || !passwordMatch) {
      logger.warn('Login thất bại cho username:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Chặn tài khoản dùng thử đã hết hạn (trial_ends_at != null và đã qua).
    if (user.trial_ends_at && new Date(user.trial_ends_at).getTime() < Date.now()) {
      return res.status(403).json({
        error: 'Tài khoản dùng thử đã hết hạn (14 ngày). Vui lòng liên hệ để nâng cấp.',
        trialExpired: true,
      });
    }

    const token = signToken(user);
    res.json({
      token,
      username: user.username,
      userId: user.id,
      fullName: user.full_name || null,
      role: user.role || 'user',
      trialEndsAt: user.trial_ends_at || null,
    });
  } catch (error) {
    logger.error('Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
};

const register = async (req, res) => {
  try {
    const { username, password, fullName } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password phải có ít nhất 6 ký tự' });
    }

    const hashed = await bcrypt.hash(password, 10);
    // Tài khoản mới = dùng thử 14 ngày kể từ lúc đăng ký.
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, trial_ends_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '14 days')
       RETURNING id, username, full_name, role, trial_ends_at`,
      [username, hashed, fullName || null]
    );

    const user = result.rows[0];
    const token = signToken(user);
    res.status(201).json({
      token,
      username: user.username,
      userId: user.id,
      fullName: user.full_name,
      role: user.role,
      trialEndsAt: user.trial_ends_at || null,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username đã tồn tại' });
    }
    logger.error('Register error:', error.message);
    res.status(500).json({ error: 'Register failed' });
  }
};

const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, full_name, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get profile error:', error.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// Cập nhật hồ sơ của chính mình (họ tên, email).
const updateProfile = async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const result = await pool.query(
      `UPDATE users SET full_name = $2, email = $3 WHERE id = $1
       RETURNING id, username, full_name, email, role`,
      [req.user.id, fullName || null, email || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update profile error:', error.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// Đổi mật khẩu — yêu cầu mật khẩu hiện tại.
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Cần nhập mật khẩu hiện tại và mật khẩu mới' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    const ok = user && (await bcrypt.compare(currentPassword, user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hashed]);
    res.json({ message: 'Đổi mật khẩu thành công' });
  } catch (error) {
    logger.error('Change password error:', error.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
};

module.exports = { login, register, getProfile, updateProfile, changePassword };
