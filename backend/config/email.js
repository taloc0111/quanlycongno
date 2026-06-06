// config/email.js — gửi email qua SMTP (nodemailer). Tùy chọn: chưa cấu hình thì bỏ qua.
const nodemailer = require('nodemailer');
const env = require('./env');
const logger = require('./logger');

const isConfigured = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465, // 465 = SSL; 587 = STARTTLS
    auth: { user: env.smtp.user, pass: env.smtp.pass },
    family: 4,                  // ép IPv4 (Render không có outbound IPv6)
    pool: true,                 // tái dùng kết nối cho nhanh
    connectionTimeout: 10000,   // fail nhanh nếu không kết nối được (10s)
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

/**
 * Gửi email. Trả về true nếu đã gửi, false nếu SMTP chưa cấu hình.
 * Lỗi gửi sẽ ném ra để caller xử lý.
 */
async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    logger.warn('SMTP chưa cấu hình — bỏ qua gửi email tới ' + to);
    return false;
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, html, text });
  return true;
}

module.exports = { sendMail, emailConfigured: isConfigured };
