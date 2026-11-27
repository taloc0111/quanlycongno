import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, PlaneTakeoff, PlaneLanding, Crown, ChevronDown, ChevronUp, Lock, Users, Clock, ArrowLeftRight, Sparkles } from 'lucide-react';
import { api } from './services/client';
import { formatCurrency, formatDate } from './utils/format';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/FeedbackContext';
import { Button, Field, Input, DateField, Switch, Card, Badge, PageHeader, ErrorBanner, EmptyState, Skeleton } from './ui';

// Các hãng nội địa thường gặp — hiện ở màn hình chờ cho biết phạm vi so giá.
const AIRLINES = ['VietJet', 'Vietnam Airlines', 'Bamboo Airways', 'Sun PhuQuoc Airways', 'Vietravel'];

// 'yyyy-mm-dd HH:MM' → 'HH:MM'
const hhmm = (t) => (t && t.length >= 16 ? t.slice(11, 16) : '');
// Hậu tố ' (+1)' khi giờ đến rơi sang ngày hôm sau (chuyến đêm).
const plusDays = (dep, arr) => {
  if (!dep || !arr) return '';
  const d1 = dep.slice(0, 10);
  const d2 = arr.slice(0, 10);
  if (d1 === d2) return '';
  const diff = Math.round((new Date(d2) - new Date(d1)) / 86400000);
  return diff > 0 ? ` (+${diff})` : '';
};
const fmtDur = (m) => (m ? `${Math.floor(m / 60)}g${String(m % 60).padStart(2, '0')}` : '');
const TH = 'px-3 py-2 font-semibold whitespace-nowrap';

