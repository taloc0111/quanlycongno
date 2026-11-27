// controllers/auditController.js — xem nhật ký thao tác trong phạm vi (mình + đại lý con).
const pool = require('../config/database');
const logger = require('../config/logger');
const v = require('../utils/validate');

// GET /api/audit?limit=100&userId=  — mới nhất trước.
const getAuditLogs = async (req, res) => {
  const limit = Math.min(v.int(req.query.limit, { min: 1, max: 500, label: 'limit' }) ?? 100, 500);
  const userId = v.int(req.query.userId, { min: 1, label: 'userId' });
  try {
    const ids = userId !== null
      ? (req.scope.userIds.includes(userId) ? [userId] : [])
      : req.scope.userIds;
    if (ids.length === 0) return res.json({ rows: [] });
    const result = await pool.query(
      `SELECT id, user_id, username, action, entity, entity_id, summary, details, created_at
         FROM audit_logs
        WHERE user_id = ANY($1)
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [ids, limit]
    );
    res.json({ rows: result.rows });
  } catch (error) {
    logger.error('Get audit logs error:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

module.exports = { getAuditLogs };
