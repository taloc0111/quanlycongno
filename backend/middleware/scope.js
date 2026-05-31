// middleware/scope.js
// Gắn req.scope = { role, userIds } — danh sách user_id mà người dùng được phép XEM:
//   - admin  : tất cả users
//   - khác   : chính mình + toàn bộ đại lý con (đệ quy theo parent_id)
// Việc GHI (tạo/sửa/xóa) vẫn luôn giới hạn ở req.user.id trong từng controller.
const pool = require('../config/database');

async function attachScope(req, res, next) {
  try {
    const me = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    const role = me.rows[0]?.role || 'user';

    let userIds;
    if (role === 'admin') {
      const all = await pool.query('SELECT id FROM users');
      userIds = all.rows.map((r) => r.id);
    } else {
      const tree = await pool.query(
        `WITH RECURSIVE subtree AS (
           SELECT id FROM users WHERE id = $1
           UNION ALL
           SELECT u.id FROM users u JOIN subtree s ON u.parent_id = s.id
         )
         SELECT id FROM subtree`,
        [req.user.id]
      );
      userIds = tree.rows.map((r) => r.id);
    }

    req.scope = { role, userIds };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { attachScope };
