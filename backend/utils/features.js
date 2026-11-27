// utils/features.js — cờ tính năng theo từng user (cột users.features JSONB).
// Hiện có: fareWatch (Canh vé + Check vé). Admin LUÔN được bật mọi tính năng,
// bất kể giá trị trong cột.

const FEATURE_KEYS = ['fareWatch'];

/**
 * Chuẩn hoá cờ tính năng từ 1 dòng users (cần role + features).
 * @param {{role?:string, features?:object}} userRow
 * @returns {{fareWatch:boolean}}
 */
function resolveFeatures(userRow) {
  const raw = userRow && userRow.features && typeof userRow.features === 'object' ? userRow.features : {};
  const isAdmin = userRow && userRow.role === 'admin';
  const out = {};
  for (const key of FEATURE_KEYS) out[key] = isAdmin ? true : raw[key] === true;
  return out;
}

/** Lọc body cập nhật: chỉ giữ key hợp lệ, ép về boolean. Trả null nếu không có key nào. */
function pickFeatureUpdates(body) {
  const out = {};
  for (const key of FEATURE_KEYS) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key] === true || body[key] === 'true';
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { FEATURE_KEYS, resolveFeatures, pickFeatureUpdates };
