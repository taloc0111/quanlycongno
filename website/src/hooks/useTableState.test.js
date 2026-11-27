import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTableState } from './useTableState';

const columns = [
  { key: 'name', label: 'Tên', required: true },
  { key: 'amount', label: 'Tiền' },
  { key: 'notes', label: 'Ghi chú', defaultVisible: false },
];
const data = [
  { id: 1, name: 'An', amount: 300, month: '2026-01' },
  { id: 2, name: 'Bình', amount: 100, month: '2026-02' },
  { id: 3, name: 'Chi', amount: 200, month: '2026-02' },
];
const opts = { searchText: (r) => r.name, sortValue: (r, k) => r[k] };

describe('useTableState', () => {
  it('searches, sorts and paginates', () => {
    const { result } = renderHook(() => useTableState({ storageKey: 't1', columns, pageSize: 2 }));
    let out = result.current.process(data, opts);
    expect(out.sorted.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(out.paged).toHaveLength(2);
    expect(out.totalPages).toBe(2);

    act(() => result.current.toggleSort('amount'));
    out = result.current.process(data, opts);
    expect(out.sorted.map((r) => r.amount)).toEqual([100, 200, 300]);
    act(() => result.current.toggleSort('amount'));
    out = result.current.process(data, opts);
    expect(out.sorted.map((r) => r.amount)).toEqual([300, 200, 100]);

    act(() => result.current.setPage(2));
    out = result.current.process(data, opts);
    expect(out.page).toBe(2);
    expect(out.paged).toHaveLength(1);

    act(() => result.current.setSearch('bì'));
    out = result.current.process(data, opts);
    expect(out.filtered.map((r) => r.id)).toEqual([2]);
    expect(out.page).toBe(1); // về trang 1 khi đổi tìm kiếm
  });

  it('applies filter functions', () => {
    const { result } = renderHook(() => useTableState({ columns }));
    const out = result.current.process(data, { ...opts, filterFns: [(r) => r.month === '2026-02', null] });
    expect(out.filtered.map((r) => r.id)).toEqual([2, 3]);
  });

  it('remembers column visibility in localStorage and keeps required columns', () => {
    const { result } = renderHook(() => useTableState({ storageKey: 'cols-test', columns }));
    expect(result.current.isVisible('amount')).toBe(true);
    expect(result.current.isVisible('notes')).toBe(false);
    expect(result.current.toggleable.map((c) => c.key)).toEqual(['amount', 'notes']);
    act(() => result.current.toggleCol('amount'));
    expect(result.current.isVisible('amount')).toBe(false);
    expect(JSON.parse(localStorage.getItem('cols:cols-test')).amount).toBe(false);

    const again = renderHook(() => useTableState({ storageKey: 'cols-test', columns }));
    expect(again.result.current.isVisible('amount')).toBe(false);
    act(() => again.result.current.resetCols());
    expect(again.result.current.isVisible('amount')).toBe(true);
  });

  it('selection toggles', () => {
    const { result } = renderHook(() => useTableState({ columns }));
    act(() => result.current.toggleSelect(1));
    act(() => result.current.toggleSelect(2));
    expect(result.current.selected).toEqual([1, 2]);
    act(() => result.current.toggleSelect(1));
    expect(result.current.selected).toEqual([2]);
    act(() => result.current.clearSelection());
    expect(result.current.selected).toEqual([]);
  });
});
