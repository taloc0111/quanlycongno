import { createContext, useContext, useState, useCallback } from 'react';
import { API_URL } from '../services/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('authUser');
    if (raw) { try { return JSON.parse(raw); } catch { /* ignore */ } }
    const u = localStorage.getItem('currentUser');
    return u ? { username: u } : null;
  });

  const login = useCallback(async (username, password) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đăng nhập thất bại');
    const authUser = { id: data.userId, username: data.username, fullName: data.fullName, role: data.role, trialEndsAt: data.trialEndsAt || null };
    localStorage.setItem('token', data.token);
    localStorage.setItem('currentUser', data.username);
    localStorage.setItem('authUser', JSON.stringify(authUser));
    setToken(data.token);
    setUser(authUser);
    return data;
  }, []);

  // Đăng ký tài khoản dùng thử mới (14 ngày).
  const register = useCallback(async ({ username, password, fullName }) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, fullName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đăng ký thất bại');
    const authUser = { id: data.userId, username: data.username, fullName: data.fullName, role: data.role, trialEndsAt: data.trialEndsAt || null };
    localStorage.setItem('token', data.token);
    localStorage.setItem('currentUser', data.username);
    localStorage.setItem('authUser', JSON.stringify(authUser));
    setToken(data.token);
    setUser(authUser);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authUser');
    setToken('');
    setUser(null);
  }, []);

  // Cập nhật thông tin user trong context (sau khi sửa hồ sơ).
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem('authUser', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated: !!token, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
