import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { API_URL, apiGet, storage } from '../services/client';

const AuthContext = createContext(null);

// Chuẩn hoá payload từ login/register/profile về 1 dạng user dùng trong app.
function toAuthUser(data) {
  return {
    id: data.userId ?? data.id,
    username: data.username,
    fullName: data.fullName ?? data.full_name ?? null,
    email: data.email ?? null,
    role: data.role || 'user',
    parentId: data.parentId ?? data.parent_id ?? null,
    trialEndsAt: data.trialEndsAt ?? data.trial_ends_at ?? null,
    features: data.features || {},
  };
}

// Số ngày dùng thử còn lại (null = không giới hạn). Tách ra ngoài component để không gọi Date.now() lúc render.
function calcTrialDaysLeft(trialEndsAt) {
  if (!trialEndsAt) return null;
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000);
}

async function postJson(path, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi máy chủ (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => storage.get('token') || '');
  const [user, setUser] = useState(() => storage.getJSON('authUser'));
  const [trialExpired, setTrialExpired] = useState(false);

  const persist = useCallback((tok, authUser) => {
    storage.set('token', tok);
    storage.set('currentUser', authUser.username);
    storage.setJSON('authUser', authUser);
    setToken(tok);
    setUser(authUser);
  }, []);

  const logout = useCallback(() => {
    storage.remove('token');
    storage.remove('currentUser');
    storage.remove('authUser');
    setToken('');
    setUser(null);
    setTrialExpired(false);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await postJson('/auth/login', { username, password });
    persist(data.token, toAuthUser(data));
    return data;
  }, [persist]);

  // Đăng ký tài khoản dùng thử mới (14 ngày).
  const register = useCallback(async ({ username, password, fullName, email }) => {
    const data = await postJson('/auth/register', { username, password, fullName, email });
    persist(data.token, toAuthUser(data));
    return data;
  }, [persist]);

  const forgotPassword = useCallback((email) => postJson('/auth/forgot-password', { email }), []);
  const resetPassword = useCallback((tok, newPassword) => postJson('/auth/reset-password', { token: tok, newPassword }), []);

  // Cập nhật thông tin user trong context (sau khi sửa hồ sơ).
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      storage.setJSON('authUser', next);
      return next;
    });
  }, []);

  // Tải lại hồ sơ từ server (role, hạn dùng thử, tính năng được bật) — để admin
  // bật/tắt Canh vé hay gia hạn là có hiệu lực ngay lần tải trang kế tiếp.
  const refreshProfile = useCallback(async () => {
    if (!storage.get('token')) return null;
    try {
      const p = await apiGet('/auth/profile');
      const next = toAuthUser(p);
      setUser((prev) => {
        const merged = { ...prev, ...next };
        storage.setJSON('authUser', merged);
        return merged;
      });
      return next;
    } catch {
      return null; // 401 đã được client.js phát sự kiện logout
    }
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    // Chạy sau khi render xong (microtask) — tránh setState đồng bộ trong effect.
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) refreshProfile(); });
    return () => { cancelled = true; };
  }, [token, refreshProfile]);

  // Lắng nghe sự kiện từ client.js
  useEffect(() => {
    const onLogout = () => logout();
    const onTrial = () => setTrialExpired(true);
    const onFeature = () => refreshProfile();
    window.addEventListener('auth:logout', onLogout);
    window.addEventListener('auth:trial-expired', onTrial);
    window.addEventListener('auth:feature-disabled', onFeature);
    return () => {
      window.removeEventListener('auth:logout', onLogout);
      window.removeEventListener('auth:trial-expired', onTrial);
      window.removeEventListener('auth:feature-disabled', onFeature);
    };
  }, [logout, refreshProfile]);

  const value = useMemo(() => {
    const isAdmin = user?.role === 'admin';
    const hasFeature = (key) => isAdmin || !!user?.features?.[key];
    const trialDaysLeft = calcTrialDaysLeft(user?.trialEndsAt);
    return {
      token,
      user,
      isAuthenticated: !!token,
      isAdmin,
      canManage: isAdmin || user?.role === 'agency',
      hasFeature,
      trialDaysLeft,
      trialExpired: trialExpired || (trialDaysLeft !== null && trialDaysLeft <= 0),
      login,
      register,
      forgotPassword,
      resetPassword,
      logout,
      updateUser,
      refreshProfile,
    };
  }, [token, user, trialExpired, login, register, forgotPassword, resetPassword, logout, updateUser, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
