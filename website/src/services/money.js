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
