import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Users, Pencil, FileText, Phone, Mail, MapPin, CreditCard, Building2, AlertTriangle,
  ShoppingBag, PiggyBank, Landmark, ListOrdered, Cake, RefreshCw, CheckCircle2, Eye, HandCoins,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useNavigation } from '../hooks/useNavigation.jsx';
import { useFeedback } from '../ui/FeedbackContext';
import { api, qs } from '../services/client';
import { formatCurrency, formatDate, today, addDays, num, normalizeYmd } from '../utils/format';
import {
  Button, IconButton, Field, Input, Select, MoneyField, DateField, Textarea, Modal, Badge,
  PageHeader, StatCard, DataTable, ErrorBanner, Segmented, Skeleton, EmptyState,
} from '../ui';
import CustomerStatement from './CustomerStatement';
import WalletPanel from './money/WalletPanel';
import ReceiptModal from './money/ReceiptModal';
import CustomerReceipts from './money/CustomerReceipts';
import { methodLabel, receiptsApi } from '../services/money';

// ---------- Chuẩn hoá giao dịch 4 loại dịch vụ về 1 dạng ----------
const SERVICE = {
  debt: { label: 'Vé máy bay', tone: 'brand', dateKey: 'issue_date', amountKey: 'ticket_amount', paidKey: 'paid', desc: (r) => [r.ticket_code, r.route].filter(Boolean).join(' · ') || 'Vé máy bay' },
  train: { label: 'Vé tàu', tone: 'purple', dateKey: 'issue_date', amountKey: 'ticket_amount', paidKey: 'paid', desc: (r) => [r.train_no, r.route].filter(Boolean).join(' · ') || 'Vé tàu' },
  passport: { label: 'Hộ chiếu', tone: 'success', dateKey: 'service_date', amountKey: 'total_amount', paidKey: 'paid_amount', desc: (r) => r.passport_number || 'Hộ chiếu' },
  tour: { label: 'Tour', tone: 'warning', dateKey: 'issue_date', amountKey: 'sell_amount', paidKey: 'paid', desc: (r) => r.tour_name || 'Tour' },
};

const STATUS = {
  cancelled: { tone: 'gray', label: 'Đã huỷ' },
  overdue: { tone: 'danger', label: 'Quá hạn' },
  paid: { tone: 'success', label: 'Đã trả đủ' },
  partial: { tone: 'warning', label: 'Trả 1 phần' },
  unpaid: { tone: 'danger', label: 'Chưa trả' },
};

