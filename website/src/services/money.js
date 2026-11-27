// services/money.js — gọi API dòng tiền (tài khoản, nhà cung cấp, ví trả trước).
// Hợp đồng API: docs/MONEY-FLOWS.md. Danh sách tài khoản/NCC được cache ngắn (30s) vì
// nhiều màn hình cùng cần (PaymentModal, form giá vốn, trang Tài khoản…).
import { api, qs } from './client';

const TTL = 30 * 1000;
const cache = new Map(); // key → { at, promise }

function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = loader().catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Xoá cache sau khi thêm/sửa/xoá tài khoản hoặc NCC. */
export function invalidateMoneyCache(prefix) {
  for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k);
}

export const SUPPLIER_KINDS = [
  { value: 'f1', label: 'F1 (đại lý cấp trên)' },
  { value: 'down', label: 'Bên down (xuất giảm)' },
  { value: 'other', label: 'Khác' },
];
export const supplierKindLabel = (k) => SUPPLIER_KINDS.find((x) => x.value === k)?.label || 'Khác';

export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Chuyển khoản' },
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'momo', label: 'Momo' },
  { value: 'wallet', label: 'Trừ ví trả trước' },
];
export const methodLabel = (m) => PAYMENT_METHODS.find((x) => x.value === m)?.label || m || '';

export const accountsApi = {
  list: ({ includeArchived = false, fresh = false } = {}) => {
    const key = `accounts:${includeArchived ? 1 : 0}`;
    if (fresh) cache.delete(key);
    return cached(key, () => api.get(`/accounts${qs({ includeArchived: includeArchived ? 1 : '' })}`));
  },
  create: async (body) => { const r = await api.post('/accounts', body); invalidateMoneyCache('accounts'); return r; },
  update: async (id, body) => { const r = await api.put(`/accounts/${id}`, body); invalidateMoneyCache('accounts'); return r; },
  remove: async (id) => { const r = await api.del(`/accounts/${id}`); invalidateMoneyCache('accounts'); return r; },
  ledger: (id, { from, to } = {}) => api.get(`/accounts/${id}/ledger${qs({ from, to })}`),
  reconcile: (kind, id, reconciled) => api.put('/accounts/reconcile', { kind, id, reconciled }),
};

export const suppliersApi = {
  list: ({ fresh = false } = {}) => {
    if (fresh) cache.delete('suppliers');
    return cached('suppliers', () => api.get('/suppliers'));
  },
  create: async (body) => { const r = await api.post('/suppliers', body); invalidateMoneyCache('suppliers'); return r; },
  update: async (id, body) => { const r = await api.put(`/suppliers/${id}`, body); invalidateMoneyCache('suppliers'); return r; },
  remove: async (id) => { const r = await api.del(`/suppliers/${id}`); invalidateMoneyCache('suppliers'); return r; },
  ledger: (id) => api.get(`/suppliers/${id}/ledger`),
  pay: async (id, body) => { const r = await api.post(`/suppliers/${id}/payments`, body); invalidateMoneyCache(); return r; },
  removePayment: async (paymentId) => { const r = await api.del(`/suppliers/payments/${paymentId}`); invalidateMoneyCache(); return r; },
};

export const walletsApi = {
  list: () => api.get('/wallets'),
  get: (customerId) => api.get(`/wallets/${customerId}`),
  topup: async (customerId, body) => { const r = await api.post(`/wallets/${customerId}/topup`, body); invalidateMoneyCache('accounts'); return r; },
  refund: async (customerId, body) => { const r = await api.post(`/wallets/${customerId}/refund`, body); invalidateMoneyCache('accounts'); return r; },
  adjust: (customerId, body) => api.post(`/wallets/${customerId}/adjust`, body),
  removeEntry: async (id) => { const r = await api.del(`/wallets/entries/${id}`); invalidateMoneyCache('accounts'); return r; },
};

