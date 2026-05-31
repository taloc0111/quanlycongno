import React, { useEffect, useState } from 'react';
import { apiGet } from '../services/client';
import { useAuth } from '../auth/AuthContext';

/**
 * Dropdown lọc dữ liệu theo đại lý. Tự ẩn nếu người dùng không có đại lý cấp dưới.
 * Props: value (string id | ''), onChange(id)
 */
export default function AgencyFilter({ value, onChange }) {
  const { user } = useAuth();
  const [agencies, setAgencies] = useState([]);

  useEffect(() => {
    apiGet('/users').then(setAgencies).catch(() => {});
  }, []);

  if (agencies.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
      title="Lọc theo đại lý"
    >
      <option value="">🏢 Tất cả đại lý</option>
      {user?.id && <option value={user.id}>Của tôi ({user.fullName || user.username})</option>}
      {agencies.map((a) => (
        <option key={a.id} value={a.id}>{a.full_name || a.username}</option>
      ))}
    </select>
  );
}
