// test/helpers.js — dựng môi trường test: env an toàn (KHÔNG BAO GIỜ trỏ DB thật),
// dọn sạch DB, chạy app trên cổng tạm, client HTTP nhỏ + tạo user mẫu.
//
// Chạy: npm test  (node --test --test-concurrency=1 test/)
// Postgres test mặc định: postgresql://postgres@127.0.0.1:5499/qlcn_test (ghi đè bằng DATABASE_URL).

// Đặt env TRƯỚC khi require bất cứ module nào của app (dotenv không ghi đè biến đã có).
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5499/qlcn_test';
// Secret + mật khẩu test sinh ngẫu nhiên mỗi lần chạy (không viết cứng chuỗi giống secret trong repo).
const crypto = require('crypto');
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TEST_PASSWORD = `t${crypto.randomBytes(9).toString('base64url')}`;
process.env.AUTO_MIGRATE = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.FARE_ALERT_EMAIL = 'false';
process.env.FARE_WATCHER = 'false';
// Gán CHUỖI RỖNG (không delete): dotenv chỉ nạp key chưa có, nên để rỗng mới chặn được
// key thật từ .env → test không gọi SerpApi / gửi email thật.
process.env.SERPAPI_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

// Chốt an toàn: chỉ cho chạy test trên DB local.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error(`Từ chối chạy test trên DB không phải local: ${process.env.DATABASE_URL}`);
}

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { app, ensureSchema } = require('../app');

const TABLES = [
  'audit_logs', 'fare_snapshots', 'ticket_watches', 'api_usage', 'airlines', 'password_resets',
  'invoice_items', 'invoices', 'payments', 'fund_deposits', 'sticky_notes',
  'tours', 'train_tickets', 'passports', 'debts', 'flight_routes', 'customers', 'companies', 'users',
];

/** Xoá sạch mọi bảng + reset id. */
async function resetDb() {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

let server = null;
let baseUrl = '';

/** Áp schema + listen cổng tạm. Trả baseUrl. */
async function start() {
  await ensureSchema();
  await resetDb();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  await pool.end();
}

/** Tạo user trực tiếp trong DB (bcrypt). Trả row + token. */
async function createUser({ username, password = TEST_PASSWORD, role = 'user', parentId = null, email = null, fullName = null, features = {}, trialEndsAt = null }) {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role, parent_id, email, full_name, features, trial_ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
    [username, hash, role, parentId, email, fullName, JSON.stringify(features), trialEndsAt]
  );
  const user = rows[0];
  user.password = password;
  user.token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return user;
}

/** Bộ user chuẩn: admin, agency (cấp 1), child (user dưới agency), other (không liên quan). */
async function seedUsers() {
  const admin = await createUser({ username: 'admin', role: 'admin', email: 'admin@test.local' });
  const agency = await createUser({ username: 'agency', role: 'agency', email: 'agency@test.local' });
  const child = await createUser({ username: 'child', role: 'user', parentId: agency.id, email: 'child@test.local' });
  const other = await createUser({ username: 'other', role: 'user', email: 'other@test.local' });
  return { admin, agency, child, other };
}

/** Client HTTP nhỏ: api(token).get('/api/debts') → { status, body }. */
function api(token) {
  const call = async (method, path, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
    del: (path, body) => call('DELETE', path, body),
  };
}

/** Chờ điều kiện (vd audit log ghi nền) tối đa timeoutMs. */
async function waitFor(fn, { timeoutMs = 2000, stepMs = 25 } = {}) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await fn();
    if (r) return r;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor: hết thời gian chờ');
    await new Promise((r2) => setTimeout(r2, stepMs));
  }
}

module.exports = { TEST_PASSWORD, pool, app, resetDb, start, stop, createUser, seedUsers, api, waitFor, baseUrl: () => baseUrl };
