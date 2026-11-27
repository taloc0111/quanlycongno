import { forwardRef } from 'react';
import { ChevronDown, Search as SearchIcon, X } from 'lucide-react';
import MoneyInput from '../components/MoneyInput';
import VnDatePicker from '../components/VnDatePicker';

/**
 * Field: nhãn + ô nhập + lỗi/gợi ý. Dùng bao ngoài Input/Select/MoneyField/DateField.
 */
export function Field({ label, required, hint, error, className = '', children, htmlFor }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-soft mb-1">
          {label}{required && <span className="text-danger-500"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className = '', error, size, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={`input ${size === 'sm' ? 'input-sm' : ''} ${error ? 'input-error' : ''} ${className}`}
      {...rest}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className = '', rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={`input resize-y ${className}`} {...rest} />;
});

export function Select({ className = '', size, children, ...rest }) {
  return (
    <div className="relative">
      <select className={`input appearance-none pr-8 ${size === 'sm' ? 'input-sm' : ''} ${className}`} {...rest}>
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
    </div>
  );
}

/** Ô tiền có dấu chấm nghìn (bọc MoneyInput cũ với style chuẩn). */
export function MoneyField({ className = '', ...rest }) {
  return <MoneyInput className={`input tabular ${className}`} {...rest} />;
}

/** Ô ngày dd/mm/yyyy (bọc VnDatePicker với style chuẩn). */
export function DateField({ className = '', ...rest }) {
  return <VnDatePicker className={`input ${className}`} {...rest} />;
}

/** Ô tìm kiếm có icon + nút xoá. */
export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm…', className = '', autoFocus }) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Xoá tìm kiếm"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink rounded p-0.5"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Công tắc bật/tắt. */
export function Switch({ checked, onChange, label, disabled, size = 'md' }) {
  const w = size === 'sm' ? 'w-8 h-[18px]' : 'w-10 h-[22px]';
  const dot = size === 'sm' ? 'w-3.5 h-3.5 translate-x-0.5' : 'w-4 h-4 translate-x-[3px]';
  const on = size === 'sm' ? 'translate-x-[15px]' : 'translate-x-[21px]';
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex shrink-0 items-center rounded-full transition ${w} ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`inline-block rounded-full bg-white shadow transition-transform ${dot} ${checked ? on : ''}`} />
      </button>
      {label && <span className="text-sm text-ink-soft">{label}</span>}
    </label>
  );
}
