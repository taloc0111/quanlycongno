import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm focus-visible:ring-brand-500/40',
  secondary: 'bg-white text-ink border border-surface-border hover:bg-surface-subtle shadow-sm focus-visible:ring-brand-500/30',
  ghost: 'text-ink-soft hover:bg-surface-subtle focus-visible:ring-brand-500/30',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 shadow-sm focus-visible:ring-danger-500/40',
  success: 'bg-success-600 text-white hover:bg-success-700 shadow-sm focus-visible:ring-success-500/40',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:ring-brand-500/30',
};

const SIZES = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9.5 min-h-[38px] px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-base gap-2 rounded-xl',
};

/**
 * Nút chuẩn của app.
 * Props: variant (primary|secondary|ghost|danger|success|soft), size (xs|sm|md|lg),
 * icon (component lucide), loading, block (full width).
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  block = false,
  className = '',
  type = 'button',
  children,
  disabled,
  ...rest
}) {
  const iconSize = size === 'xs' ? 13 : size === 'sm' ? 15 : 17;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold whitespace-nowrap transition
        focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[.98]
        ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : Icon ? <Icon size={iconSize} /> : null}
      {children}
      {IconRight ? <IconRight size={iconSize} /> : null}
    </button>
  );
}

/** Nút chỉ có icon (có title để hiện tooltip + aria-label). */
export function IconButton({ icon: Icon, title, size = 16, variant = 'ghost', className = '', ...rest }) {
  const tone = {
    ghost: 'text-ink-muted hover:text-ink hover:bg-surface-subtle',
    primary: 'text-brand-600 hover:bg-brand-50',
    danger: 'text-danger-600 hover:bg-danger-50',
    success: 'text-success-600 hover:bg-success-50',
    warning: 'text-warning-600 hover:bg-warning-50',
  }[variant] || '';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-40 ${tone} ${className}`}
      {...rest}
    >
      <Icon size={size} />
    </button>
  );
}
