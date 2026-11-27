import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import Button from './Button';

const FeedbackContext = createContext(null);

/**
 * Cung cấp toast + hộp thoại xác nhận cho toàn app.
 *   const { toast, confirm } = useFeedback();
 *   toast.success('Đã lưu'); toast.error('Lỗi');
 *   if (await confirm({ title, message, confirmText, danger })) { ... }
 */
export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);

  const push = useCallback((type, message, ms = 2800) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...opts, resolve });
  }), []);

  const api = useMemo(() => ({
    toast: {
      success: (m) => push('success', m),
      error: (m) => push('error', m, 4000),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m, 3500),
    },
    confirm,
  }), [push, confirm]);

  const close = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const TONE = {
    success: 'bg-success-600 text-white',
    error: 'bg-danger-600 text-white',
    info: 'bg-ink text-white',
    warning: 'bg-warning-600 text-white',
  };

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-5 sm:translate-x-0">
        {toasts.map((t) => {
          const Icon = ICON[t.type] || Info;
          return (
            <div key={t.id} className={`pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-pop animate-fade-in ${TONE[t.type]}`}>
              <Icon size={18} className="mt-0.5 shrink-0" />
              <span className="leading-snug">{t.message}</span>
            </div>
          );
        })}
      </div>
      {/* Confirm dialog */}
      {dialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 backdrop-blur-[2px] p-4 animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div
            role="alertdialog"
            className="card w-full max-w-sm p-5 shadow-pop animate-scale-in"
            onKeyDown={(e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); }}
          >
            <div className="flex items-start gap-3">
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${dialog.danger === false ? 'bg-brand-50 text-brand-600' : 'bg-danger-50 text-danger-600'}`}>
                <AlertTriangle size={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ink">{dialog.title || 'Xác nhận'}</h3>
                <p className="mt-1 text-sm text-ink-muted whitespace-pre-line">{dialog.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>{dialog.cancelText || 'Huỷ'}</Button>
              <Button variant={dialog.danger === false ? 'primary' : 'danger'} onClick={() => close(true)} autoFocus>
                {dialog.confirmText || 'Xoá'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider');
  return ctx;
}
