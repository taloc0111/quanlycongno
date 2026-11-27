import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlaneTakeoff, RefreshCw, ExternalLink, Phone, Ticket, CalendarDays, CheckCircle2 } from 'lucide-react';
import { api } from './services/client';
import { useFeedback } from './ui/FeedbackContext';
import { detectAirline } from './utils/airlines';
import { formatDate, today, addDays, daysUntil, ymdToDate, normalizeYmd } from './utils/format';
import { Button, SearchInput, Switch, Badge, EmptyState, Skeleton, PageHeader, ErrorBanner, Segmented, Card } from './ui';

const RANGES = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'tomorrow', label: 'Ngày mai' },
  { value: '7', label: '7 ngày' },
  { value: '30', label: '30 ngày' },
  { value: 'all', label: 'Tất cả sắp tới' },
];

const WEEKDAY = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** Ngày bay có nằm trong khoảng đã chọn không (chỉ tính từ hôm nay trở đi). */
function inRange(diff, range) {
  if (diff < 0) return false;
  if (range === 'today') return diff === 0;
  if (range === 'tomorrow') return diff === 1;
  if (range === 'all') return true;
  return diff <= Number(range);
}

function DayBadge({ diff }) {
  if (diff === 0) return <Badge tone="warning" dot>Hôm nay</Badge>;
  if (diff === 1) return <Badge tone="danger" dot>Ngày mai</Badge>;
  if (diff <= 7) return <Badge tone="brand">{diff} ngày nữa</Badge>;
  return null;
}

