import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' };

/**
 * Modal chuẩn: Escape để đóng, khoá cuộn trang, tự focus ô nhập đầu tiên,
 * bấm nền để đóng (tắt bằng `static`).
 * Props: open, onClose, title, subtitle, icon, size (sm|md|lg|xl|full), footer, children.
 */
export default function Modal({ open, onClose, title, subtitle, icon: Icon, size = 'md', footer, children, static: isStatic = false, bodyClass = '' }) {
  const panelRef = useRef(null);
  // Giữ onClose trong ref để effect dưới CHỈ chạy khi mở/đóng — nếu phụ thuộc vào onClose
  // (thường là hàm mới mỗi render) thì mỗi lần gõ phím sẽ focus lại ô đầu tiên.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus ô nhập đầu tiên (hoặc chính panel) sau khi render.
    const t = setTimeout(() => {
      const candidates = [...(panelRef.current?.querySelectorAll('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button:not([data-close])') || [])];
      // Bỏ qua ô chọn ngày (focus sẽ bật lịch lên ngay khi mở modal).
      const el = candidates.find((c) => c.hasAttribute('data-autofocus')) || candidates.find((c) => !c.closest('.react-datepicker-wrapper'));
      (el || panelRef.current)?.focus?.();
    }, 10);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/50 backdrop-blur-[2px] p-3 sm:p-6 overflow-y-auto animate-fade-in"
      onMouseDown={(e) => { if (!isStatic && e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={`card w-full ${SIZES[size] || SIZES.md} my-auto flex max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] flex-col shadow-pop animate-scale-in outline-none`}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 border-b border-surface-border px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              {Icon && (
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon size={18} />
                </span>
              )}
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ink leading-tight">{title}</h3>
                {subtitle && <p className="text-xs text-ink-muted mt-0.5 truncate">{subtitle}</p>}
              </div>
            </div>
            {onClose && (
              <button
                type="button"
                data-close
                onClick={onClose}
                aria-label="Đóng"
                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-subtle hover:text-ink transition"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className={`flex-1 overflow-y-auto px-5 py-4 ${bodyClass}`}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-border px-5 py-3 bg-surface-muted rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}