/** Gộp debts/trainTickets/passports/tours của API detail thành 1 mảng giao dịch thống nhất. */
function normalizeTransactions(detail) {
  if (!detail) return [];
  const groups = [
    ['debt', detail.debts], ['train', detail.trainTickets], ['passport', detail.passports], ['tour', detail.tours],
  ];
  const out = [];
  const now = today();
  for (const [type, rows] of groups) {
    const s = SERVICE[type];
    for (const r of rows || []) {
      const sold = num(r[s.amountKey]);
      const paid = num(r[s.paidKey]);
      const remaining = sold - paid;
      const due = normalizeYmd(r.due_date);
      const cancelled = r.status === 'cancelled';
      const overdue = !cancelled && remaining > 0 && due && due < now;
      const status = cancelled ? 'cancelled' : overdue ? 'overdue' : remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      out.push({ id: `${type}-${r.id}`, type, typeLabel: s.label, tone: s.tone, date: normalizeYmd(r[s.dateKey]), desc: s.desc(r), sold, paid, remaining, due, status, cancelled, raw: r });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

function StatusBadge({ status }) {
  const b = STATUS[status] || STATUS.unpaid;
  return <Badge tone={b.tone} dot>{b.label}</Badge>;
}

// ---------- Form thêm/sửa khách (dùng chung cho danh sách + chi tiết) ----------
const EMPTY_FORM = { name: '', phone: '', email: '', address: '', idNumber: '', type: 'individual', creditLimit: '', notes: '', birthday: '', companyId: '' };

function customerToForm(c) {
  if (!c) return { ...EMPTY_FORM };
  return {
    id: c.id,
    name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
    idNumber: c.id_number || '', type: c.type || 'individual',
    creditLimit: c.credit_limit ? String(c.credit_limit).split('.')[0] : '',
    notes: c.notes || '',
    birthday: normalizeYmd(c.birthday),
    companyId: c.company_id || '',
  };
}

/**
 * Modal thêm/sửa khách hàng. `initial` = dòng khách (sửa) hoặc null (thêm).
 * Tự gọi API; gọi onSaved(row) khi xong.
 */
export function CustomerFormModal({ open, initial, companies = [], onClose, onSaved }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState(() => customerToForm(initial));
  const [saving, setSaving] = useState(false);

  // Nạp lại form mỗi khi mở với khách khác.
  useEffect(() => {
    if (open) setForm(customerToForm(initial));
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Nhập tên khách hàng'); return; }
    if (form.type === 'company' && !form.companyId) { toast.error('Vui lòng chọn công ty'); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(), phone: form.phone, email: form.email, address: form.address,
        idNumber: form.idNumber, type: form.type, notes: form.notes,
        creditLimit: form.creditLimit === '' ? 0 : num(form.creditLimit),
        birthday: form.birthday || null,
        companyId: form.type === 'company' ? form.companyId : '',
      };
      const row = form.id ? await api.put(`/customers/${form.id}`, body) : await api.post('/customers', body);
      toast.success(form.id ? 'Đã cập nhật khách hàng' : 'Đã thêm khách hàng');
      onSaved?.(row);
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Users}
      title={form.id ? 'Sửa khách hàng' : 'Thêm khách hàng'}
      subtitle={form.id ? `#${form.id}` : undefined}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button icon={CheckCircle2} loading={saving} onClick={save}>{form.id ? 'Lưu thay đổi' : 'Thêm mới'}</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Loại khách" htmlFor="cf-type">
          <Select id="cf-type" value={form.type} onChange={(e) => { const type = e.target.value; setForm((f) => ({ ...f, type, companyId: type === 'individual' ? '' : f.companyId })); }}>
            <option value="individual">Cá nhân (khách lẻ)</option>
            <option value="company">Thuộc công ty</option>
          </Select>
        </Field>
        {form.type === 'company' ? (
          <Field label="Công ty" required htmlFor="cf-company" hint={companies.length === 0 ? 'Chưa có công ty. Tạo ở mục Công nợ vé → nút "Công ty".' : undefined}>
            <Select id="cf-company" value={form.companyId} onChange={(e) => set('companyId', e.target.value)}>
              <option value="">— Chọn công ty —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Tên khách hàng" required htmlFor="cf-name" className="sm:col-span-2">
          <Input id="cf-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nguyễn Văn A" />
        </Field>
        <Field label="Số điện thoại" htmlFor="cf-phone">
          <Input id="cf-phone" value={form.phone} inputMode="tel" onChange={(e) => set('phone', e.target.value)} placeholder="09xx xxx xxx" />
        </Field>
        <Field label="Email" htmlFor="cf-email">
          <Input id="cf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Địa chỉ" htmlFor="cf-address" className="sm:col-span-2">
          <Input id="cf-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="CCCD/CMND" htmlFor="cf-id">
          <Input id="cf-id" value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
        </Field>
        <Field label="Ngày sinh">
          <DateField value={form.birthday} onChange={(v) => set('birthday', v)} />
        </Field>
        <Field label="Hạn mức nợ" hint="0 = không giới hạn. Vượt hạn mức sẽ cảnh báo ở trang chi tiết." htmlFor="cf-credit">
          <MoneyField id="cf-credit" value={form.creditLimit} onChange={(v) => set('creditLimit', v)} placeholder="0" />
        </Field>
        <Field label="Ghi chú" htmlFor="cf-notes">
          <Textarea id="cf-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

// ---------- Trang chi tiết ----------
const TABS = [
  { value: 'all', label: 'Tất cả giao dịch' },
  { value: 'debt', label: 'Vé máy bay' },
  { value: 'train', label: 'Vé tàu' },
  { value: 'passport', label: 'Hộ chiếu' },
  { value: 'tour', label: 'Tour' },
  { value: 'payment', label: 'Thanh toán' },
];

const firstOfMonth = () => `${today().slice(0, 7)}-01`;

export default function CustomerDetail({ id }) {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast } = useFeedback();

  const [detail, setDetail] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState('all');
  const [editing, setEditing] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receipts, setReceipts] = useState(null);
  const [receiptsError, setReceiptsError] = useState('');
  const [walletKey, setWalletKey] = useState(0); // đổi để WalletPanel tải lại sau phiếu thu

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setDetail(await api.get(`/customers/${encodeURIComponent(id)}/detail${qs({ from, to })}`));
    } catch (err) {
      setError(err.status === 404 ? 'Không tìm thấy khách hàng này (có thể đã bị xoá).' : err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/companies').then(setCompanies).catch(() => {}); }, []);

  const loadReceipts = useCallback(() => {
    let alive = true;
    receiptsApi.list({ customerId: id })
      .then((rows) => { if (alive) { setReceipts(Array.isArray(rows) ? rows : []); setReceiptsError(''); } })
      .catch((err) => { if (alive) { setReceipts([]); setReceiptsError(err.message); } });
    return () => { alive = false; };
  }, [id]);
  useEffect(() => loadReceipts(), [loadReceipts]);

  // Sau khi ghi/xoá phiếu thu: số đã trả, ví và danh sách phiếu đều đổi.
  const afterReceipt = () => {
    load({ silent: true });
    loadReceipts();
    setWalletKey((k) => k + 1);
  };

  const customer = detail?.customer;
  const owned = !customer || !user?.id || customer.user_id === user.id;
  const transactions = useMemo(() => normalizeTransactions(detail), [detail]);
  const payments = useMemo(() => detail?.payments || [], [detail]);
  const totals = detail?.totals || { sold: 0, cost: 0, paid: 0, outstanding: 0 };
  const creditLimit = num(customer?.credit_limit);
  const overLimit = creditLimit > 0 && totals.outstanding > creditLimit;
  const companyName = customer?.company_id ? companies.find((c) => String(c.id) === String(customer.company_id))?.name : null;

  const visibleRows = useMemo(() => (tab === 'all' ? transactions : transactions.filter((t) => t.type === tab)), [transactions, tab]);
  const counts = useMemo(() => {
    const c = { all: transactions.length, payment: payments.length };
    for (const t of transactions) c[t.type] = (c[t.type] || 0) + 1;
    return c;
  }, [transactions, payments]);

  const quick = (f, t) => { setFrom(f); setTo(t); };
  const periodLabel = from || to ? `${from ? formatDate(from) : '…'} → ${to ? formatDate(to) : '…'}` : 'Tất cả thời gian';
  const isQuick = (f, t) => from === f && to === t;

  const txColumns = [
    { key: 'date', label: 'Ngày', width: 110, render: (r) => formatDate(r.date) || <span className="text-ink-faint">—</span> },
    { key: 'type', label: 'Loại', width: 110, render: (r) => <Badge tone={r.tone}>{r.typeLabel}</Badge> },
    { key: 'desc', label: 'Mô tả', render: (r) => <span className="font-medium text-ink">{r.desc}</span> },
    {
      key: 'sold', label: 'Giá bán', align: 'right', render: (r) => (
        <span className="font-semibold">
          {r.cancelled && r.raw?.original_amount != null && num(r.raw.original_amount) !== r.sold && (
            <span className="mr-1.5 font-normal text-ink-faint line-through">{formatCurrency(r.raw.original_amount)}</span>
          )}
          {formatCurrency(r.sold)}
        </span>
      ),
    },
    { key: 'paid', label: 'Đã trả', align: 'right', hideBelow: 'lg', render: (r) => <span className="text-success-600">{formatCurrency(r.paid)}</span> },
    { key: 'remaining', label: 'Còn nợ', align: 'right', render: (r) => <span className={`font-bold ${r.remaining <= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(r.remaining)}</span> },
    { key: 'status', label: 'Trạng thái', width: 110, render: (r) => <StatusBadge status={r.status} /> },
  ];
  const payColumns = [
    { key: 'payment_date', label: 'Ngày', width: 110, render: (r) => formatDate(r.payment_date) },
    { key: 'type', label: 'Loại', width: 110, render: (r) => <Badge tone={SERVICE[r.type]?.tone || 'gray'}>{SERVICE[r.type]?.label || r.type}</Badge> },
    { key: 'target_label', label: 'Giao dịch', render: (r) => <span className="font-medium text-ink">{r.target_label || '—'}</span> },
    { key: 'amount', label: 'Số tiền', align: 'right', render: (r) => <span className="font-semibold text-success-600">{formatCurrency(r.amount)}</span> },
    { key: 'method', label: 'Hình thức', hideBelow: 'md', render: (r) => (r.method ? methodLabel(r.method) : <span className="text-ink-faint">—</span>) },
    { key: 'notes', label: 'Ghi chú', hideBelow: 'lg', render: (r) => <span className="text-ink-muted">{r.notes || ''}</span> },
  ];

  const txFooter = visibleRows.length > 0 && (
    <tr>
      <td className="px-3 py-2.5" colSpan={3}>Tổng {visibleRows.length} giao dịch</td>
      <td className="px-3 py-2.5 text-right tabular">{formatCurrency(visibleRows.reduce((s, r) => s + r.sold, 0))}</td>
      <td className="px-3 py-2.5 text-right tabular hidden lg:table-cell text-success-600">{formatCurrency(visibleRows.reduce((s, r) => s + r.paid, 0))}</td>
      <td className="px-3 py-2.5 text-right tabular text-danger-600">{formatCurrency(visibleRows.reduce((s, r) => s + r.remaining, 0))}</td>
      <td />
    </tr>
  );

  const infoLine = (Icon, content, href) => content ? (
    <div className="flex items-center gap-2 text-sm text-ink-soft min-w-0">
      <Icon size={15} className="text-ink-faint shrink-0" />
      {href ? <a href={href} className="truncate hover:text-brand-600 hover:underline">{content}</a> : <span className="truncate">{content}</span>}
    </div>
  ) : null;

  return (
    <div>
      <PageHeader
        help="customers"
        icon={Users}
        title={loading ? 'Đang tải…' : (customer?.name || 'Khách hàng')}
        description={customer ? `Khách hàng #${customer.id}${!owned ? ` · thuộc đại lý ${customer.owner_name || customer.owner_username || ''}` : ''}` : 'Chi tiết khách hàng'}
        actions={(
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('customer')}>Danh sách</Button>
            <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
            {customer && owned && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Sửa khách</Button>}
            {customer && owned && <Button variant="secondary" icon={HandCoins} onClick={() => setReceiptOpen(true)}>Thu tiền nhiều vé</Button>}
            {customer && <Button icon={FileText} onClick={() => setStatementOpen(true)}>Bảng kê công nợ</Button>}
          </>
        )}
      />

      <ErrorBanner message={error} onRetry={load} />
      {error && !loading && (
        <div className="card mt-4"><EmptyState icon={Users} title="Không tải được khách hàng" description={error} action={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('customer')}>Về danh sách</Button>} /></div>
      )}

      {!error && (
        <>
          {/* Thẻ thông tin khách */}
          <div className="card p-4 sm:p-5 mb-5">
            {loading ? (
              <div className="space-y-2"><Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-72" /></div>
            ) : customer && (
              <div className="flex flex-col md:flex-row md:items-start gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 text-lg font-bold">
                    {(customer.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-ink">{customer.name}</h2>
                      {customer.type === 'company'
                        ? <Badge tone="purple" icon={Building2}>{companyName || 'Công ty'}</Badge>
                        : <Badge tone="gray">Cá nhân</Badge>}
                      {!owned && <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>}
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                      {infoLine(Phone, customer.phone, `tel:${customer.phone}`)}
                      {infoLine(Mail, customer.email, `mailto:${customer.email}`)}
                      {infoLine(MapPin, customer.address)}
                      {infoLine(CreditCard, customer.id_number && `CCCD ${customer.id_number}`)}
                      {infoLine(Cake, customer.birthday && `Sinh nhật ${formatDate(customer.birthday)}`)}
                    </div>
                    {customer.notes && <p className="mt-2 text-sm text-ink-muted whitespace-pre-line">{customer.notes}</p>}
                  </div>
                </div>
                <div className="md:text-right shrink-0">
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Hạn mức nợ</p>
                  <p className="font-bold tabular text-ink">{creditLimit > 0 ? formatCurrency(creditLimit) : 'Không giới hạn'}</p>
                  {overLimit && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-lg bg-danger-50 px-2 py-1 text-xs font-semibold text-danger-700">
                      <AlertTriangle size={13} /> Vượt hạn mức {formatCurrency(totals.outstanding - creditLimit)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Ví trả trước (thu gọn, bấm để xem lịch sử) */}
          {customer && <WalletPanel key={walletKey} customerId={customer.id} readOnly={!owned} collapsible />}

          {/* Số liệu */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard icon={ShoppingBag} label="Tổng mua" value={loading ? '…' : formatCurrency(totals.sold)} sub={periodLabel} tone="brand" />
            <StatCard icon={PiggyBank} label="Đã trả" value={loading ? '…' : formatCurrency(totals.paid)} sub={totals.sold ? `${Math.round((totals.paid / totals.sold) * 100)}% tổng mua` : ''} tone="success" />
            <StatCard icon={Landmark} label="Còn nợ" value={loading ? '…' : formatCurrency(totals.outstanding)} sub={overLimit ? 'Vượt hạn mức!' : ''} tone={totals.outstanding > 0 ? 'danger' : 'gray'} />
            <StatCard icon={ListOrdered} label="Số giao dịch" value={loading ? '…' : transactions.length} sub={`${payments.length} lần thanh toán`} tone="purple" />
          </div>

          {/* Lọc thời gian + tab */}
          <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-muted">Từ</span>
              <DateField value={from} onChange={setFrom} className="w-36 input-sm" placeholder="Từ ngày" />
              <span className="text-sm text-ink-muted">đến</span>
              <DateField value={to} onChange={setTo} className="w-36 input-sm" placeholder="Đến ngày" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant={isQuick(firstOfMonth(), today()) ? 'soft' : 'secondary'} onClick={() => quick(firstOfMonth(), today())}>Tháng này</Button>
              <Button size="sm" variant={isQuick(addDays(today(), -90), today()) ? 'soft' : 'secondary'} onClick={() => quick(addDays(today(), -90), today())}>3 tháng</Button>
              <Button size="sm" variant={isQuick('', '') ? 'soft' : 'secondary'} onClick={() => quick('', '')}>Tất cả</Button>
            </div>
            <div className="lg:ml-auto overflow-x-auto -mx-1 px-1">
              <Segmented value={tab} onChange={setTab} options={TABS.map((t) => ({ ...t, label: counts[t.value] ? `${t.label} (${counts[t.value]})` : t.label }))} />
            </div>
          </div>

          {tab === 'payment' && (
            <CustomerReceipts receipts={receipts} error={receiptsError} onRetry={loadReceipts} onChanged={afterReceipt} />
          )}
          {tab === 'payment' ? (
            <DataTable
              columns={payColumns}
              rows={payments}
              loading={loading}
              emptyIcon={PiggyBank}
              emptyTitle="Chưa có thanh toán nào"
              emptyDescription="Các lần trả tiền cho giao dịch của khách sẽ hiện ở đây."
              mobileCard={(r) => (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{r.target_label || '—'} <Badge tone={SERVICE[r.type]?.tone || 'gray'}>{SERVICE[r.type]?.label || r.type}</Badge></p>
                    <p className="text-xs text-ink-muted">{formatDate(r.payment_date)}{r.method ? ` · ${methodLabel(r.method)}` : ''}{r.notes ? ` · ${r.notes}` : ''}</p>
                  </div>
                  <span className="font-bold tabular text-success-600 shrink-0">{formatCurrency(r.amount)}</span>
                </div>
              )}
              footer={payments.length > 0 && (
                <tr>
                  <td className="px-3 py-2.5" colSpan={3}>Tổng {payments.length} lần</td>
                  <td className="px-3 py-2.5 text-right tabular text-success-600">{formatCurrency(payments.reduce((s, r) => s + num(r.amount), 0))}</td>
                  <td className="hidden md:table-cell" /><td className="hidden lg:table-cell" />
                </tr>
              )}
            />
          ) : (
            <DataTable
              columns={txColumns}
              rows={visibleRows}
              loading={loading}
              rowClassName={(r) => (r.cancelled ? 'opacity-60' : r.status === 'overdue' ? 'bg-danger-50/40' : '')}
              emptyIcon={ListOrdered}
              emptyTitle={transactions.length ? 'Không có giao dịch loại này' : 'Chưa có giao dịch nào'}
              emptyDescription={from || to ? 'Thử mở rộng khoảng thời gian.' : 'Giao dịch của khách ở các mục Công nợ vé / Vé tàu / Hộ chiếu / Tour sẽ hiện ở đây.'}
              mobileCard={(r) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink truncate">{r.desc}</p>
                      <p className="text-xs text-ink-muted"><Badge tone={r.tone}>{r.typeLabel}</Badge> · {formatDate(r.date)}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">Giá bán <b className="text-ink tabular">{formatCurrency(r.sold)}</b></span>
                    <span className={`font-bold tabular ${r.remaining <= 0 ? 'text-success-600' : 'text-danger-600'}`}>{r.remaining <= 0 ? 'Đã trả đủ' : `Nợ ${formatCurrency(r.remaining)}`}</span>
                  </div>
                </div>
              )}
              footer={txFooter}
            />
          )}
        </>
      )}

      {customer && (
        <CustomerFormModal
          open={editing}
          initial={customer}
          companies={companies}
          onClose={() => setEditing(false)}
          onSaved={() => load({ silent: true })}
        />
      )}

      {customer && owned && (
        <ReceiptModal open={receiptOpen} customerId={customer.id} onClose={() => setReceiptOpen(false)} onDone={afterReceipt} />
      )}

      {customer && statementOpen && (
        <CustomerStatement
          open={statementOpen}
          onClose={() => setStatementOpen(false)}
          customer={customer}
          transactions={transactions}
          payments={payments}
          totals={totals}
          from={from}
          to={to}
          onCopied={() => toast.success('Đã sao chép tóm tắt, dán vào Zalo để gửi khách')}
        />
      )}
    </div>
  );
}
