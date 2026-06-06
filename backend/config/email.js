// config/email.js — gửi email. Ưu tiên Resend HTTP API (chạy được trên Render free
// vì dùng cổng 443); nếu không có thì thử SMTP; không cấu hình gì thì bỏ qua (log link).
const nodemailer = require('nodemailer');
const env = require('./env');
const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || env.smtp.from || '';

const smtpConfigured = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
let transporter = null;
if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
    family: 4,
    pool: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return true;
}

/**
 * Gửi email. Trả về true nếu đã gửi, false nếu chưa cấu hình nhà cung cấp nào.
 * Lỗi gửi sẽ ném ra để caller xử lý (log + fallback).
 */
async function sendMail({ to, subject, html, text }) {
  if (RESEND_API_KEY) {
    if (!EMAIL_FROM) throw new Error('Thiếu EMAIL_FROM cho Resend');
    return sendViaResend({ to, subject, html, text });
  }
  if (transporter) {
    await transporter.sendMail({ from: env.smtp.from, to, subject, html, text });
    return true;
  }
  logger.warn('Chưa cấu hình email (Resend/SMTP) — bỏ qua gửi tới ' + to);
  return false;
}

module.exports = { sendMail, emailConfigured: Boolean(RESEND_API_KEY) || smtpConfigured };