export default function UpcomingFlightsApp() {
  const { toast } = useFeedback();
  const [debts, setDebts] = useState([]);
  const [airlines, setAirlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState('7');
  const [search, setSearch] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setDebts(await api.get('/debts'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/airlines').then(setAirlines).catch(() => {}); }, []);

  // Gom theo ngày bay (tăng dần), mỗi nhóm đếm số khách chưa check-in.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map();
    for (const d of debts) {
      const fd = normalizeYmd(d.flight_date);
      if (!fd) continue;
      const diff = daysUntil(fd);
      if (diff === null || !inRange(diff, range)) continue;
      if (onlyPending && d.checked_in) continue;
      if (q && ![d.customer_name, d.phone_number, d.route, d.airline, d.ticket_code].some((v) => String(v || '').toLowerCase().includes(q))) continue;
      const g = map.get(fd) || { date: fd, diff, items: [], pending: 0 };
      g.items.push(d);
      if (!d.checked_in) g.pending += 1;
      map.set(fd, g);
    }
    const out = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    out.forEach((g) => g.items.sort((a, b) => Number(a.checked_in) - Number(b.checked_in) || String(a.customer_name || '').localeCompare(String(b.customer_name || ''))));
    return out;
  }, [debts, range, search, onlyPending]);

  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const pendingTotal = groups.reduce((s, g) => s + g.pending, 0);

  const toggleCheckin = async (d, next) => {
    setDebts((prev) => prev.map((x) => (x.id === d.id ? { ...x, checked_in: next } : x)));
    try {
      await api.put(`/debts/${d.id}/checkin`, { checkedIn: next });
      window.dispatchEvent(new CustomEvent('data:debts-changed'));
      toast.success(next ? `Đã check-in cho ${d.customer_name}` : 'Đã bỏ đánh dấu check-in');
    } catch (err) {
      setDebts((prev) => prev.map((x) => (x.id === d.id ? { ...x, checked_in: !next } : x)));
      toast.error(err.message);
    }
  };

  const rangeHint = {
    today: 'Khách bay hôm nay',
    tomorrow: 'Khách bay ngày mai',
    7: `Khách bay từ hôm nay tới ${formatDate(addDays(today(), 7))}`,
    30: `Khách bay từ hôm nay tới ${formatDate(addDays(today(), 30))}`,
    all: 'Mọi chuyến bay từ hôm nay trở đi',
  }[range];

  return (
    <div>
      <PageHeader
        help="upcoming"
        icon={PlaneTakeoff}
        title="Sắp bay"
        description="Theo dõi ngày bay trong Công nợ vé để nhắc khách check-in đúng hạn."
        actions={<Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => load({ silent: true })}>Làm mới</Button>}
      />

      {/* Thanh công cụ */}
      <div className="card mb-4 p-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
        <Segmented value={range} onChange={setRange} options={RANGES} />
        <SearchInput value={search} onChange={setSearch} placeholder="Tìm khách, SĐT, chặng, mã vé…" className="lg:w-72" />
        <div className="flex items-center justify-between gap-3 lg:ml-auto">
          <Switch size="sm" checked={onlyPending} onChange={setOnlyPending} label="Chỉ chưa check-in" />
          {!loading && !error && (
            <span className="text-xs text-ink-muted whitespace-nowrap">
              <b className="text-ink">{total}</b> chuyến · <b className={pendingTotal ? 'text-danger-600' : 'text-success-600'}>{pendingTotal}</b> chưa check-in
            </span>
          )}
        </div>
      </div>

      <ErrorBanner message={error} onRetry={() => load()} />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4 flex items-center gap-3">
              <div className="flex-1 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72" /></div>
              <Skeleton className="h-6 w-20" />
            </Card>
          ))}
        </div>
      ) : !error && groups.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={PlaneTakeoff}
            title={debts.length ? 'Không có chuyến bay nào khớp' : 'Chưa có vé nào có ngày bay'}
            description={debts.length ? `${rangeHint}. Thử đổi khoảng thời gian, bỏ lọc hoặc từ khoá.` : 'Nhập ngày bay khi thêm vé ở Công nợ vé để trang này tự nhắc.'}
            action={range !== 'all' && debts.length ? <Button variant="secondary" onClick={() => setRange('all')}>Xem tất cả sắp tới</Button> : null}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.date}>
              <div className="sticky top-11 md:top-0 z-10 -mx-1 px-1 py-2 bg-surface-muted/95 backdrop-blur flex flex-wrap items-center gap-2">
                <CalendarDays size={16} className="text-ink-muted" />
                <h3 className="font-semibold text-ink">{WEEKDAY[ymdToDate(g.date).getDay()]}, {formatDate(g.date)}</h3>
                <DayBadge diff={g.diff} />
                <span className="ml-auto text-xs text-ink-muted">
                  {g.items.length} chuyến · {g.pending ? <b className="text-danger-600">{g.pending} chưa check-in</b> : <span className="text-success-600 font-semibold inline-flex items-center gap-1"><CheckCircle2 size={12} /> đã check-in hết</span>}
                </span>
              </div>
              <div className="space-y-2">
                {g.items.map((d) => <FlightRow key={d.id} flight={d} airline={detectAirline(d.airline, airlines)} onToggle={(next) => toggleCheckin(d, next)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FlightRow({ flight: d, airline, onToggle }) {
  return (
    <Card padded={false} className={`p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 transition ${d.checked_in ? 'bg-success-50/40 border-success-100' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={`font-semibold truncate ${d.checked_in ? 'text-ink-muted line-through decoration-success-500/60' : 'text-ink'}`}>{d.customer_name || '—'}</p>
          {d.phone_number && (
            <a href={`tel:${d.phone_number}`} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-600">
              <Phone size={11} />{d.phone_number}
            </a>
          )}
          {d.checked_in && <Badge tone="success" icon={CheckCircle2}>Đã check-in</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
          <span className="font-medium">{d.route || 'Chưa có chặng'}</span>
          {(airline?.name || d.airline) && <Badge tone="outline">{airline?.name || d.airline}</Badge>}
          {d.ticket_code && <span className="inline-flex items-center gap-1 font-mono text-xs text-ink-muted"><Ticket size={12} />{d.ticket_code}</span>}
          <span className="text-xs text-ink-faint">bay {formatDate(d.flight_date)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
        {airline?.checkinUrl && (
          <a href={airline.checkinUrl} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 text-[13px]" title={`Mở web check-in ${airline.name}`}>
            <ExternalLink size={14} /> Web check-in
          </a>
        )}
        <Switch checked={!!d.checked_in} onChange={onToggle} label="Đã check-in" />
      </div>
    </Card>
  );
}
