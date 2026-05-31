// services/client.js — fetch wrapper gọn dùng chung cho các trang mới.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function authHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi máy chủ (${res.status})`);
    err.response = { data, status: res.status };
    throw err;
  }
  return data;
}

export const apiGet = (path) => fetch(`${API_URL}${path}`, { headers: authHeaders() }).then(handle);

export const apiSend = (method, path, body) =>
  fetch(`${API_URL}${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(handle);
