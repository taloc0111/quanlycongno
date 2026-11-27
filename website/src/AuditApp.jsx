import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Plus, Pencil, Trash2, Wallet, LogIn, ChevronDown, ChevronUp, RefreshCw, RotateCcw, Activity } from 'lucide-react';
import { useFeedback } from './ui/FeedbackContext';
import { api, qs } from './services/client';
import { formatDate, formatDateTime, normalizeYmd } from './utils/format';
import { Button, IconButton, Select, SearchInput, Badge, PageHeader, EmptyState, ErrorBanner, Skeleton } from './ui';
import AgencyFilter from './components/AgencyFilter';

const ACTION = {
  create: { label: 'Tạo mới', tone: 'success', icon: Plus, ring: 'bg-success-50 text-success-600' },
  update: { label: 'Cập nhật', tone: 'brand', icon: Pencil, ring: 'bg-brand-50 text-brand-600' },
  delete: { label: 'Xoá', tone: 'danger', icon: Trash2, ring: 'bg-danger-50 text-danger-600' },
  payment: { label: 'Thanh toán', tone: 'purple', icon: Wallet, ring: 'bg-purple-50 text-purple-600' },
  login: { label: 'Đăng nhập', tone: 'gray', icon: LogIn, ring: 'bg-slate-100 text-slate-600' },
};

// Backend ghi entity dạng số ít ('debt'); brief dùng số nhiều — chấp nhận cả hai.
const ENTITY = [
  { keys: ['debt', 'debts'], label: 'Vé máy bay' },
  { keys: ['train_ticket', 'train_tickets'], label: 'Vé tàu' },
  { keys: ['passport', 'passports'], label: 'Hộ chiếu' },
  { keys: ['tour', 'tours'], label: 'Tour' },
  { keys: ['customer', 'customers'], label: 'Khách hàng' },
  { keys: ['payment', 'payments'], label: 'Thanh toán' },
  { keys: ['user', 'users'], label: 'Tài khoản' },
  { keys: ['invoice', 'invoices'], label: 'Hoá đơn' },
  { keys: ['deposit', 'deposits', 'fund_deposit'], label: 'Nộp quỹ' },
];
const entityOf = (e) => ENTITY.find((x) => x.keys.includes(e));

export default function AuditApp() {
  const { toast } = useFeedback();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('all');
  const [entity, setEntity] = useState('all');
  const [userId, setUserId] = useState('');
  const [open, setOpen] = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const data = await api.get(`/audit${qs({ limit: 200, userId })}`);
      setRows(data.rows || []);
      setUnsupported(false);
    } catch (err) {
      if (err.status === 404) setUnsupported(true);
      else setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (action !== 'all' && r.action !== action) return false;
      if (entity !== 'all') {
        const e = entityOf(r.entity);
        if (e ? e.keys[0] !== entity : r.entity !== entity) return false;
      }
      if (q && !`${r.summary || ''} ${r.username || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, action, entity]);

  // Gom theo ngày (mới nhất trước — API đã sắp theo created_at DESC).
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of filtered) {
      const day = normalizeYmd(r.created_at) || '—';
      if (!m.has(day)) m.set(day, []);
      m.get(day).push(r);
    }
    return [...m.entries()];
  }, [filtered]);

  const hasFilter = search || action !== 'all' || entity !== 'all';
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const copyDetails = async (r) => {
    try { await navigator.clipboard.writeText(JSON.stringify(r.details, null, 2)); toast.success('Đã sao chép chi tiết'); }
    catch { toast.error('Không sao chép được'); }
  };

  const dayLabel = (day) => {
    const todayYmd = normalizeYmd(new Date());
    if (day === todayYmd) return `Hôm nay · ${formatDate(day)}`;
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (day === normalizeYmd(y)) return `Hôm qua · ${formatDate(day)}`;
    return formatDate(day) || day;
  };

  return (
    <div>
      <PageHeader
        icon={History}
        title="Nhật ký thao tác"
        description="Ai đã thêm, sửa, xoá, thanh toán hay đăng nhập — và khi nào. Hiện 200 bản ghi mới nhất."
      />

      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Tìm theo nội dung hoặc tài khoản…" className="lg:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" value={action} onChange={(e) => setAction(e.target.value)} className="w-36">
            <option value="all">Mọi thao tác</option>
            {Object.entries(ACTION).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
          </Select>
          <Select size="sm" value={entity} onChange={(e) => setEntity(e.target.value)} className="w-40">
            <option value="all">Mọi đối tượng</option>
            {ENTITY.map((e) => <option key={e.keys[0]} value={e.keys[0]}>{e.label}</option>)}
          </Select>
          <AgencyFilter value={userId} onChange={setUserId} />
          {hasFilter && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { setSearch(''); setAction('all'); setEntity('all'); }}>Xoá lọc</Button>}
        </div>
        <div className="flex items-center gap-1 lg:ml-auto">
          <span className="text-xs text-ink-faint mr-1">{filtered.length}/{rows.length} bản ghi</span>
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      {unsupported ? (
        <div className="card"><EmptyState icon={History} title="Backend chưa hỗ trợ nhật ký" description="Cập nhật máy chủ lên bản mới có bảng audit_logs rồi tải lại trang." /></div>
      ) : loading ? (
        <div className="card p-4 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3"><Skeleton className="h-9 w-9 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>
          ))}
        </div>
      ) : !error && groups.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Activity}
            title={rows.length ? 'Không có bản ghi nào khớp bộ lọc' : 'Chưa có thao tác nào được ghi'}
            description={rows.length ? 'Thử đổi từ khoá, loại thao tác hoặc đối tượng.' : 'Các thao tác thêm/sửa/xoá/thanh toán từ giờ sẽ hiện ở đây.'}
          />
        </div>
      ) : !error && (
        <div className="space-y-5">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
                {dayLabel(day)} <span className="h-px flex-1 bg-surface-border" /> <span className="font-medium normal-case tracking-normal">{items.length} thao tác</span>
              </h3>
              <ol className="card divide-y divide-surface-border">
                {items.map((r) => {
                  const a = ACTION[r.action] || { label: r.action, tone: 'gray', icon: Activity, ring: 'bg-slate-100 text-slate-600' };
                  const Icon = a.icon;
                  const ent = entityOf(r.entity);
                  const hasDetails = r.details && Object.keys(r.details).length > 0;
                  const isOpen = !!open[r.id];
                  return (
                    <li key={r.id} className="flex gap-3 px-4 py-3">
                      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${a.ring}`}><Icon size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge tone={a.tone}>{a.label}</Badge>
                          {ent && <Badge tone="outline">{ent.label}{r.entity_id ? ` #${r.entity_id}` : ''}</Badge>}
                          <span className="text-xs text-ink-faint tabular ml-auto whitespace-nowrap">{formatDateTime(r.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm text-ink break-words">{r.summary || <span className="text-ink-faint">(không có mô tả)</span>}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">bởi <b className="text-ink-soft">{r.username || `#${r.user_id}`}</b></p>
                        {hasDetails && (
                          <div className="mt-1.5">
                            <button type="button" onClick={() => toggle(r.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                              {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {isOpen ? 'Ẩn chi tiết' : 'Xem chi tiết'}
                            </button>
                            {isOpen && (
                              <div className="relative mt-1.5">
                                <pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 text-xs text-ink-soft">{JSON.stringify(r.details, null, 2)}</pre>
                                <Button size="xs" variant="secondary" className="absolute right-2 top-2" onClick={() => copyDetails(r)}>Sao chép</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
