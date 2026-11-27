import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { EmptyState, TableSkeleton, Pagination } from './Primitives';

/**
 * Bảng dữ liệu chuẩn.
 *
 * Props:
 *  - columns: [{ key, label, render(row), align ('left'|'right'|'center'), sortable, width, sticky, className, headerClassName, hideBelow ('sm'|'md'|'lg') }]
 *  - rows: mảng dòng của trang hiện tại
 *  - rowKey: (row) => id          (mặc định row.id)
 *  - loading, error, emptyTitle, emptyDescription, emptyAction
 *  - sort: { key, dir }, onSort(key)
 *  - selectable: boolean, selectedIds, onToggleRow(id), onToggleAll(), allSelected, canSelect(row)
 *  - rowClassName(row), onRowClick(row)
 *  - pagination: { page, totalPages, total, pageSize, onChange }
 *  - footer: node (vd dòng tổng)
 *  - mobileCard: (row) => node   nếu có → màn hình < md hiện dạng thẻ thay vì bảng
 *  - dense: boolean
 */
export default function DataTable({
  columns,
  rows,
  rowKey = (r) => r.id,
  loading = false,
  error = '',
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptyIcon,
  sort,
  onSort,
  selectable = false,
  selectedIds = [],
  onToggleRow,
  onToggleAll,
  allSelected = false,
  canSelect = () => true,
  rowClassName,
  onRowClick,
  pagination,
  footer,
  mobileCard,
  dense = false,
  className = '',
}) {
  const alignClass = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  const hideClass = (h) => (h === 'sm' ? 'hidden sm:table-cell' : h === 'md' ? 'hidden md:table-cell' : h === 'lg' ? 'hidden lg:table-cell' : '');
  const padY = dense ? 'py-1.5' : 'py-2.5';

  const body = () => {
    if (loading) return <TableSkeleton cols={Math.min(columns.length, 7)} />;
    if (error) return <div className="px-4 py-6 text-sm text-danger-700">{error}</div>;
    if (!rows.length) {
      return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyAction} compact />;
    }
    return null;
  };

  const state = body();

  return (
    <div className={`card overflow-hidden ${className}`}>
      {/* Dạng thẻ trên mobile */}
      {mobileCard && !state && (
        <div className="md:hidden divide-y divide-surface-border">
          {rows.map((row) => (
            <div key={rowKey(row)} className="p-3">{mobileCard(row)}</div>
          ))}
        </div>
      )}
      <div className={`overflow-x-auto ${mobileCard && !state ? 'hidden md:block' : ''}`}>
        {state ? state : (
          <table className="w-full min-w-max text-[13.5px]">
            <thead>
              <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                {selectable && (
                  <th className={`sticky left-0 z-10 bg-surface-muted px-3 ${padY} w-10`}>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả"
                      checked={allSelected}
                      onChange={onToggleAll}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30 cursor-pointer"
                    />
                  </th>
                )}
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <th
                      key={c.key}
                      style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                      className={`px-3 ${padY} font-semibold whitespace-nowrap ${alignClass(c.align)} ${hideClass(c.hideBelow)} ${c.sticky ? 'sticky left-0 z-10 bg-surface-muted' : ''} ${c.headerClassName || ''}`}
                    >
                      {c.sortable && onSort ? (
                        <button
                          type="button"
                          onClick={() => onSort(c.key)}
                          className={`inline-flex items-center gap-1 rounded hover:text-ink transition ${active ? 'text-brand-700' : ''} ${c.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {c.label}
                          <SortIcon size={12} className={active ? 'opacity-100' : 'opacity-40'} />
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((row) => {
                const id = rowKey(row);
                const selectedRow = selectable && selectedIds.includes(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`group transition ${selectedRow ? 'bg-brand-50/60' : 'hover:bg-surface-muted'} ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName ? rowClassName(row) : ''}`}
                  >
                    {selectable && (
                      <td className={`sticky left-0 z-[5] bg-inherit px-3 ${padY}`} onClick={(e) => e.stopPropagation()}>
                        {canSelect(row) && (
                          <input
                            type="checkbox"
                            aria-label="Chọn dòng"
                            checked={selectedRow}
                            onChange={() => onToggleRow?.(id)}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30 cursor-pointer"
                          />
                        )}
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 ${padY} align-middle ${alignClass(c.align)} ${hideClass(c.hideBelow)} ${c.align === 'right' ? 'tabular' : ''} ${c.sticky ? 'sticky left-0 z-[5] bg-white group-hover:bg-surface-muted' : ''} ${c.className || ''}`}
                      >
                        {c.render ? c.render(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {footer && <tfoot className="bg-surface-muted font-semibold text-ink">{footer}</tfoot>}
          </table>
        )}
      </div>
      {pagination && !state && <Pagination {...pagination} />}
    </div>
  );
}
