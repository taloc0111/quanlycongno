import { num, today } from '../utils/format';
import { storage } from '../services/client';

/**
 * Trạng thái thanh toán của 1 dòng theo config module (amountKey/paidKey/dueKey).
 * @returns {{ total:number, paid:number, remaining:number, isPaid:boolean, overdue:boolean, status:'overdue'|'paid'|'partial'|'unpaid' }}
 */
export function payState(row, cfg) {
  const total = num(row[cfg.amountKey]);
  const paid = num(row[cfg.paidKey]);
  const remaining = total - paid;
  const isPaid = remaining <= 0;
  const due = row[cfg.dueKey];
  const cancelled = isCancelled(row);
  // Dịch vụ đã huỷ mà khách còn nợ phí huỷ vẫn tính quá hạn (phí đó vẫn phải thu).
  const overdue = !isPaid && !!due && due < today();
  const status = overdue ? 'overdue' : isPaid ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { total, paid, remaining, isPaid, overdue, status, cancelled };
}

/** Dịch vụ đã huỷ (cả 4 loại dùng cột status; tours dùng sẵn 'cancelled'). */
export const isCancelled = (row) => row?.status === 'cancelled';

/** Giá bán gốc trước khi huỷ (null nếu chưa huỷ hoặc không đổi giá). */
export function originalAmount(row, cfg) {
  if (!isCancelled(row) || row.original_amount === null || row.original_amount === undefined) return null;
  const orig = num(row.original_amount);
  return orig === num(row[cfg.amountKey]) ? null : orig;
}

// ---------------------------------------------------------------------------
// Giá vốn (docs/MONEY-FLOWS.md): dòng "Chưa đủ giá vốn" không tính vào lợi nhuận.
// ---------------------------------------------------------------------------

/** Dòng dịch vụ đang "Chưa đủ giá vốn" (cost_pending). */
export const isCostPending = (row) => row?.cost_pending === true || row?.cost_pending === 'true';

/** Lợi nhuận 1 dòng; null nếu dòng chưa đủ giá vốn (không tính lãi). */
export function rowProfit(row, cfg) {
  if (isCostPending(row)) return null;
  return num(row[cfg.amountKey]) - num(row[cfg.costKey || 'cost_amount']);
}

/** Số tiền còn nợ nhà cung cấp của 1 dòng dịch vụ. */
export const costUnpaid = (row) => Math.max(0, num(row?.cost_unpaid));

/** Tổng tiền các dòng giá vốn. */
export const costTotal = (items = []) => items.reduce((s, it) => s + num(it.amount), 0);

/** Nhãn gợi ý cho dòng giá vốn. */
export const COST_LABELS = ['Giá vé F1', 'Phí F1', 'Phí down', 'Phí dịch vụ', 'Khác'];

let keySeq = 0;
/** Tạo 1 dòng giá vốn mới (chưa lưu) cho CostItemsEditor. */
export function newCostItem(partial = {}) {
  keySeq += 1;
  return { _key: `new-${keySeq}`, supplierId: '', label: '', amount: '', dueDate: '', paidAmount: 0, payNow: false, ...partial };
}

/** Trạng thái đã trả NCC của 1 dòng giá vốn. */
export function costItemStatus(item) {
  const amount = num(item.amount);
  const paid = num(item.paidAmount);
  if (paid > 0 && paid >= amount) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

/** cost_items từ API (mảng hoặc chuỗi JSON) → dòng của CostItemsEditor. */
export function costItemsFromApi(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map((it) => ({
    id: it.id,
    supplierId: it.supplier_id ? String(it.supplier_id) : '',
    label: it.label || '',
    amount: it.amount ?? '',
    dueDate: it.due_date ? String(it.due_date).slice(0, 10) : '',
    paidAmount: num(it.paid_amount),
    payNow: false,
    ...(it.kind && it.kind !== 'cost' ? { kind: it.kind } : {}),
  }));
}

/** Dòng của CostItemsEditor → body `costItems` gửi API (không bao giờ gửi paidAmount). */
export function costItemsToPayload(items = []) {
  return items.map((it) => {
    const out = {
      supplierId: it.supplierId ? Number(it.supplierId) : null,
      label: (it.label || '').trim() || 'Khác',
      amount: num(it.amount),
      dueDate: it.dueDate || null,
    };
    if (it.id) out.id = it.id;
    if (it.kind && it.kind !== 'cost') out.kind = it.kind; // dòng NCC hoàn / phí đổi vé giữ nguyên loại
    if (it.payNow && it.supplierId) {
      out.payNow = { accountId: it.payNow.accountId ? Number(it.payNow.accountId) : null, payDate: it.payNow.payDate || today() };
    }
    return out;
  });
}

/** 3 dòng mẫu của vé down: giá vé F1 + phí F1 5.000đ (NCC F1) + phí down (NCC down). */
export function downTemplate(suppliers = []) {
  const f1 = suppliers.find((s) => s.kind === 'f1');
  const down = suppliers.find((s) => s.kind === 'down');
  const f1Id = f1 ? String(f1.id) : '';
  return [
    newCostItem({ label: 'Giá vé F1', supplierId: f1Id }),
    newCostItem({ label: 'Phí F1', supplierId: f1Id, amount: '5000' }),
    newCostItem({ label: 'Phí down', supplierId: down ? String(down.id) : '' }),
  ];
}

/**
 * Tổng giá vốn theo từng NCC của 1 dịch vụ (bỏ dòng NCC hoàn), theo thứ tự xuất hiện.
 * @returns {{ supplierId: string, supplierName: string, amount: number }[]}
 */
export function costBySupplier(row) {
  const items = costItemsFromApi(row?.cost_items);
  let raw = row?.cost_items;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
  const names = new Map((Array.isArray(raw) ? raw : []).map((it) => [String(it.supplier_id || ''), it.supplier_name || '']));
  const out = new Map();
  for (const it of items) {
    if (!it.supplierId || it.kind === 'refund') continue;
    const cur = out.get(it.supplierId) || { supplierId: it.supplierId, supplierName: names.get(it.supplierId) || '', amount: 0 };
    cur.amount += num(it.amount);
    out.set(it.supplierId, cur);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Tài khoản nhận tiền dùng gần nhất (PaymentModal, trả trước, trả NCC ngay).
// ---------------------------------------------------------------------------
export const LAST_ACCOUNT_KEY = 'payment:lastAccount';

/** Tài khoản chưa lưu trữ. */
export const activeAccounts = (accounts = []) => accounts.filter((a) => !a.archived);

/** Id (chuỗi) tài khoản dùng gần nhất nếu còn trong danh sách, không thì ''. */
export function defaultAccountId(accounts = []) {
  const last = storage.get(LAST_ACCOUNT_KEY);
  if (last && activeAccounts(accounts).some((a) => String(a.id) === String(last))) return String(last);
  return '';
}

export const rememberAccount = (id) => { if (id) storage.set(LAST_ACCOUNT_KEY, String(id)); };
