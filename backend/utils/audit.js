// utils/audit.js — ghi nhật ký thao tác (audit_logs). Chạy nền, KHÔNG BAO GIỜ ném lỗi
// ra controller: lỗi ghi log chỉ được warn, nghiệp vụ chính vẫn trả về bình thường.
const pool = require('../config/database');
const logger = require('../config/logger');

const ACTIONS = new Set(['create', 'update', 'delete', 'payment', 'login']);

/**
 * @param {import('express').Request|null} req   lấy user_id/username từ req.user (hoặc truyền userId/username)
 * @param {{action:string, entity:string, entityId?:number|null, summary?:string, details?:object, userId?:number, username?:string}} ev
 * @returns {Promise<void>} luôn resolve (đã .catch) — caller không cần await
 */
function logAudit(req, { action, entity, entityId = null, summary = null, details = null, userId, username } = {}) {
  const uid = userId ?? req?.user?.id ?? null;
  const uname = username ?? req?.user?.username ?? null;
  if (!ACTIONS.has(action)) {
    logger.warn('logAudit: action không hợp lệ:', action);
    return Promise.resolve();
  }
  return pool
    .query(
      `INSERT INTO audit_logs (user_id, username, action, entity, entity_id, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid, uname, action, String(entity).slice(0, 30), entityId ?? null, summary, details ? JSON.stringify(details) : null]
    )
    .then(() => undefined)
    .catch((e) => logger.warn('Ghi audit log thất bại:', e.message));
}

module.exports = { logAudit };
