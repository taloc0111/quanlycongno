import { Inbox } from 'lucide-react';

/** Thẻ nền trắng. */
export function Card({ className = '', children, padded = true, ...rest }) {
  return (
    <div className={`card ${padded ? 'p-5' : ''} ${className}`} {...rest}>{children}</div>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  purple: 'bg-purple-50 text-purple-700',
  outline: 'border border-surface-border text-ink-soft',
};

/** Nhãn trạng thái nhỏ. */
export function Badge({ tone = 'gray', dot = false, className = '', children, icon: Icon }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${TONES[tone] || TONES.gray} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
}

/** Trạng thái rỗng có minh hoạ. */
export function EmptyState({ icon: Icon = Inbox, title = 'Chưa có dữ liệu', description, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'} px-4`}>
      <span className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-subtle text-ink-faint">
        <Icon size={26} />
      </span>
      <p className="font-semibold text-ink-soft">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Khối xương loading. */
export function Skeleton({ className = '' }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-slate-200/70 ${className}`}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-40' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Tiêu đề trang + mô tả + vùng nút bên phải. */
export function PageHeader({ icon: Icon, title, description, actions, className = '' }) {
  return (
    <div className={`mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className="hidden sm:inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
            <Icon size={22} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {description && <p className="text-sm text-ink-muted mt-0.5">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}

const STAT_TONES = {
  brand: { ring: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500' },
  success: { ring: 'bg-success-50 text-success-600', bar: 'bg-success-500' },
  warning: { ring: 'bg-warning-50 text-warning-600', bar: 'bg-warning-500' },
  danger: { ring: 'bg-danger-50 text-danger-600', bar: 'bg-danger-500' },
  purple: { ring: 'bg-purple-50 text-purple-600', bar: 'bg-purple-500' },
  gray: { ring: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' },
};

/** Thẻ số liệu: nhãn, giá trị, mô tả phụ, icon có màu. */
export function StatCard({ icon: Icon, label, value, sub, tone = 'brand', onClick, className = '' }) {
  const t = STAT_TONES[tone] || STAT_TONES.brand;
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`card relative overflow-hidden p-4 text-left ${onClick ? 'hover:shadow-pop transition cursor-pointer' : ''} ${className}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} />
      <div className="pl-2 pr-9">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="mt-1 text-[17px] sm:text-lg font-bold tabular text-ink leading-tight break-words" title={typeof value === 'string' ? value : undefined}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-ink-faint truncate" title={typeof sub === 'string' ? sub : undefined}>{sub}</p>}
      </div>
      {Icon && (
        <span className={`absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg ${t.ring}`}>
          <Icon size={16} />
        </span>
      )}
    </Comp>
  );
}

/** Thanh phân trang. */
export function Pagination({ page, totalPages, total, pageSize, onChange }) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border px-4 py-3 text-sm text-ink-muted">
      <span>Hiển thị <b className="text-ink">{from}–{to}</b> / {total} dòng</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(1)} disabled={page === 1} className="px-2 py-1 rounded-md hover:bg-surface-subtle disabled:opacity-40">«</button>
        <button type="button" onClick={() => onChange(page - 1)} disabled={page === 1} className="px-2.5 py-1 rounded-md hover:bg-surface-subtle disabled:opacity-40">Trước</button>
        <span className="px-2 text-ink">Trang {page}/{totalPages}</span>
        <button type="button" onClick={() => onChange(page + 1)} disabled={page === totalPages} className="px-2.5 py-1 rounded-md hover:bg-surface-subtle disabled:opacity-40">Sau</button>
        <button type="button" onClick={() => onChange(totalPages)} disabled={page === totalPages} className="px-2 py-1 rounded-md hover:bg-surface-subtle disabled:opacity-40">»</button>
      </div>
    </div>
  );
}

/** Thông báo lỗi inline. */
export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Thử lại</button>}
    </div>
  );
}

/** Nhóm tab dạng pill. */
export function Segmented({ value, onChange, options, size = 'sm' }) {
  return (
    <div className="inline-flex rounded-lg bg-surface-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 ${size === 'sm' ? 'py-1 text-[13px]' : 'py-1.5 text-sm'} font-medium transition ${value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
