// config/database.js — Pool kết nối PostgreSQL.
const { Pool, types } = require('pg');
const env = require('./env');
const logger = require('./logger');

// Cột DATE (OID 1082) trả về chuỗi 'YYYY-MM-DD' thay vì Date ở 00:00 giờ máy —
// tránh lệch 1 ngày khi serialize sang UTC (server chạy UTC, người dùng ở VN +7).
// TIMESTAMPTZ vẫn parse thành Date như cũ.
types.setTypeParser(1082, (v) => v);

// Bật SSL khi dùng DB managed (Neon/Render) — bỏ qua khi chạy localhost.
const useSsl = !!env.databaseUrl && !/localhost|127\.0\.0\.1/.test(env.databaseUrl);

const pool = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password,
    });

pool.on('error', (err) => logger.error('Postgres pool error:', err.message));
pool.on('connect', () => logger.debug('Connected to PostgreSQL'));

module.exports = pool;