/** Nhãn hiển thị 1 tài khoản: "TCB chính · 1903…1234". */
export const accountLabel = (a) => {
  if (!a) return '';
  const num = a.account_number ? ` · …${String(a.account_number).slice(-4)}` : '';
  return `${a.name}${num}${a.is_own === false ? ' (giữ hộ)' : ''}`;
};

// ---- v3.1 service actions (huỷ / hoàn / đổi vé) — docs/MONEY-FLOWS.md ----
// endpoint = cfg.endpoint của module ('/debts', '/passports', '/train-tickets', '/tours').
export const serviceActionsApi = {
  cancel: async (endpoint, id, body) => { const r = await api.post(`${endpoint}/${id}/cancel`, body); invalidateMoneyCache(); return r; },
  uncancel: async (endpoint, id) => { const r = await api.post(`${endpoint}/${id}/uncancel`, {}); invalidateMoneyCache(); return r; },
  change: async (id, body) => { const r = await api.post(`/debts/${id}/change`, body); invalidateMoneyCache(); return r; },
};

// ---- v3.1 accounts/receipts ----
// Chuyển tiền giữa TK, thu chi khác, phiếu thu nhiều vé, khớp sao kê (docs/MONEY-FLOWS.md v3.1).

/**
 * Danh mục thu chi khác theo chiều. `owner: true` = dòng tiền của chủ (Rút tiền riêng / Góp vốn),
 * KHÔNG tính vào lãi/lỗ.
 */
export const ENTRY_CATEGORIES = {
  out: [
    { value: 'Phí ngân hàng', label: 'Phí ngân hàng' },
    { value: 'Văn phòng', label: 'Văn phòng' },
    { value: 'Lương', label: 'Lương' },
    { value: 'Quảng cáo', label: 'Quảng cáo' },
    { value: 'Điện nước', label: 'Điện nước' },
    { value: 'Rút tiền riêng', label: 'Rút tiền riêng', owner: true },
    { value: 'Khác', label: 'Khác' },
  ],
  in: [
    { value: 'Góp vốn', label: 'Góp vốn', owner: true },
    { value: 'Lãi ngân hàng', label: 'Lãi ngân hàng' },
    { value: 'Thu khác', label: 'Thu khác' },
  ],
};

/** Danh mục là dòng tiền của chủ (không tính lãi/lỗ). */
export const isOwnerCategory = (category) =>
  [...ENTRY_CATEGORIES.out, ...ENTRY_CATEGORIES.in].some((c) => c.owner && c.value === category);

/** Gộp phiếu nhiều thao tác: số dư TK đổi → xoá cache danh sách TK. */
const touchAccounts = async (promise) => { const r = await promise; invalidateMoneyCache('accounts'); return r; };

export const transfersApi = {
  list: ({ accountId } = {}) => api.get(`/accounts/transfers${qs({ accountId })}`),
  create: (body) => touchAccounts(api.post('/accounts/transfers', body)),
  remove: (id) => touchAccounts(api.del(`/accounts/transfers/${id}`)),
};

export const entriesApi = {
  list: ({ accountId, from, to, category } = {}) => api.get(`/accounts/entries${qs({ accountId, from, to, category })}`),
  create: (body) => touchAccounts(api.post('/accounts/entries', body)),
  update: (id, body) => touchAccounts(api.put(`/accounts/entries/${id}`, body)),
  remove: (id) => touchAccounts(api.del(`/accounts/entries/${id}`)),
};

export const receiptsApi = {
  create: (body) => touchAccounts(api.post('/receipts', body)),
  list: ({ customerId } = {}) => api.get(`/receipts${qs({ customerId })}`),
  remove: (id) => touchAccounts(api.del(`/receipts/${id}`)),
};

/** Các dịch vụ còn nợ (chưa huỷ) của 1 khách, cũ nhất trước. */
export const customerOutstanding = (customerId) => api.get(`/customers/${encodeURIComponent(customerId)}/outstanding`);

/** Đánh dấu đối soát nhiều dòng một lần (khớp sao kê): items = [{ kind, id, reconciled }]. */
accountsApi.reconcileBatch = (items) => touchAccounts(api.put('/accounts/reconcile-batch', { items }));
