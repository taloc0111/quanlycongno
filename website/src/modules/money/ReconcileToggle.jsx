/**
 * Ô đánh dấu "đã đối soát" (đã khớp với sao kê ngân hàng).
 * Cha giữ trạng thái + gọi API (cập nhật lạc quan, lỗi thì trả lại).
 */
export default function ReconcileToggle({ checked, onChange, disabled = false, label = 'Đã đối soát' }) {
  return (
    <label
      className={`inline-flex items-center justify-center ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      title={disabled ? 'Chỉ xem' : checked ? 'Đã đối soát — bấm để bỏ' : 'Đánh dấu đã khớp sao kê'}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-success-600 focus:ring-success-500/30 cursor-pointer disabled:cursor-not-allowed"
      />
    </label>
  );
}
