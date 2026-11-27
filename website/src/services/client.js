// services/client.js — fetch wrapper dùng chung cho toàn app.
//
// - Tự gắn Bearer token.
// - 401 → phát sự kiện 'auth:logout' để AuthContext đăng xuất (token hết hạn/không hợp lệ).
// - 403 kèm trialExpired/featureDisabled → phát sự kiện để UI phản ứng (chặn app, ẩn menu).
// - Lỗi được ném ra dạng Error có `.status` và `.data` để trang hiển thị.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode / bị chặn */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
  getJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  setJSON(key, value) {
    this.set(key, JSON.stringify(value));
  },
};

function authHeaders() {
  const token = storage.get('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    // Tương thích code cũ đọc err.response.data
    this.response = { status, data };
  }
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason: 'unauthorized' } }));
    } else if (res.status === 403 && data?.trialExpired) {
      window.dispatchEvent(new CustomEvent('auth:trial-expired'));
    } else if (res.status === 403 && data?.featureDisabled) {
      window.dispatchEvent(new CustomEvent('auth:feature-disabled', { detail: data.featureDisabled }));
    }
    throw new ApiError(data.error || `Lỗi máy chủ (${res.status})`, res.status, data);
  }
  return data;
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: authHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 0, {});
  }
  return handle(res);
}

export const apiGet = (path) => request('GET', path);
export const apiSend = (method, path, body) => request(method, path, body);
export const api = {
  get: apiGet,
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

/** Ghép query string, bỏ các giá trị rỗng. */
export const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') p.append(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};
