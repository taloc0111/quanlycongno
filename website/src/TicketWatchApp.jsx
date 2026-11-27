import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, PlaneTakeoff, Ticket, RefreshCw, TrendingDown, TrendingUp, Minus, Radar, BellRing,
  History, CheckCircle2, Target, ShoppingCart, RotateCcw, Phone, Users, Lock, AlertTriangle,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { api } from './services/client';
import { formatCurrency, formatCompact, formatDate, formatDateTime, daysUntil, num } from './utils/format';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import {
  Button, IconButton, Field, Input, Select, MoneyField, DateField, SearchInput, Textarea, Switch,
  Modal, Card, Badge, PageHeader, StatCard, ErrorBanner, EmptyState, Skeleton, Segmented,
} from './ui';

const STATUS = {
  watching: { label: 'Đang canh', tone: 'brand' },
  quoted: { label: 'Đã báo giá', tone: 'warning' },
  booked: { label: 'Đã đặt', tone: 'success' },
  cancelled: { label: 'Huỷ', tone: 'gray' },
};
const EMPTY = {
  customerName: '', phoneNumber: '', route: '', departDate: '', returnDate: '',
  airline: '', pax: '1', targetPrice: '', status: 'watching', notes: '', autoTrack: false,
};
const FILTERS = [
  { value: 'active', label: 'Đang theo dõi' },
  { value: 'booked', label: 'Đã đặt' },
  { value: 'cancelled', label: 'Huỷ' },
  { value: 'all', label: 'Tất cả' },
];

// Hãng hỗ trợ auto canh giá (khớp với resolveAdapter ở backend).
const AUTO_AIRLINES = ['Vietjet', 'Vietnam Airlines', 'Bamboo', 'Sun PhuQuoc', 'Vietravel'];
const supportsAuto = (airline) => /vietjet|vietnam air|vna|bamboo|sun ?ph|vietravel/.test((airline || '').toLowerCase());

// "vừa xong" / "5 phút trước" / "2 giờ trước" / "3 ngày trước" từ timestamp.
const fmtAgo = (s) => {
  if (!s) return '';
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 60) return 'vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
  return `${Math.floor(sec / 86400)} ngày trước`;
};
// Giá xem như "cũ" nếu lấy đã quá 24h (worker canh thưa do hạn mức) → nhắc người dùng.
const isStale = (s) => s && (Date.now() - new Date(s).getTime()) > 24 * 3600000;
// 'yyyy-mm-dd HH:MM' → 'HH:MM' (giờ cất cánh chuyến rẻ nhất).
const fmtHm = (s) => (s && s.length >= 16 ? s.slice(11, 16) : '');
const isActive = (w) => w.status === 'watching' || w.status === 'quoted';
const priceHit = (w) => num(w.last_price) > 0 && num(w.target_price) > 0 && num(w.last_price) <= num(w.target_price);

