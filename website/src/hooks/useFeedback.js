// Tương thích ngược: các trang cũ import { useToast, useConfirm } từ đây.
// Bản mới dùng FeedbackProvider (ui/FeedbackContext) — toast + confirm toàn cục.
import { useFeedback } from '../ui/FeedbackContext';

export { useFeedback };

export function useToast() {
  const { toast } = useFeedback();
  const showToast = (message, type = 'success') => (type === 'error' ? toast.error(message) : toast.success(message));
  return { toast: null, showToast };
}

export function useConfirm() {
  const { confirm } = useFeedback();
  const askConfirm = (message, onConfirm, opts = {}) => {
    confirm({ message, ...opts }).then((ok) => { if (ok) onConfirm(); });
  };
  return { confirmState: null, askConfirm, closeConfirm: () => {} };
}