export default function FareCheckApp() {
  const { refreshProfile } = useAuth();
  const { toast } = useFeedback();
  const [routes, setRoutes] = useState([]);
  const [route, setRoute] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [date, setDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [pax, setPax] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false); // 403 featureDisabled
  const [result, setResult] = useState(null); // { route, date, returnDate, pax, legs: [...] }
  const [expanded, setExpanded] = useState(() => new Set()); // các dòng hãng đang xổ khung giờ

  useEffect(() => {
    api.get('/routes').then(setRoutes).catch(() => {});
  }, []);

  const toggleExpand = (k) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const search = useCallback(async () => {
    if (!/^[A-Za-z]{3}\s*[-→\s]\s*[A-Za-z]{3}$/.test(route)) { toast.error('Nhập hành trình hợp lệ, vd: SGN-HAN'); return; }
    if (!date) { toast.error('Chọn ngày đi'); return; }
    if (roundTrip) {
      if (!returnDate) { toast.error('Chọn ngày về (hoặc chuyển sang Một chiều)'); return; }
      if (returnDate < date) { toast.error('Ngày về phải từ ngày đi trở đi'); return; }
    }
    setLoading(true);
    setError('');
    setResult(null);
    setExpanded(new Set());
    try {
      const body = { route: route.toUpperCase(), date, pax };
      if (roundTrip) body.returnDate = returnDate;
      setResult(await api.post('/fares/quote', body));
    } catch (err) {
      if (err?.status === 403 && err?.data?.featureDisabled) { setDisabled(true); refreshProfile(); }
      else if (err?.status === 503 || err?.status === 429) toast.warning(err.message || 'Dịch vụ tra giá đang bận, thử lại sau giây lát.');
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [route, date, returnDate, roundTrip, pax, toast, refreshProfile]);

  // Mỗi chiều: sắp theo giá tăng dần, hãng lỗi xếp cuối. Rẻ nhất = dòng ok đầu tiên.
  const legs = useMemo(() => (result?.legs || []).map((leg) => {
    const sorted = [...(leg.results || [])].sort((a, b) => (a.ok === b.ok ? (a.ok ? a.price - b.price : 0) : a.ok ? -1 : 1));
    return { ...leg, sorted, cheapest: sorted.find((r) => r.ok) || null };
  }), [result]);

  // Tổng rẻ nhất khứ hồi = cộng giá rẻ nhất của 2 chiều.
  const roundTripTotal = legs.length === 2 && legs.every((l) => l.cheapest) ? legs.reduce((s, l) => s + l.cheapest.price, 0) : null;

  if (disabled) {
    return (
      <div>
        <PageHeader icon={Search} title="Check vé" description="Tra giá hiện tại của các hãng cho một chặng." />
        <Card>
          <EmptyState icon={Lock} title="Tính năng Canh vé chưa được bật cho tài khoản này" description="Liên hệ quản trị viên để bật tính năng." />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader icon={Search} title="Check vé" description="Tra giá hiện tại của các hãng cho một chặng — kèm khung giờ từng chuyến, không lưu khách." />

      {/* Form tra giá */}
      <Card className="mb-5">
        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.7fr_auto] gap-3 items-end">
          <div className="col-span-2 lg:col-span-5 flex items-center justify-between gap-3">
            <Switch checked={roundTrip} onChange={setRoundTrip} label={roundTrip ? 'Khứ hồi (đi + về)' : 'Một chiều'} />
            {roundTrip && <span className="text-xs text-ink-faint">Khứ hồi tốn 2 lượt tra giá</span>}
          </div>
          <Field label="Hành trình" required htmlFor="fc-route" className="col-span-2 lg:col-span-1">
            <Input id="fc-route" list="fc-routes" autoComplete="off" value={route} onChange={(e) => setRoute(e.target.value.toUpperCase())} placeholder="VD: SGN-HAN" className="uppercase font-semibold tracking-wide" />
            <datalist id="fc-routes">{routes.map((r) => <option key={r} value={r} />)}</datalist>
          </Field>
          <Field label="Ngày đi" required>
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label="Ngày về" required={roundTrip} className={roundTrip ? '' : 'hidden lg:block'}>
            <DateField value={returnDate} onChange={setReturnDate} disabled={!roundTrip} placeholder={roundTrip ? 'dd/mm/yyyy' : '—'} />
          </Field>
          <Field label="Số khách" htmlFor="fc-pax" className={roundTrip ? 'col-span-2 sm:col-span-1 lg:col-span-1' : ''}>
            <Input id="fc-pax" type="number" min="1" max="9" value={pax} onChange={(e) => setPax(e.target.value)} />
          </Field>
          <div className="col-span-2 lg:col-span-1">
            <Button type="submit" block icon={Search} loading={loading}>{loading ? 'Đang tra giá…' : 'Tra giá'}</Button>
          </div>
        </form>
      </Card>

      <ErrorBanner message={error} onRetry={search} />

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-56" />
          <Card padded={false}><div className="p-4 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div></Card>
          <p className="text-center text-xs text-ink-faint">Đang hỏi giá từng hãng — mất khoảng 10–30 giây.</p>
        </div>
      )}

      {/* Tổng khứ hồi */}
      {roundTripTotal != null && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success-100 bg-success-50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-success-100 text-success-700"><ArrowLeftRight size={18} /></span>
            <div>
              <p className="text-sm font-semibold text-success-700">Tổng rẻ nhất khứ hồi</p>
              <p className="text-xs text-success-600/80">Đi + về, có thể khác hãng · {result.pax} khách</p>
            </div>
          </div>
          <span className="text-xl font-bold tabular text-success-700">{formatCurrency(roundTripTotal)}</span>
        </div>
      )}

      {/* Kết quả so giá — mỗi chiều 1 bảng, bấm vào hãng để xổ khung giờ */}
      {legs.map((leg, li) => {
        const Icon = leg.direction === 'outbound' ? PlaneTakeoff : PlaneLanding;
        const title = legs.length === 2 ? (leg.direction === 'outbound' ? 'Chiều đi' : 'Chiều về') : 'Kết quả';
        return (
          <div key={leg.direction} className="mb-5">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Icon size={16} className="text-brand-500" /> {title}</span>
              <Badge tone="brand">{leg.route}</Badge>
              <span className="text-ink-muted">{formatDate(leg.date)}</span>
              <span className="inline-flex items-center gap-1 text-ink-muted"><Users size={13} /> {result.pax} khách</span>
            </div>
            <Card padded={false} className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                      <th className={`${TH} text-left`}>Hãng</th>
                      <th className={`${TH} text-left hidden sm:table-cell`}>Chuyến</th>
                      <th className={`${TH} text-right`}>Giá / khách</th>
                      <th className={`${TH} w-10`} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {leg.sorted.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-faint">Không có dữ liệu hãng nào.</td></tr>
                    )}
                    {leg.sorted.map((r) => {
                      const k = `${li}:${r.key}`;
                      const isCheapest = leg.cheapest && r.ok && r.key === leg.cheapest.key;
                      const canExpand = r.ok && r.flights?.length > 0;
                      const isOpen = expanded.has(k);
                      return [
                        <tr
                          key={k}
                          onClick={canExpand ? () => toggleExpand(k) : undefined}
                          className={`transition ${isCheapest ? 'bg-success-50/70' : ''} ${canExpand ? 'cursor-pointer hover:bg-surface-muted' : ''}`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <PlaneTakeoff size={15} className={isCheapest ? 'text-success-600' : 'text-ink-faint'} />
                              <span className="font-semibold text-ink truncate">{r.airline}</span>
                              {isCheapest && <Badge tone="success" icon={Crown}>Rẻ nhất</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-ink-muted hidden sm:table-cell">
                            {canExpand ? `${r.flights.length} chuyến` : r.ok ? '—' : ''}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {r.ok ? (
                              <span className={`font-bold tabular ${isCheapest ? 'text-success-700 text-base' : 'text-ink'}`}>{formatCurrency(r.price)}</span>
                            ) : (
                              <Badge tone="warning"><span title={r.error || ''}>không lấy được</span></Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-ink-faint">
                            {canExpand && (isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
                          </td>
                        </tr>,
                        canExpand && isOpen && (
                          <tr key={`${k}:flights`} className="bg-surface-muted/60">
                            <td colSpan={4} className="px-3 py-2">
                              <ul className="divide-y divide-surface-border">
                                {r.flights.map((f, fi) => {
                                  const best = f.price === r.price;
                                  return (
                                    <li key={`${f.flightNo || 'f'}-${fi}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                                      <div className="flex items-center gap-3 min-w-0">
                                        <span className="w-16 shrink-0 font-mono text-xs text-ink-muted">{f.flightNo || '—'}</span>
                                        <span className="font-semibold tabular text-ink">
                                          {hhmm(f.departTime)} → {hhmm(f.arriveTime)}{plusDays(f.departTime, f.arriveTime)}
                                        </span>
                                        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-ink-muted">
                                          <Clock size={11} /> {fmtDur(f.durationMin)}{f.stops > 0 ? ` · ${f.stops} điểm dừng` : ' · bay thẳng'}
                                        </span>
                                      </div>
                                      <span className={`shrink-0 tabular ${best ? 'font-semibold text-success-700' : 'text-ink-soft'}`}>{formatCurrency(f.price)}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            {leg.sorted.length > 0 && leg.sorted.every((r) => !r.ok) && (
              <p className="mt-2 text-sm text-warning-600">
                Chưa lấy được giá chiều này — thử lại sau giây lát (hoặc kiểm tra hạn mức SerpApi trong tháng).
              </p>
            )}
          </div>
        );
      })}

      {!result && !loading && !error && (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Nhập hành trình + ngày rồi bấm “Tra giá”"
            description="So giá và xem khung giờ các hãng nội địa, tính cho 1 khách."
            action={(
              <div className="flex flex-wrap justify-center gap-1.5">
                {AIRLINES.map((a) => <Badge key={a} tone="outline">{a}</Badge>)}
              </div>
            )}
          />
        </Card>
      )}
    </div>
  );
}
