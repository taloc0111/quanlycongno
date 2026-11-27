import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Upload, Trash2, Pencil, Users, Landmark, UserX, Cake, Eye, RefreshCw, RotateCcw, Building2, FileText,
} from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { useNavigation } from './hooks/useNavigation.jsx';
import { useFeedback } from './ui/FeedbackContext';
import { useTableState } from './hooks/useTableState';
import { api, qs } from './services/client';
import { formatCurrency, formatDate, num, today, monthOf } from './utils/format';
import {
  Button, IconButton, Select, SearchInput, Badge, PageHeader, StatCard, DataTable, ErrorBanner,
} from './ui';
import AgencyFilter from './components/AgencyFilter';
import ImportModal from './components/ImportModal';
import CustomerDetail, { CustomerFormModal } from './modules/CustomerDetail';

const CUSTOMER_IMPORT_FIELDS = [
  { key: 'name', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên'] },
  { key: 'phone', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone', 'điện thoại'] },
  { key: 'email', label: 'Email', aliases: ['mail'] },
  { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'address'] },
  { key: 'idNumber', label: 'CCCD/CMND', aliases: ['cccd', 'cmnd', 'can cuoc', 'id'] },
  { key: 'type', label: 'Loại', aliases: ['type', 'phan loai'] },
];
const CUSTOMER_IMPORT_SAMPLE = {
  name: 'Nguyễn Văn A', phone: '0901234567', email: 'a@gmail.com',
  address: 'Hà Nội', idNumber: '0010xxxxxxxx', type: 'individual',
};

const FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'debtor', label: 'Còn nợ' },
  { value: 'company', label: 'Công ty' },
  { value: 'individual', label: 'Cá nhân' },
];

/** Sinh nhật trong tháng hiện tại (so sánh phần MM của 'YYYY-MM-DD'). */
const birthdayThisMonth = (c) => !!c.birthday && monthOf(c.birthday).slice(5) === today().slice(5, 7);

const COLUMNS = [
  { key: 'name', label: 'Khách hàng', sortable: true, required: true },
  { key: 'phone', label: 'SĐT', sortable: true },
  { key: 'type', label: 'Loại', sortable: true, hideBelow: 'md' },
  { key: 'owner', label: 'Đại lý', hideBelow: 'lg' },
  { key: 'birthday', label: 'Sinh nhật', hideBelow: 'lg', sortable: true },
  { key: 'outstanding', label: 'Còn nợ', align: 'right', sortable: true, required: true },
];

export default function CustomerApp({ param }) {
  if (param) return <CustomerDetail key={param} id={param} />;
  return <CustomerList />;
}

