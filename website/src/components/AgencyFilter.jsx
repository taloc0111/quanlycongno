import { useEffect, useState } from 'react';
import { api } from '../services/client';
import { useAuth } from '../auth/AuthContext';
import { Select } from '../ui';

// Cache danh sách /users ở mức module (60 s) — 5 trang cùng mount không gọi API 5 lần.
const TTL_MS = 60 * 1000;
let cache = { promise: null, at: 0 };

function fetchAgencies() {
  const now = Date.now();
  if (cache.promise && now - cache.at < TTL_MS) return cache.promise;
  const p = api.get('/users').then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => {
    cache = { promise: null, at: 0 }; // lỗi → lần sau gọi lại
    return [];
  });
  cache = { promise: p, at: now };
  return p;
}

/**
 * Dropdown lọc dữ liệu theo đại lý. Tự ẩn nếu người dùng không có đại lý cấp dưới.
 * Props: value (string id | ''), onChange(id), className
 */
export default function AgencyFilter({ value, onChange, className = '' }) {
  const { user } = useAuth();
  const [agencies, setAgencies] = useState([]);

  useEffect(() => {
    let alive = true;
    fetchAgencies().then((rows) => { if (alive) setAgencies(rows); });
    return () => { alive = false; };
  }, []);

  if (agencies.length === 0) return null;

  return (
    <Select
      size="sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-44 ${className}`}
      title="Lọc theo đại lý"
      aria-label="Lọc theo đại lý"
    >
      <option value="">Tất cả đại lý</option>
      {user?.id && <option value={user.id}>Của tôi ({user.fullName || user.username})</option>}
      {agencies.map((a) => (
        <option key={a.id} value={a.id}>{a.full_name || a.username}</option>
      ))}
    </Select>
  );
}
