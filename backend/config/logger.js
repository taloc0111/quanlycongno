// config/logger.js — Logger tối giản có timestamp & mức log.
// Thay cho console.log rải rác; tránh log dữ liệu nhạy cảm (mật khẩu, token).
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, args) {
  if (LEVELS[level] > current) return;
  const ts = new Date().toISOString();
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

module.exports = {
  error: (...a) => emit('error', a),
  warn: (...a) => emit('warn', a),
  info: (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
};