/** Mũi tên xu hướng: last_price so với prev_price. */
function Trend({ w }) {
  const cur = num(w.last_price); const prev = num(w.prev_price);
  if (!(cur > 0 && prev > 0)) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-ink-faint" title="Không đổi so lần canh trước"><Minus size={12} /> 0</span>;
  const down = diff < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${down ? 'text-success-600' : 'text-danger-600'}`} title={`${down ? 'Giảm' : 'Tăng'} ${formatCurrency(Math.abs(diff))} so lần canh trước`}>
      {down ? <TrendingDown size={12} /> : <TrendingUp size={12} />}{formatCompact(Math.abs(diff))}
    </span>
  );
}

export default function TicketWatchApp() {
  const { refreshProfile } = useAuth();
  const { toast, confirm } = useFeedback();
  const [watches, setWatches] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false); // 403 featureDisabled
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('active'); // active = watching+quoted
  const [form, setForm] = useState(null); // null = đóng; { ...EMPTY, id? }
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(null); // { watch, ticketAmount, costAmount }
  const [bookingSaving, setBookingSaving] = useState(false);
  const [checkingId, setCheckingId] = useState(null); // watch đang "lấy giá ngay"
  const [history, setHistory] = useState(null); // { watch, rows, loading }

  const handleApiError = useCallback((err, prefix = '') => {
    if (err?.status === 403 && err?.data?.featureDisabled) { setDisabled(true); refreshProfile(); return; }
    if (err?.status === 503 || err?.status === 429) { toast.warning(err.message || 'Dịch vụ tra giá đang bận, thử lại sau.'); return; }
    toast.error(prefix + (err?.message || 'Có lỗi xảy ra'));
  }, [toast, refreshProfile]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setWatches(await api.get('/ticket-watches'));
      setDisabled(false);
    } catch (err) {
      if (err?.status === 403 && err?.data?.featureDisabled) setDisabled(true);
      else setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/customers').then(setCustomers).catch(() => {});
    api.get('/routes').then(setRoutes).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return watches.filter((w) => {
      const matchText = !q || w.customer_name?.toLowerCase().includes(q)
        || w.phone_number?.includes(q) || w.route?.toLowerCase().includes(q) || w.airline?.toLowerCase().includes(q);
      const matchStatus = filterStatus === 'all' ? true
        : filterStatus === 'active' ? isActive(w)
        : w.status === filterStatus;
      return matchText && matchStatus;
    });
  }, [watches, search, filterStatus]);

  const stats = useMemo(() => ({
    active: watches.filter(isActive).length,
    hit: watches.filter((w) => isActive(w) && priceHit(w)).length,
    booked: watches.filter((w) => w.status === 'booked').length,
    auto: watches.filter((w) => isActive(w) && w.auto_track).length,
  }), [watches]);

  // ---------- Form ----------
  const openAdd = () => setForm({ ...EMPTY });
  const openEdit = (w) => setForm({
    id: w.id,
    customerName: w.customer_name || '', phoneNumber: w.phone_number || '', route: w.route || '',
    departDate: (w.depart_date || '').slice(0, 10), returnDate: (w.return_date || '').slice(0, 10),
    airline: w.airline || '', pax: String(w.pax || 1), targetPrice: w.target_price || '',
    status: w.status || 'watching', notes: w.notes || '', autoTrack: !!w.auto_track,
  });
  const closeForm = () => setForm(null);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Khi gõ/chọn tên khách trùng danh bạ → tự điền SĐT nếu đang trống.
  const onCustomerName = (name) => {
    const hit = customers.find((c) => c.name === name);
    setForm((f) => ({ ...f, customerName: name, phoneNumber: f.phoneNumber || hit?.phone || '' }));
  };

  const save = async () => {
    if (!form.customerName.trim()) { toast.error('Nhập tên khách hàng'); return; }
    setSaving(true);
    try {
      const { id, ...body } = form;
      if (id) await api.put(`/ticket-watches/${id}`, body);
      else await api.post('/ticket-watches', body);
      toast.success(id ? 'Đã cập nhật yêu cầu canh vé' : 'Đã thêm yêu cầu canh vé');
      setForm(null);
      load({ silent: true });
    } catch (err) { handleApiError(err); }
    finally { setSaving(false); }
  };

  // Chỉ gửi { status } — backend cập nhật từng phần.
  const setStatus = async (w, status) => {
    try {
      await api.put(`/ticket-watches/${w.id}`, { status });
      setWatches((rows) => rows.map((r) => (r.id === w.id ? { ...r, status } : r)));
      toast.success(`${w.customer_name}: ${STATUS[status]?.label}`);
      load({ silent: true });
    } catch (err) { handleApiError(err); }
  };

  const remove = async (w) => {
    const ok = await confirm({ title: 'Xoá yêu cầu canh vé', message: `Xoá yêu cầu canh vé của "${w.customer_name}"?` });
    if (!ok) return;
    try {
      await api.del(`/ticket-watches/${w.id}`);
      setWatches((rows) => rows.filter((r) => r.id !== w.id));
      toast.success('Đã xoá');
    } catch (err) { handleApiError(err); }
  };

  // Lấy giá ngay cho 1 yêu cầu (gọi worker — mất vài chục giây).
  const checkNow = async (w) => {
    setCheckingId(w.id);
    try {
      const r = await api.post(`/ticket-watches/${w.id}/check-now`);
      if (r.ok) toast.success(`Giá hiện tại: ${formatCurrency(r.price)}${r.alerted ? ' — đạt giá mong muốn!' : ''}`);
      else toast.error('Chưa lấy được giá: ' + (r.error || 'không rõ'));
      load({ silent: true });
    } catch (err) {
      handleApiError(err);
    } finally {
      setCheckingId(null);
    }
  };

  const openHistory = async (w) => {
    setHistory({ watch: w, rows: [], loading: true });
    try {
      const rows = await api.get(`/ticket-watches/${w.id}/snapshots`);
      setHistory({ watch: w, rows, loading: false });
    } catch (err) {
      handleApiError(err, 'Lỗi tải lịch sử: ');
      setHistory(null);
    }
  };

  // "Đã đặt" → mở modal tạo công nợ vé đã điền sẵn.
  const openBooking = (w) => setBooking({ watch: w, ticketAmount: w.target_price || '', costAmount: '' });

  const confirmBooking = async () => {
    const { watch, ticketAmount, costAmount } = booking;
    if (!(parseFloat(ticketAmount) > 0)) { toast.error('Nhập giá vé bán hợp lệ'); return; }
    setBookingSaving(true);
    try {
      await api.post('/debts', {
        customerName: watch.customer_name,
        phoneNumber: watch.phone_number || '',
        route: watch.route || '',
        flightDate: watch.depart_date || null,
        ticketAmount: parseFloat(ticketAmount) || 0,
        costAmount: parseFloat(costAmount) || 0,
        paid: 0,
        notes: 'Từ canh vé',
      });
      await api.put(`/ticket-watches/${watch.id}`, { status: 'booked' });
      setBooking(null);
      toast.success('Đã tạo công nợ vé + đánh dấu Đã đặt');
      load({ silent: true });
    } catch (err) { handleApiError(err); }
    finally { setBookingSaving(false); }
  };

  // ---------- Biểu đồ lịch sử ----------
  const chartData = useMemo(() => {
    if (!history?.rows?.length) return [];
    return [...history.rows]
      .filter((s) => s.ok && s.price != null)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((s) => ({ t: new Date(s.created_at).getTime(), price: num(s.price), label: formatDateTime(s.created_at), airline: s.airline, flightNo: s.flight_no }));
  }, [history]);

  // ---------- Thẻ canh vé ----------
  const renderCard = (w) => {
    const d = daysUntil(w.depart_date);
    const active = isActive(w);
    const hasPrice = num(w.last_price) > 0;
    const hit = priceHit(w);
    const target = num(w.target_price);
    const overTarget = hasPrice && target > 0 && num(w.last_price) > target ? num(w.last_price) - target : null;
    const urgency = !active || d === null ? 'border-surface-border'
      : d < 0 ? 'border-slate-300' : d <= 2 ? 'border-danger-500/60' : d <= 6 ? 'border-warning-500/60' : 'border-success-500/50';
    const urgencyText = d === null ? '' : d < 0 ? `${-d} ngày trước` : d === 0 ? 'Hôm nay' : d === 1 ? 'Ngày mai' : `còn ${d} ngày`;
    const urgencyTone = d === null ? 'gray' : d < 0 ? 'gray' : d <= 2 ? 'danger' : d <= 6 ? 'warning' : 'success';
    const stale = isStale(w.last_checked_at);

    return (
      <Card key={w.id} padded={false} className={`flex flex-col border-l-4 ${urgency} ${hit ? 'ring-1 ring-success-500/30' : ''}`}>
        <div className="p-4 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{w.customer_name}</p>
              {w.phone_number && <p className="inline-flex items-center gap-1 text-xs text-ink-muted"><Phone size={11} /> {w.phone_number}</p>}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge tone={STATUS[w.status]?.tone || 'gray'} dot>{STATUS[w.status]?.label || w.status}</Badge>
              {hit && active && <Badge tone="success" icon={BellRing}>Đạt giá</Badge>}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><PlaneTakeoff size={15} className="text-brand-500" />{w.route || '—'}</span>
            {w.airline && <span className="text-xs text-ink-muted">· {w.airline}</span>}
            {w.pax > 1 && <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Users size={11} /> {w.pax} khách</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>{formatDate(w.depart_date) || '—'}{w.return_date ? ` → ${formatDate(w.return_date)}` : ''}</span>
            {active && urgencyText && <Badge tone={urgencyTone}>{urgencyText}</Badge>}
          </div>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-ink-soft">
            <Target size={14} className="text-ink-faint" /> Mong muốn: <b className="text-ink tabular">{target > 0 ? formatCurrency(target) : '—'}</b>
          </p>

          {/* Khối auto canh giá */}
          {(w.auto_track || hasPrice || w.last_checked_at) && (
            <div className={`mt-2.5 rounded-xl border px-3 py-2 text-sm ${hit ? 'border-success-100 bg-success-50' : 'border-surface-border bg-surface-muted'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                  <Radar size={13} className={w.auto_track ? 'text-brand-500' : 'text-ink-faint'} /> {w.auto_track ? 'Auto canh giá' : 'Giá gần nhất'}
                </span>
                {hasPrice ? (
                  <span className="inline-flex items-center gap-2">
                    <Trend w={w} />
                    <span className={`font-bold tabular ${hit ? 'text-success-700' : 'text-ink'}`}>{formatCurrency(w.last_price)}</span>
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint">{w.last_check_ok === false ? 'chưa lấy được' : 'chưa có giá'}</span>
                )}
              </div>
              {hasPrice && (w.last_airline || w.last_depart_time) && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                  <PlaneTakeoff size={11} className="text-brand-400 shrink-0" />
                  {w.last_airline && <span className="font-medium text-ink-soft">{w.last_airline}</span>}
                  {w.last_depart_time && <span>· {fmtHm(w.last_depart_time)}</span>}
                  {w.last_flight_no && <span className="text-ink-faint">· {w.last_flight_no}</span>}
                </p>
              )}
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                {hit ? <span className="inline-flex items-center gap-1 font-semibold text-success-700"><BellRing size={11} /> Đã đạt giá mong muốn!</span>
                  : w.last_check_ok === false && w.last_error ? <span className="truncate text-warning-600" title={w.last_error}>{w.last_error}</span>
                  : overTarget != null ? <span className="text-ink-muted" title={`Cao hơn giá mong muốn ${formatCurrency(overTarget)}`}>cao hơn {formatCompact(overTarget)}</span>
                  : <span />}
                <span className={`ml-auto shrink-0 ${stale ? 'text-warning-600' : 'text-ink-faint'}`} title={stale ? 'Giá đã cũ (>24h) — worker canh thưa do hạn mức' : ''}>
                  {w.last_checked_at ? fmtAgo(w.last_checked_at) : 'chưa chạy'}{stale ? ' · cũ' : ''}
                </span>
              </div>
            </div>
          )}

          {w.notes && <p className="mt-2 text-xs italic text-ink-muted">{w.notes}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-border px-3 py-2.5">
          {active ? (
            <>
              {w.status === 'watching' && <Button size="xs" variant="secondary" onClick={() => setStatus(w, 'quoted')}>Đã báo giá</Button>}
              <Button size="xs" variant="success" icon={ShoppingCart} onClick={() => openBooking(w)}>Đã đặt</Button>
              <Button size="xs" variant="ghost" onClick={() => setStatus(w, 'cancelled')}>Huỷ</Button>
              {w.route && w.depart_date && (
                <Button size="xs" variant="soft" icon={RefreshCw} loading={checkingId === w.id} onClick={() => checkNow(w)} title="Lấy giá hiện tại ngay (mất vài chục giây)">
                  {checkingId === w.id ? 'Đang lấy…' : 'Lấy giá ngay'}
                </Button>
              )}
            </>
          ) : (
            <Button size="xs" variant="secondary" icon={RotateCcw} onClick={() => setStatus(w, 'watching')}>Canh lại</Button>
          )}
          {(w.auto_track || w.last_checked_at) && (
            <Button size="xs" variant="ghost" icon={History} onClick={() => openHistory(w)} title="Lịch sử giá">Lịch sử</Button>
          )}
          <div className="ml-auto flex gap-0.5">
            <IconButton icon={Pencil} title="Sửa" variant="primary" onClick={() => openEdit(w)} />
            <IconButton icon={Trash2} title="Xoá" variant="danger" onClick={() => remove(w)} />
          </div>
        </div>
      </Card>
    );
  };

  if (disabled) {
    return (
      <div>
        <PageHeader help="fare-watch" icon={PlaneTakeoff} title="Canh vé" description="Theo dõi giá vé cho khách và báo khi tới giá mong muốn." />
        <Card>
          <EmptyState icon={Lock} title="Tính năng Canh vé chưa được bật cho tài khoản này" description="Liên hệ quản trị viên để bật tính năng." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        help="fare-watch"
        icon={PlaneTakeoff}
        title="Canh vé"
        description="Theo dõi giá vé cho khách và báo khi tới giá mong muốn."
        actions={<Button icon={Plus} onClick={openAdd}>Thêm canh vé</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Radar} label="Đang canh" value={stats.active} sub={`${stats.auto} tự động`} tone="brand" onClick={() => setFilterStatus('active')} />
        <StatCard icon={BellRing} label="Đã đạt giá" value={stats.hit} sub="Giá hiện tại ≤ mong muốn" tone={stats.hit > 0 ? 'success' : 'gray'} />
        <StatCard icon={CheckCircle2} label="Đã đặt" value={stats.booked} tone="purple" onClick={() => setFilterStatus('booked')} />
        <StatCard icon={Ticket} label="Tổng yêu cầu" value={watches.length} tone="gray" onClick={() => setFilterStatus('all')} />
      </div>

      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Tìm khách, SĐT, hành trình, hãng…" className="lg:w-80" />
        <Segmented value={filterStatus} onChange={setFilterStatus} options={FILTERS} />
        <div className="flex items-center gap-2 lg:ml-auto text-sm text-ink-muted">
          <span>{filtered.length} yêu cầu</span>
          <IconButton icon={RefreshCw} title="Tải lại" onClick={() => load({ silent: true })} className={refreshing ? 'animate-spin' : ''} />
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <Card key={i}><Skeleton className="h-5 w-40" /><Skeleton className="mt-3 h-4 w-56" /><Skeleton className="mt-2 h-4 w-32" /><Skeleton className="mt-4 h-14 w-full" /></Card>)}
        </div>
      ) : !error && filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Ticket}
            title={watches.length ? 'Không có yêu cầu nào khớp bộ lọc' : 'Chưa có yêu cầu canh vé nào'}
            description={watches.length ? 'Thử đổi bộ lọc trạng thái hoặc từ khoá.' : 'Thêm yêu cầu, bật tự động canh giá để hệ thống báo khi vé rẻ.'}
            action={!watches.length && <Button icon={Plus} onClick={openAdd}>Thêm canh vé</Button>}
          />
        </Card>
      ) : (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${error ? 'mt-4' : ''}`}>
          {filtered.map(renderCard)}
        </div>
      )}

      {/* Form thêm/sửa */}
      <Modal
        open={!!form}
        onClose={closeForm}
        icon={PlaneTakeoff}
        title={form?.id ? 'Sửa canh vé' : 'Thêm canh vé'}
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm}>Huỷ</Button>
            <Button loading={saving} onClick={save}>{form?.id ? 'Lưu thay đổi' : 'Thêm mới'}</Button>
          </>
        )}
      >
        {form && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Tên khách hàng" required htmlFor="tw-name">
              <Input id="tw-name" list="tw-customers" autoComplete="off" value={form.customerName} onChange={(e) => onCustomerName(e.target.value)} />
              <datalist id="tw-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </Field>
            <Field label="Số điện thoại" htmlFor="tw-phone">
              <Input id="tw-phone" value={form.phoneNumber} onChange={(e) => setField('phoneNumber', e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Hành trình" htmlFor="tw-route">
              <Input id="tw-route" list="tw-routes" autoComplete="off" value={form.route} onChange={(e) => setField('route', e.target.value.toUpperCase())} placeholder="VD: SGN-HAN" />
              <datalist id="tw-routes">{routes.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Hãng" hint="Để trống = canh rẻ nhất mọi hãng" htmlFor="tw-airline">
              <Input id="tw-airline" list="tw-airlines" autoComplete="off" value={form.airline} onChange={(e) => setField('airline', e.target.value)} placeholder="VD: Vietjet" />
              <datalist id="tw-airlines">{AUTO_AIRLINES.map((a) => <option key={a} value={a} />)}</datalist>
            </Field>
            <Field label="Ngày đi">
              <DateField value={form.departDate} onChange={(v) => setField('departDate', v)} />
            </Field>
            <Field label="Ngày về" hint="Có ngày về = khứ hồi">
              <DateField value={form.returnDate} onChange={(v) => setField('returnDate', v)} />
            </Field>
            <Field label="Số khách" htmlFor="tw-pax">
              <Input id="tw-pax" type="number" min="1" value={form.pax} onChange={(e) => setField('pax', e.target.value)} />
            </Field>
            <Field
              label="Giá mong muốn"
              htmlFor="tw-target"
              hint={form.returnDate ? 'So với TỔNG giá khứ hồi (đi + về), tính cho 1 khách.' : 'So với giá chiều đi, tính cho 1 khách.'}
            >
              <MoneyField id="tw-target" value={form.targetPrice} onChange={(v) => setField('targetPrice', v)} placeholder="VD: 2.000.000" />
            </Field>
            <Field label="Trạng thái" htmlFor="tw-status">
              <Select id="tw-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
            </Field>
            <Field label="Ghi chú" htmlFor="tw-notes">
              <Textarea id="tw-notes" rows={1} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="VD: khách muốn bay sáng, giá dưới 2tr" />
            </Field>

            {/* Bật auto canh giá */}
            <div className="sm:col-span-2 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"><Radar size={15} className="text-brand-600" /> Tự động canh giá</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Hệ thống tự lấy giá định kỳ và báo khi ≤ giá mong muốn. Cần <b>Hành trình</b> + <b>Ngày đi</b>;
                    không ghi <b>Hãng</b> = canh giá rẻ nhất của mọi hãng. Có <b>Ngày về</b> = canh TỔNG khứ hồi
                    (tốn 2 lượt tra giá mỗi lần canh thay vì 1).
                  </p>
                </div>
                <Switch checked={form.autoTrack} onChange={(v) => setField('autoTrack', v)} />
              </div>
              {form.autoTrack && (!form.route || !form.departDate) && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-warning-600"><AlertTriangle size={13} /> Cần nhập Hành trình và Ngày đi để auto canh chạy được.</p>
              )}
              {form.autoTrack && form.airline && !supportsAuto(form.airline) && (
                <p className="mt-2 inline-flex items-start gap-1 text-xs text-warning-600">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>Hãng lạ — hệ thống khớp theo tên hãng trên Google Flights (quen: {AUTO_AIRLINES.join(', ')}). Để trống ô Hãng nếu muốn canh giá rẻ nhất của mọi hãng.</span>
                </p>
              )}
            </div>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>

      {/* Modal tạo công nợ khi đặt được vé */}
      <Modal
        open={!!booking}
        onClose={() => setBooking(null)}
        icon={ShoppingCart}
        title="Tạo công nợ vé"
        subtitle={booking ? `${booking.watch.customer_name} · ${booking.watch.route || '—'} · ${formatDate(booking.watch.depart_date) || '—'}` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setBooking(null)}>Huỷ</Button>
            <Button variant="success" icon={CheckCircle2} loading={bookingSaving} onClick={confirmBooking}>Tạo công nợ</Button>
          </>
        )}
      >
        {booking && (
          <form onSubmit={(e) => { e.preventDefault(); confirmBooking(); }} className="space-y-3.5">
            <Field label="Giá vé bán" required htmlFor="bk-amount">
              <MoneyField id="bk-amount" value={booking.ticketAmount} onChange={(v) => setBooking({ ...booking, ticketAmount: v })} placeholder="Giá bán cho khách" />
            </Field>
            <Field label="Giá gốc" hint="Tuỳ chọn — giá nhập vé" htmlFor="bk-cost">
              <MoneyField id="bk-cost" value={booking.costAmount} onChange={(v) => setBooking({ ...booking, costAmount: v })} placeholder="Giá nhập vé" />
            </Field>
            {num(booking.ticketAmount) > 0 && (
              <p className="rounded-xl bg-surface-subtle px-3 py-2 text-sm text-ink-muted">
                Lợi nhuận dự kiến: <b className={`tabular ${num(booking.ticketAmount) - num(booking.costAmount) >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(num(booking.ticketAmount) - num(booking.costAmount))}</b>
              </p>
            )}
            <p className="text-xs text-ink-faint">Sẽ tạo 1 dòng trong Công nợ vé và đánh dấu yêu cầu là “Đã đặt”.</p>
            <button type="submit" className="hidden" aria-hidden />
          </form>
        )}
      </Modal>

      {/* Lịch sử giá */}
      <Modal
        open={!!history}
        onClose={() => setHistory(null)}
        icon={History}
        title="Lịch sử giá"
        subtitle={history ? `${history.watch.route || '—'}${history.watch.airline ? ` · ${history.watch.airline}` : ''} · ${formatDate(history.watch.depart_date) || '—'}` : undefined}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setHistory(null)}>Đóng</Button>}
      >
        {history && (history.loading ? (
          <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /></div>
        ) : history.rows.length === 0 ? (
          <EmptyState icon={History} title="Chưa có lần lấy giá nào" description="Bật tự động canh giá hoặc bấm “Lấy giá ngay” trên thẻ." compact />
        ) : (
          <div className="space-y-4">
            {chartData.length >= 2 && (
              <div className="rounded-xl border border-surface-border bg-white p-3">
                <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                  <span>Giá qua các lần canh</span>
                  {num(history.watch.target_price) > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-ink-faint" /> Mong muốn {formatCurrency(history.watch.target_price)}</span>}
                </div>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="2 4" />
                      <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(v) => formatDate(new Date(v))} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} minTickGap={32} />
                      <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={48} domain={['auto', 'auto']} />
                      <Tooltip
                        cursor={{ stroke: '#94a3b8', strokeWidth: 1 }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload;
                          return (
                            <div className="rounded-lg border border-surface-border bg-white px-2.5 py-1.5 text-xs shadow-pop">
                              <p className="text-ink-muted">{p.label}</p>
                              <p className="font-semibold tabular text-ink">{formatCurrency(p.price)}</p>
                              {(p.airline || p.flightNo) && <p className="text-ink-muted">{[p.airline, p.flightNo].filter(Boolean).join(' · ')}</p>}
                            </div>
                          );
                        }}
                      />
                      {num(history.watch.target_price) > 0 && <ReferenceLine y={num(history.watch.target_price)} stroke="#94a3b8" strokeDasharray="4 4" />}
                      <Line type="monotone" dataKey="price" stroke="#2447e3" strokeWidth={2} dot={{ r: 3, fill: '#2447e3', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            <div className="card overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-[13.5px]">
                  <thead className="sticky top-0">
                    <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2 text-left font-semibold">Thời điểm · chuyến</th>
                      <th className="px-3 py-2 text-right font-semibold">Giá</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {history.rows.map((s) => {
                      const target = num(history.watch.target_price);
                      const hit = s.ok && s.price != null && target > 0 && num(s.price) <= target;
                      return (
                        <tr key={s.id} className="align-top hover:bg-surface-muted">
                          <td className="px-3 py-2">
                            <div className="text-ink">{formatDateTime(s.created_at)}</div>
                            {s.ok && (s.airline || s.depart_time) && (
                              <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
                                <PlaneTakeoff size={11} className="text-brand-400 shrink-0" />
                                {s.airline && <span>{s.airline}</span>}
                                {s.depart_time && <span>· {fmtHm(s.depart_time)}</span>}
                                {s.flight_no && <span className="text-ink-faint">· {s.flight_no}</span>}
                              </div>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold tabular ${hit ? 'text-success-700' : s.ok ? 'text-ink' : ''}`}>
                            {s.ok && s.price != null ? (
                              <span className="inline-flex items-center gap-1">{hit && <BellRing size={12} />}{formatCurrency(s.price)}</span>
                            ) : (
                              <Badge tone="warning">{s.error ? <span title={s.error}>lỗi</span> : 'lỗi'}</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </Modal>
    </div>
  );
}
