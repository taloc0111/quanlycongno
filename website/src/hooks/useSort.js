import { useState } from 'react';

/**
 * Hook sắp xếp danh sách theo cột (bấm tiêu đề đổi tăng/giảm).
 *  const s = useSort();
 *  const rows = s.sort(data, (item, key) => <giá trị để so sánh>);
 *  <th onClick={() => s.toggle('name')}>Tên{s.arrow('name')}</th>
 */
export function useSort(initialKey = '') {
  const [sortBy, setSortBy] = useState(initialKey);
  const [sortDir, setSortDir] = useState('asc');

  const toggle = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('asc'); }
  };

  const arrow = (key) => (sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const sort = (arr, valueOf) => {
    if (!sortBy) return arr;
    return [...arr].sort((a, b) => {
      const va = valueOf(a, sortBy);
      const vb = valueOf(b, sortBy);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  };

  return { sortBy, sortDir, toggle, arrow, sort };
}
