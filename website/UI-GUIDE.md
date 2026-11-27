# Hướng dẫn UI (website v2)

Mọi trang dùng **bộ component trong `src/ui`** + hook dùng chung. Không tự viết class Tailwind cho nút/ô nhập/modal nữa.

## Import
```js
import { Button, IconButton, Field, Input, Textarea, Select, MoneyField, DateField, SearchInput, Switch,
         Modal, Dropdown, MenuItem, Card, Badge, EmptyState, Skeleton, TableSkeleton, PageHeader, StatCard,
         Pagination, ErrorBanner, Segmented, DataTable } from './ui';          // (từ src/*.jsx) hoặc '../ui'
import { useFeedback } from './ui/FeedbackContext';   // const { toast, confirm } = useFeedback();
import { useAuth } from './auth/AuthContext';          // { user, isAdmin, canManage, hasFeature(key), refreshProfile }
import { useNavigation } from './hooks/useNavigation.jsx'; // { key, param, navigate(key, param) }  — URL hash #customer/12
import { useTableState } from './hooks/useTableState';
import { api, qs } from './services/client';          // api.get/post/put/del(path, body) → data; ném ApiError{status,data}
import { formatCurrency, formatCompact, formatDate, formatDateTime, formatMonth, today, addDays, daysUntil, monthOf, num } from './utils/format';
```

## Khung trang chuẩn
```jsx
<div>
  <PageHeader icon={Users} title="Khách hàng" description="…" actions={<><Button variant="secondary" icon={Download}>Excel</Button><Button icon={Plus}>Thêm</Button></>} />
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5"><StatCard icon={…} label="…" value={formatCurrency(x)} sub="…" tone="brand|success|warning|danger|purple|gray" /></div>
  <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">  {/* thanh công cụ */}
    <SearchInput value={t.search} onChange={t.setSearch} placeholder="…" className="lg:w-80" />
    <Select size="sm" …>…</Select>
  </div>
  <ErrorBanner message={error} onRetry={load} />
  <DataTable columns={cols} rows={paged} loading={loading} sort={t.sort} onSort={t.toggleSort} pagination={{ page, totalPages, total, pageSize, onChange: t.setPage }} emptyTitle="…" mobileCard={(row) => …} />
</div>
```
- `DataTable` cột: `{ key, label, render(row), align:'right', sortable, width, sticky, hideBelow:'md', defaultVisible }`.
- `useTableState({ storageKey, columns, pageSize, defaultSort })` rồi `const { filtered, sorted, paged, totalPages, page } = t.process(rows, { searchText: r => '…', filterFns: [...], sortValue: (r, key) => … })`.
- Form luôn trong `<Modal open onClose title icon size="md|lg|xl" footer={<><Button variant="secondary">Huỷ</Button><Button loading={saving}>Lưu</Button></>}>` + `<Field label required hint error>` bọc ô nhập. Tiền dùng `MoneyField`, ngày dùng `DateField` (giá trị 'YYYY-MM-DD').
- Thông báo: `toast.success/error/info/warning(msg)`; xác nhận: `if (!(await confirm({ title, message, confirmText, danger: true }))) return;`. **Không dùng `alert/confirm` của trình duyệt, không dùng `<Toast>`/`<ConfirmDialog>` cũ.**
- Trạng thái: `<Badge tone="success|warning|danger|brand|purple|gray|outline" dot>…</Badge>`.
- Rỗng: `<EmptyState icon title description action />`. Loading: `<TableSkeleton/>` hoặc `<Skeleton className="h-4 w-40"/>`.
- Màu token: `text-ink`, `text-ink-muted`, `text-ink-faint`, `bg-surface-muted`, `border-surface-border`, `text-brand-600`, `text-success-600`, `text-danger-600`, `text-warning-600`. Số tiền thêm class `tabular`.
- Ngày: API trả `'YYYY-MM-DD'` (DATE) hoặc ISO (TIMESTAMPTZ). Luôn dùng `formatDate`/`today()`/`addDays`; **không** dùng `new Date().toISOString()`.
- Mỗi trang phải có loading + error + empty state. Mobile: bảng có `mobileCard` hoặc cột `hideBelow`.
- Quyền: dòng không thuộc `user.id` chỉ xem (`<Badge tone="outline">Chỉ xem</Badge>`), giống `src/modules/ServicePage.jsx`.

Tham khảo mẫu hoàn chỉnh: `src/modules/ServicePage.jsx`, `src/modules/DebtExtras.jsx`, `src/components/Layout.jsx`.
