import { useCallback, useEffect, useMemo, useState } from 'react';
import { storage } from '../services/client';

/**
 * Trạng thái bảng dữ liệu dùng chung: tìm kiếm, bộ lọc, sắp xếp, phân trang,
 * ẩn/hiện cột (nhớ qua localStorage), chọn nhiều dòng.
 *
 * const t = useTableState({ storageKey: 'debts', columns, pageSize: 50, defaultSort: { key: 'issue_date', dir: 'desc' } });
 * const rows = t.process(data, { searchText: (row) => string, filters: [(row) => boolean], sortValue: (row, key) => any });
 */
export function useTableState({ storageKey, columns = [], pageSize = 50, defaultSort = { key: '', dir: 'asc' } } = {}) {
  const [search, setSearchState] = useState('');
  const [filters, setFiltersState] = useState({});
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);

  const toggleable = useMemo(() => columns.filter((c) => c.toggleable !== false && !c.required), [columns]);
  const defaultVisible = useMemo(() => {
    const v = {};
    columns.forEach((c) => { v[c.key] = c.defaultVisible !== false; });
    return v;
  }, [columns]);

  const [visibleCols, setVisibleCols] = useState(() => {
    const saved = storageKey ? storage.getJSON(`cols:${storageKey}`) : null;
    return saved ? { ...defaultVisible, ...saved } : defaultVisible;
  });

  useEffect(() => {
    if (storageKey) storage.setJSON(`cols:${storageKey}`, visibleCols);
  }, [visibleCols, storageKey]);

  // Đổi tìm kiếm/bộ lọc thì về trang 1.
  const setSearch = useCallback((v) => { setSearchState(v); setPage(1); }, []);
  const setFilters = useCallback((v) => { setFiltersState(v); setPage(1); }, []);
  const setFilter = useCallback((key, value) => {
    setFiltersState((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);

  const toggleSort = useCallback((key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }, []);

  const toggleCol = useCallback((key) => setVisibleCols((v) => ({ ...v, [key]: !v[key] })), []);
  const resetCols = useCallback(() => setVisibleCols(defaultVisible), [defaultVisible]);
  const isVisible = useCallback((key) => visibleCols[key] !== false, [visibleCols]);

  const toggleSelect = useCallback((id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);
  const clearSelection = useCallback(() => setSelected([]), []);

  /**
   * Áp tìm kiếm → bộ lọc → sắp xếp → phân trang lên mảng gốc.
   * Trả về { filtered, sorted, paged, totalPages, page }.
   */
  const process = useCallback((data, { searchText, filterFns = [], sortValue } = {}) => {
    const q = search.trim().toLowerCase();
    let filtered = data;
    if (q && searchText) {
      filtered = filtered.filter((row) => (searchText(row) || '').toLowerCase().includes(q));
    }
    for (const fn of filterFns) {
      if (fn) filtered = filtered.filter(fn);
    }
    let sorted = filtered;
    if (sort.key && sortValue) {
      sorted = [...filtered].sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (va === vb) return 0;
        if (va === null || va === undefined || va === '') return 1;
        if (vb === null || vb === undefined || vb === '') return -1;
        const cmp = va < vb ? -1 : 1;
        return sort.dir === 'desc' ? -cmp : cmp;
      });
    }
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const cur = Math.min(page, totalPages);
    const paged = sorted.slice((cur - 1) * pageSize, cur * pageSize);
    return { filtered, sorted, paged, totalPages, page: cur };
  }, [search, sort, page, pageSize]);

  return {
    search, setSearch,
    filters, setFilter, setFilters,
    sort, toggleSort,
    page, setPage, pageSize,
    visibleCols, toggleCol, resetCols, isVisible, toggleable,
    selected, setSelected, toggleSelect, clearSelection,
    process,
  };
}
