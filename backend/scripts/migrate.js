// scripts/migrate.js — Áp dụng schema/schema.sql lên database.
// Dùng: `npm run migrate` (đọc DATABASE_URL hoặc DB_* từ .env).
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const logger = require('../config/logger');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema', 'schema.sql'), 'utf8');
    await pool.query(sql);
    logger.info('✅ Migrate thành công — schema đã được áp dụng.');
    process.exit(0);
  } catch (err) {
    logger.error('❌ Migrate thất bại:', err.message);
    process.exit(1);
  }
})();
