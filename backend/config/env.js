// config/env.js — Đọc & kiểm tra biến môi trường khi khởi động (fail fast).
// Không bao giờ dùng giá trị mặc định cho secret.
require('dotenv').config();

const required = ['JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.error(`❌ Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  console.error('   Hãy tạo file .env (xem .env.example) trước khi chạy.');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET quá ngắn — cần >= 32 ký tự ngẫu nhiên.');
  console.error('   Sinh nhanh: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '5000', 10),

  jwtSecret: process.env.JWT_SECRET,
  jwtExpire: process.env.JWT_EXPIRE || '24h',

  // Danh sách origin được phép gọi API (frontend). Phân tách bằng dấu phẩy.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Ưu tiên DATABASE_URL (Neon/Render); nếu không có thì dùng các biến rời.
  databaseUrl: process.env.DATABASE_URL || null,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'debt_management',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },
};
