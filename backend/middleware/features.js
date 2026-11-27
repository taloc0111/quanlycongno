// middleware/features.js — chặn route theo cờ tính năng của user (users.features).
// Dùng sau authenticateToken (req.user.features đã được resolve, admin luôn bật).
const MESSAGES = {
  fareWatch: 'Tính năng Canh vé chưa được bật cho tài khoản này',
};

/**
 * @param {'fareWatch'} key
 */
const requireFeature = (key) => (req, res, next) => {
  if (req.user && req.user.features && req.user.features[key] === true) return next();
  return res.status(403).json({
    error: MESSAGES[key] || `Tính năng "${key}" chưa được bật cho tài khoản này`,
    featureDisabled: key,
  });
};

module.exports = { requireFeature };