function CustomerList() {
  const { user } = useAuth();
  const { navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const currentUserId = user?.id;

  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [form, setForm] = useState(null);          // null = đóng; {} = thêm; row = sửa
  const [importOpen, setImportOpen] = useState(false);

  const t = useTableState({ storageKey: 'customers', columns: COLUMNS, pageSize: 50, defaultSort: { key: 'name', dir: 'asc' } });
  const kind = t.filters.kind || 'all';

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setRows(await api.get(`/customers${qs({ agencyId })}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agencyId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/companies').then(setCompanies).catch(() => {}); }, []);

  const companyName = useCallback((id) => companies.find((c) => String(c.id) === String(id))?.name, [companies]);
  const owned = (row) => !currentUserId || row.user_id === currentUserId;

  const { filtered, sorted, paged, totalPages, page } = t.process(rows, {
    searchText: (r) => `${r.name || ''} ${r.phone || ''} ${r.email || ''} ${r.id_number || ''} ${companyName(r.company_id) || ''}`,
    filterFns: [
      kind === 'debtor' ? (r) => num(r.outstanding) > 0 : null,
      kind === 'company' ? (r) => r.type === 'company' : null,
      kind === 'individual' ? (r) => r.type !== 'company' : null,
    ],
    sortValue: (r, key) => {
      if (key === 'outstanding') return num(r.outstanding);
      if (key === 'type') return r.type === 'company' ? `1${companyName(r.company_id) || ''}` : '0';
      if (key === 'birthday') return monthOf(r.birthday).slice(5) + (r.birthday || '').slice(8, 10);
      return String(r[key] || '').toLowerCase();
    },
  });

  const stats = useMemo(() => ({
    count: filtered.length,
    outstanding: filtered.reduce((s, r) => s + Math.max(0, num(r.outstanding)), 0),
    debtors: filtered.filter((r) => num(r.outstanding) > 0).length,
    birthdays: filtered.filter(birthdayThisMonth).length,
  }), [filtered]);

  // ---------- Chọn nhiều / xoá ----------
  const selectableIds = sorted.filter(owned).map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => t.selected.includes(id));
  const toggleAll = () => t.setSelected(allSelected ? [] : selectableIds);

  const remove = async (row) => {
    if (!(await confirm({ title: 'Xoá khách hàng', message: `Xoá khách "${row.name}"? Không thể hoàn tác.` }))) return;
    try {
      await api.del(`/customers/${row.id}`);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      t.setSelected((s) => s.filter((x) => x !== row.id));
      toast.success('Đã xoá khách hàng');
    } catch (err) { toast.error(err.message); }
  };

  const bulkDelete = async () => {
    const n = t.selected.length;
    if (!(await confirm({ title: 'Xoá hàng loạt', message: `Xoá ${n} khách hàng đã chọn? Không thể hoàn tác.`, confirmText: `Xoá ${n} mục` }))) return;
    try {
      const data = await api.post('/customers/bulk-delete', { ids: t.selected });
      const removed = new Set(t.selected);
      setRows((rs) => rs.filter((r) => !removed.has(r.id)));
      t.clearSelection();
      toast.success(`Đã xoá ${data.deleted} khách hàng`);
    } catch (err) { toast.error(err.message); }
  };

  const importCustomers = async (importRows) => {
    try {
      const data = await api.post('/customers/import', { rows: importRows });
      return { inserted: data.inserted || 0, skipped: data.skipped || 0, failed: data.failed ?? (data.errors?.length || 0), errors: data.errors || [] };
    } catch (err) {
      const d = err.data || {};
      return { inserted: d.inserted || 0, skipped: d.skipped || 0, failed: d.failed ?? (d.errors?.length || 0), errors: d.errors || [{ row: '-', message: d.error || err.message }] };
    }
  };

  // ---------- Cột ----------
  const columns = [
    ...COLUMNS.filter((c) => c.required || t.isVisible(c.key)).map((c) => ({
      ...c,
      render: {
        name: (r) => (
          <button type="button" onClick={() => navigate('customer', r.id)} className="flex items-center gap-2.5 text-left group/name">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-xs font-bold">{(r.name || '?').trim().charAt(0).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink group-hover/name:text-brand-600 group-hover/name:underline truncate max-w-[220px]">{r.name}</span>
              {r.email && <span className="block text-xs text-ink-faint truncate max-w-[220px]">{r.email}</span>}
            </span>
          </button>
        ),
        phone: (r) => r.phone ? <a href={`tel:${r.phone}`} className="hover:text-brand-600 tabular">{r.phone}</a> : <span className="text-ink-faint">—</span>,
        type: (r) => r.type === 'company'
          ? <Badge tone="purple" icon={Building2}>{companyName(r.company_id) || 'Công ty'}</Badge>
          : <Badge tone="gray">Cá nhân</Badge>,
        owner: (r) => <span className="text-xs text-ink-muted">{r.owner_name || r.owner_username || ''}</span>,
        birthday: (r) => r.birthday ? (
          <span className="inline-flex items-center gap-1.5">{formatDate(r.birthday)}{birthdayThisMonth(r) && <Badge tone="warning" icon={Cake}>Tháng này</Badge>}</span>
        ) : <span className="text-ink-faint">—</span>,
        outstanding: (r) => {
          const o = num(r.outstanding);
          const limit = num(r.credit_limit);
          return (
            <span className="inline-flex flex-col items-end">
              <span className={`font-bold tabular ${o > 0 ? 'text-danger-600' : 'text-success-600'}`}>{formatCurrency(o)}</span>
              {limit > 0 && o > limit && <span className="text-[11px] text-danger-600">vượt hạn mức {formatCurrency(limit)}</span>}
            </span>
          );
        },
      }[c.key],
    })),
    {
      key: '__actions', label: '', align: 'right', width: 110,
      render: (row) => owned(row) ? (
        <div className="flex justify-end gap-0.5 opacity-70 group-hover:opacity-100 transition">
          <IconButton icon={FileText} title="Chi tiết / bảng kê" variant="ghost" onClick={() => navigate('customer', row.id)} />
          <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={() => setForm(row)} />
          <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(row)} />
        </div>
      ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>,
    },
  ];

  const mobileCard = (r) => {
    const o = num(r.outstanding);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => navigate('customer', r.id)} className="min-w-0 text-left">
            <p className="font-semibold text-ink truncate">{r.name}</p>
            <p className="text-xs text-ink-muted truncate">{r.phone || 'không SĐT'}{r.type === 'company' ? ` · ${companyName(r.company_id) || 'Công ty'}` : ''}</p>
          </button>
          <span className={`font-bold tabular shrink-0 ${o > 0 ? 'text-danger-600' : 'text-success-600'}`}>{o > 0 ? `Nợ ${formatCurrency(o)}` : 'Không nợ'}</span>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="xs" variant="soft" icon={FileText} onClick={() => navigate('customer', r.id)}>Chi tiết</Button>
          {owned(r) ? (
            <>
              <Button size="xs" variant="secondary" icon={Pencil} onClick={() => setForm(r)}>Sửa</Button>
              <Button size="xs" variant="ghost" icon={Trash2} className="text-danger-600" onClick={() => remove(r)}>Xoá</Button>
            </>
          ) : <Badge tone="outline" icon={Eye}>Chỉ xem</Badge>}
        </div>
      </div>
    );
  };

  const hasFilter = t.search || kind !== 'all';

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Khách hàng"
        description="Danh bạ khách, công nợ gộp 4 dịch vụ và bảng kê in được."
        actions={(
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>Import</Button>
            <Button icon={Plus} onClick={() => setForm({})}>Thêm khách</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Users} label="Số khách" value={stats.count} sub={hasFilter ? 'theo bộ lọc' : `${rows.length} tổng`} tone="brand" />
        <StatCard icon={Landmark} label="Tổng còn nợ" value={formatCurrency(stats.outstanding)} tone="danger" onClick={() => t.setFilter('kind', kind === 'debtor' ? 'all' : 'debtor')} sub="Bấm để lọc khách còn nợ" />
        <StatCard icon={UserX} label="Khách còn nợ" value={stats.debtors} sub={stats.count ? `${Math.round((stats.debtors / stats.count) * 100)}% số khách` : ''} tone="warning" />
        <StatCard icon={Cake} label="Sinh nhật tháng này" value={stats.birthdays} sub="Gửi lời chúc giữ khách" tone="purple" />
      </div>

      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={t.search} onChange={t.setSearch} placeholder="Tìm tên, SĐT, email, CCCD, công ty…" className="lg:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" value={kind} onChange={(e) => t.setFilter('kind', e.target.value)} className="w-36">
            {FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <AgencyFilter value={agencyId} onChange={setAgencyId} />
          {hasFilter && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { t.setSearch(''); t.setFilters({}); }}>Xoá lọc</Button>}
        </div>
        <div className="flex items-center gap-1 lg:ml-auto">
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
        </div>
      </div>

      {t.selected.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-danger-100 bg-danger-50 px-4 py-2.5 animate-fade-in">
          <span className="text-sm font-medium text-danger-700">Đã chọn {t.selected.length} khách</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={t.clearSelection}>Bỏ chọn</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={bulkDelete}>Xoá đã chọn</Button>
          </div>
        </div>
      )}

      <ErrorBanner message={error} onRetry={load} />

      <DataTable
        columns={columns}
        rows={paged}
        loading={loading}
        sort={t.sort}
        onSort={t.toggleSort}
        selectable
        selectedIds={t.selected}
        onToggleRow={t.toggleSelect}
        onToggleAll={toggleAll}
        allSelected={allSelected}
        canSelect={owned}
        emptyIcon={Users}
        emptyTitle={rows.length ? 'Không có khách nào khớp bộ lọc' : 'Chưa có khách hàng'}
        emptyDescription={rows.length ? 'Thử đổi từ khoá hoặc bộ lọc.' : 'Thêm khách thủ công hoặc Import từ Excel. Khách cũng được tạo tự động khi nhập vé.'}
        emptyAction={!rows.length && <Button icon={Plus} onClick={() => setForm({})}>Thêm khách</Button>}
        pagination={{ page, totalPages, total: sorted.length, pageSize: t.pageSize, onChange: t.setPage }}
        mobileCard={mobileCard}
      />

      <CustomerFormModal
        open={!!form}
        initial={form?.id ? form : null}
        companies={companies}
        onClose={() => setForm(null)}
        onSaved={() => load({ silent: true })}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import khách hàng từ Excel/CSV"
        templateName="mau-import-khach-hang.xlsx"
        fields={CUSTOMER_IMPORT_FIELDS}
        sampleRow={CUSTOMER_IMPORT_SAMPLE}
        onImport={importCustomers}
        onSuccess={() => load({ silent: true })}
      />
    </div>
  );
}
