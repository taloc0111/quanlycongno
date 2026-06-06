import { useState } from 'react';

// Toast tự ẩn sau 2.5s — dùng kèm <Toast toast={toast} />.
export function useToast() {
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };
  return { toast, showToast };
}

// Hộp thoại xác nhận — dùng kèm <ConfirmDialog open={!!confirmState} ... />.
export function useConfirm() {
  const [confirmState, setConfirmState] = useState(null); // { message, onConfirm, title?, confirmText?, danger? }
  const askConfirm = (message, onConfirm, opts = {}) => setConfirmState({ message, onConfirm, ...opts });
  const closeConfirm = () => setConfirmState(null);
  return { confirmState, askConfirm, closeConfirm };
}
