// Tiện ích dùng chung cho các trang Dòng tiền (Tài khoản, Nhà cung cấp, Ví trả trước).
import { today, toYmd, num, daysUntil } from '../../utils/format';

/** Gợi ý ngân hàng/ví cho ô "Ngân hàng". */
export const BANKS = ['TCB', 'VCB', 'VIB', 'ACB', 'MB', 'BIDV', 'Agribank', 'TPBank', 'MoMo', 'Tiền mặt'];

/** Loại dòng trong sổ tài khoản (kind từ API ledger). */
export const LEDGER_KIND = {
  payment: { label: 'Khách trả', tone: 'success' },
  receipt: { label: 'Phiếu thu', tone: 'success' },
  topup: { label: 'Nạp ví', tone: 'brand' },
  refund: { label: 'Hoàn ví', tone: 'warning' },
  customer_refund: { label: 'Hoàn khách', tone: 'warning' },
  supplier_payment: { label: 'Trả NCC', tone: 'danger' },
  supplier_refund: { label: 'NCC hoàn', tone: 'success' },
  transfer_in: { label: 'Chuyển đến', tone: 'purple' },
  transfer_out: { label: 'Chuyển đi', tone: 'purple' },
  entry_in: { label: 'Thu khác', tone: 'brand' },
  entry_out: { label: 'Chi khác', tone: 'gray' },
};

/** kind của dòng sổ → kind gửi lên PUT /accounts/reconcile (và reconcile-batch). */
const RECONCILE_KIND = {
  payment: 'payment',
  customer_refund: 'payment', // dòng payments kind refund (số âm)
  receipt: 'receipt',
  topup: 'wallet',
  refund: 'wallet',
  supplier_payment: 'supplier_payment',
  supplier_refund: 'supplier_payment', // supplier_payments số âm
  transfer_in: 'transfer_in',
  transfer_out: 'transfer_out',
  entry_in: 'entry',
  entry_out: 'entry',
};
export const reconcileKindOf = (kind) => RECONCILE_KIND[kind] || 'wallet';

/** Dòng sổ xoá được ngay trên sổ TK: chuyển tiền / thu chi khác / phiếu thu. */
export const ledgerDeletable = (kind) => ['transfer_in', 'transfer_out', 'entry_in', 'entry_out', 'receipt'].includes(kind);

/** Loại giao dịch ví. */
export const WALLET_KIND = {
  topup: { label: 'Nạp', tone: 'success' },
  charge: { label: 'Trừ vé', tone: 'brand' },
  refund: { label: 'Hoàn', tone: 'warning' },
  adjust: { label: 'Điều chỉnh', tone: 'purple' },
};

/** Ngưỡng cảnh báo ví sắp hết. */
export const WALLET_LOW = 500000;

/** Số tài khoản che bớt: "•••• 1234". */
export const maskNumber = (n) => {
  const s = String(n || '').replace(/\s+/g, '');
  if (!s) return '';
  return s.length <= 4 ? s : `•••• ${s.slice(-4)}`;
};

/** Khoảng ngày của tháng hiện tại (offset 0) hoặc tháng trước (offset -1). */
export const monthRange = (offset = 0) => {
  const [y, m] = today().split('-').map(Number);
  const first = new Date(y, m - 1 + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { from: toYmd(first), to: toYmd(last) };
};

/** Thêm số dư luỹ kế (`running`) cho các dòng sổ, tính từ số dư đầu kỳ. */
export const withRunningBalance = (rows, opening) => {
  let bal = num(opening);
  return (rows || []).map((r) => {
    bal += r.direction === 'out' ? -num(r.amount) : num(r.amount);
    return { ...r, running: bal };
  });
};

/** Dòng thuộc người dùng hiện tại (không có user_id → coi như của mình). */
export const isOwnedBy = (row, user) => !row || row.user_id == null || !user?.id || row.user_id === user.id;

/** Còn phải trả của 1 dòng giá vốn. */
export const itemRemaining = (it) => Math.max(0, num(it?.amount) - num(it?.paid_amount));

/** Trạng thái hạn trả NCC: null | { tone, label }. */
export const dueBadge = (dueDate, remaining) => {
  if (!dueDate || remaining <= 0) return null;
  const d = daysUntil(dueDate);
  if (d === null) return null;
  if (d < 0) return { tone: 'danger', label: `Quá ${-d} ngày` };
  if (d === 0) return { tone: 'warning', label: 'Hạn hôm nay' };
  if (d <= 7) return { tone: 'warning', label: `Còn ${d} ngày` };
  return null;
};

/**
 * Chia số tiền vào các dòng còn nợ theo thứ tự (cũ trước), mỗi dòng tối đa `remaining`.
 * rows: [{ key, remaining }] đã sắp cũ → mới. Trả về { [key]: số được chia } (chỉ dòng > 0).
 */
export const autoAllocate = (rows, amount) => {
  let left = Math.max(0, num(amount));
  const out = {};
  for (const r of rows || []) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, num(r.remaining)));
    if (take > 0) { out[r.key] = take; left -= take; }
  }
  return out;
};

/** Dòng giá vốn âm (NCC hoàn): số NCC còn phải trả lại mình (> 0) — 0 nếu đã nhận đủ. */
export const itemRefundPending = (it) => (num(it?.amount) < 0 ? Math.max(0, num(it?.paid_amount) - num(it?.amount)) : 0);

/** Nhãn loại dòng giá vốn (cost_items.kind): refund = NCC hoàn, change = phí đổi vé. */
export const COST_ITEM_KIND = {
  refund: { label: 'NCC hoàn', tone: 'success' },
  change: { label: 'Phí đổi', tone: 'purple' },
};
