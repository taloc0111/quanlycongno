import { useEffect, useRef, useState } from 'react';

/**
 * Menu thả xuống đơn giản: bấm ngoài / Escape để đóng.
 * Props: trigger (element hoặc function({open})), align ('left'|'right'), children (nội dung menu), width.
 */
export default function Dropdown({ trigger, align = 'right', children, width = 'w-56', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <div onClick={() => setOpen((v) => !v)}>
        {typeof trigger === 'function' ? trigger({ open }) : trigger}
      </div>
      {open && (
        <div
          className={`absolute z-30 mt-1 ${width} ${align === 'right' ? 'right-0' : 'left-0'} card p-1.5 shadow-pop animate-scale-in`}
          onClick={(e) => { if (e.target.closest('[data-close-menu]')) setOpen(false); }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, danger = false, onClick, closeOnClick = true, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-close-menu={closeOnClick ? '' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition ${danger ? 'text-danger-600 hover:bg-danger-50' : 'text-ink-soft hover:bg-surface-subtle hover:text-ink'}`}
      {...rest}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}
