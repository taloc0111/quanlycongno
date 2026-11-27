import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, RefreshCw, Receipt, TrendingUp, PiggyBank, Landmark, AlertTriangle,
  PlaneTakeoff, CalendarClock, BellRing, ListTodo, Users, ArrowRight, Phone, BarChart3, PieChart as PieIcon,
  Truck, HandCoins, Wallet, ReceiptText, Scale,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from './auth/AuthContext';
import { useNavigation } from './hooks/useNavigation.jsx';
import { api, qs } from './services/client';
import { formatCurrency, formatCompact, formatDate, formatMonth, today, daysUntil, num } from './utils/format';
import { Button, Card, Badge, EmptyState, Skeleton, PageHeader, StatCard, ErrorBanner } from './ui';
import AgencyFilter from './components/AgencyFilter';

// Màu biểu đồ = token Tailwind của app (đã kiểm tra tách màu cho người mù màu).
const COLORS = { brand: '#3b63f6', success: '#10b981', warning: '#f59e0b', danger: '#ef4444', purple: '#8b5cf6' };

// Thứ tự + nhãn + màu cố định cho từng loại dịch vụ (không xoay vòng màu theo thứ hạng).
const TYPES = [
  { key: 'debts', label: 'Vé máy bay', color: COLORS.brand },
  { key: 'passports', label: 'Hộ chiếu', color: COLORS.purple },
  { key: 'trainTickets', label: 'Vé tàu', color: COLORS.success },
  { key: 'tours', label: 'Tour', color: COLORS.warning },
];

// Nhãn loại khoản nợ trong danh sách việc cần làm (type từ API).
const DUE_TYPE = { debt: 'Vé máy bay', passport: 'Hộ chiếu', train: 'Vé tàu', tour: 'Tour' };
// type từ API → key module để mở đúng trang.
const TYPE_MODULE = { debt: 'debt', passport: 'passport', train: 'train', tour: 'tour' };

// Số cột lưới "Việc cần làm" theo số mục (6 mục = 3×2, 4 mục = 1 hàng). Class viết tĩnh để Tailwind quét được.
const TODO_COLS = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-3', 6: 'xl:grid-cols-3' };
const MONEY_COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4' };
// 6 thẻ chen 1 hàng làm số tiền bị ngắt giữa chừng → 3 cột tới màn rất rộng mới 6 cột.
const STAT_COLS = { 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-3 2xl:grid-cols-6' };

const greeting = (hour) => {
  if (hour < 11) return 'Chào buổi sáng';
  if (hour < 14) return 'Chào buổi trưa';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
};

/** 12 tháng gần nhất dạng 'YYYY-MM' (cũ → mới), để trục X luôn đủ 12 cột. */
const last12Months = () => {
  const [y, m] = today().split('-').map(Number);
  const out = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

export default function DashboardApp() {
  const { user, hasFeature } = useAuth();
  const { navigate } = useNavigation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [hour] = useState(() => new Date().getHours());

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setStats(await api.get(`/stats${qs({ agencyId })}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agencyId]);

  useEffect(() => { load(); }, [load]);

  // Phòng thủ: backend cũ có thể thiếu byType/todo.
  const byType = useMemo(() => stats?.byType || {}, [stats?.byType]);
  const todo = useMemo(() => stats?.todo || {}, [stats?.todo]);
  const flightsTomorrow = useMemo(() => (todo.flightsTomorrow || []).filter((f) => !f.checked_in), [todo.flightsTomorrow]);
  const dueSoon = todo.dueSoon || [];
  const overdueList = useMemo(() => [...(todo.overdue || [])].sort((a, b) => num(b.outstanding) - num(a.outstanding)), [todo.overdue]);
  const fareHits = hasFeature('fareWatch') ? (todo.fareHits || []) : [];
  // Dòng tiền v3 — backend cũ không có các trường này thì ẩn mục tương ứng.
  const hasCostPending = Array.isArray(todo.costPending);
  const hasSupplierDue = Array.isArray(todo.supplierDue);
  const costPending = hasCostPending ? todo.costPending : [];
  const supplierDue = hasSupplierDue ? todo.supplierDue : [];
  const todoCount = flightsTomorrow.length + dueSoon.length + overdueList.length + fareHits.length + costPending.length + supplierDue.length;
  const todoSections = 3 + (hasFeature('fareWatch') ? 1 : 0) + (hasCostPending ? 1 : 0) + (hasSupplierDue ? 1 : 0);
  const costPendingCount = num(stats?.costPendingCount);
  // v3.1: lãi ròng = lãi − chi phí khác + thu khác (backend cũ không có → ẩn).
  const hasNet = stats?.netProfit != null;
  const thisMonth = (stats?.monthly || []).find((m) => m.month === today().slice(0, 7));
  const hasOtherExpense = stats?.otherExpense != null || (stats?.monthly || []).some((m) => m.otherExpense != null);
  const otherExpenseMonth = num(thisMonth?.otherExpense);
  const moneyCards = stats ? [
    stats.supplierOwed != null && (num(stats.supplierOwed) < 0
      // Số âm = NCC (vd F1 sau khi huỷ vé) đang giữ tiền của mình, không phải mình nợ họ.
      ? { key: 'supplierOwed', icon: Truck, label: 'NCC đang giữ của mình', value: -num(stats.supplierOwed), sub: 'Tiền NCC còn phải trả lại / trừ vào lần sau', tone: 'success', to: 'suppliers' }
      : { key: 'supplierOwed', icon: Truck, label: 'Nợ nhà cung cấp', value: num(stats.supplierOwed), sub: 'Giá vốn còn phải trả F1/down', tone: num(stats.supplierOwed) > 0 ? 'danger' : 'gray', to: 'suppliers' }),
    stats.othersHolding != null && { key: 'othersHolding', icon: HandCoins, label: 'Tiền ở TK người khác', value: num(stats.othersHolding), sub: 'TK giữ hộ — cần thu về', tone: num(stats.othersHolding) > 0 ? 'warning' : 'gray', to: 'accounts' },
    stats.walletTotal != null && { key: 'walletTotal', icon: Wallet, label: 'Ví khách đang giữ', value: num(stats.walletTotal), sub: 'Tiền khách gửi trước, chưa dùng', tone: 'success', to: 'wallets' },
    hasOtherExpense && { key: 'otherExpenseMonth', icon: ReceiptText, label: 'Chi phí khác tháng này', value: otherExpenseMonth, sub: 'Phí NH, lương, văn phòng… (không gồm rút tiền riêng)', tone: otherExpenseMonth > 0 ? 'warning' : 'gray', to: 'expenses' },
  ].filter(Boolean) : [];

  const monthlyData = useMemo(() => {
    const byMonth = new Map((stats?.monthly || []).map((m) => [m.month, m]));
    return last12Months().map((month) => {
      const m = byMonth.get(month) || {};
      return { month, label: formatMonth(month), amount: num(m.amount), paid: num(m.paid), profit: num(m.profit), cost: num(m.cost), netProfit: num(m.netProfit ?? m.profit) };
    });
  }, [stats?.monthly]);
  const hasMonthlyNet = (stats?.monthly || []).some((m) => m.netProfit != null);
  const hasMonthly = monthlyData.some((m) => m.amount || m.paid || m.profit);

  const typeData = useMemo(() => TYPES.map((t) => ({
    ...t,
    amount: num(byType[t.key]?.amount),
    count: num(byType[t.key]?.count),
  })), [byType]);
  const typeTotal = typeData.reduce((s, t) => s + t.amount, 0);

  const totalCount = stats ? num(stats.counts?.debts) + num(stats.counts?.passports) + num(stats.counts?.trainTickets) + num(stats.counts?.tours) : 0;
  const paidPct = stats && num(stats.totalAmount) > 0 ? Math.round((num(stats.totalPaid) / num(stats.totalAmount)) * 100) : 0;
  const displayName = user?.fullName || user?.username || '';

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Tổng quan"
        help="start"
        description={`${greeting(hour)}${displayName ? `, ${displayName}` : ''}! Hôm nay ${formatDate(today())}.`}
        actions={(
          <>
            <AgencyFilter value={agencyId} onChange={setAgencyId} />
            <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => load({ silent: true })}>Làm mới</Button>
          </>
        )}
      />

      <ErrorBanner message={error} onRetry={() => load()} />

      {loading ? (
        <DashboardSkeleton />
      ) : stats && (
        <>
          {/* Thẻ số liệu */}
          <div className={`grid grid-cols-2 md:grid-cols-3 ${STAT_COLS[hasNet ? 6 : 5]} gap-3 mb-5`}>
            <StatCard icon={Receipt} label="Tổng phải thu" value={formatCurrency(stats.totalAmount)} sub={`${totalCount} dịch vụ · ${num(stats.counts?.customers)} khách`} tone="brand" />
            <StatCard
              icon={TrendingUp} label="Lợi nhuận" value={formatCurrency(stats.totalProfit)}
              sub={costPendingCount > 0
                ? `Không tính ${costPendingCount} dòng chưa đủ giá vốn`
                : num(stats.totalAmount) ? `${Math.round((num(stats.totalProfit) / num(stats.totalAmount)) * 100)}% doanh số` : ''}
              tone={num(stats.totalProfit) >= 0 ? 'success' : 'danger'}
            />
            {hasNet && (
              <StatCard
                icon={Scale} label="Lãi ròng" value={formatCurrency(stats.netProfit)}
                sub="Lãi − chi phí khác + thu khác"
                tone={num(stats.netProfit) >= 0 ? 'success' : 'danger'}
                onClick={() => navigate('expenses')}
              />
            )}
            <StatCard icon={PiggyBank} label="Đã thu" value={formatCurrency(stats.totalPaid)} sub={`${paidPct}% tổng phải thu`} tone="purple" />
            <StatCard icon={Landmark} label="Còn nợ" value={formatCurrency(stats.outstanding)} sub={`${(stats.topDebtors || []).length} khách nợ nhiều nhất`} tone="warning" />
            <StatCard icon={AlertTriangle} label="Nợ quá hạn" value={formatCurrency(stats.overdue)} sub={`${overdueList.length} khoản quá hạn`} tone="danger" />
          </div>

          {/* Dòng tiền: nợ NCC, TK giữ hộ, ví khách */}
          {moneyCards.length > 0 && (
            <div className={`grid grid-cols-1 ${MONEY_COLS[moneyCards.length]} gap-3 mb-5`}>
              {moneyCards.map((c) => (
                <StatCard key={c.key} icon={c.icon} label={c.label} value={formatCurrency(c.value)} sub={c.sub} tone={c.tone} onClick={() => navigate(c.to)} />
              ))}
            </div>
          )}

          {/* Việc cần làm hôm nay */}
          <Card padded={false} className="mb-5 overflow-hidden">
            <CardHeading icon={ListTodo} title="Việc cần làm hôm nay" sub={todoCount ? `${todoCount} việc` : 'Mọi thứ đang ổn'} />
            {todoCount === 0 ? (
              <EmptyState icon={ListTodo} title="Không có việc gì gấp 🎉" description="Không có khách bay ngày mai chưa check-in, không có khoản nào sắp đến hạn hay quá hạn, giá vốn đã nhập đủ." compact />
            ) : (
              /* Viền giữa các ô: mỗi ô kẻ trên + trái, lưới lùi 1px để giấu viền ngoài cùng (Card overflow-hidden). */
              <div className={`grid grid-cols-1 md:grid-cols-2 ${TODO_COLS[todoSections] || 'xl:grid-cols-3'} -mt-px -ml-px [&>section]:border-t [&>section]:border-l [&>section]:border-surface-border`}>
                <TodoSection
                  icon={PlaneTakeoff} tone="brand" title="Bay ngày mai, chưa check-in" count={flightsTomorrow.length}
                  action={<Button size="xs" variant="soft" iconRight={ArrowRight} onClick={() => navigate('upcoming')}>Sắp bay</Button>}
                  emptyText="Không có khách nào"
                >
                  {flightsTomorrow.map((f) => (
                    <TodoRow key={`f${f.id}`} name={f.customer_name} phone={f.phone_number}
                      meta={[f.route, f.airline, f.ticket_code].filter(Boolean).join(' · ')}
                      right={<Badge tone="brand">{formatDate(f.flight_date)}</Badge>} />
                  ))}
                </TodoSection>
                <TodoSection icon={CalendarClock} tone="warning" title="Đến hạn trong 7 ngày" count={dueSoon.length} emptyText="Không có khoản nào">
                  {dueSoon.map((d) => (
                    <TodoRow key={`d${d.type}${d.id}`} name={d.customer_name} phone={d.phone_number}
                      meta={`${DUE_TYPE[d.type] || d.type} · ${dueLabel(d.due_date)}`}
                      right={<span className="font-semibold tabular text-warning-600">{formatCurrency(d.outstanding)}</span>} />
                  ))}
                </TodoSection>
                <TodoSection icon={AlertTriangle} tone="danger" title="Quá hạn" count={overdueList.length} emptyText="Không có khoản nào">
                  {overdueList.map((d) => (
                    <TodoRow key={`o${d.type}${d.id}`} name={d.customer_name} phone={d.phone_number}
                      meta={`${DUE_TYPE[d.type] || d.type} · ${dueLabel(d.due_date)}`}
                      right={<span className="font-semibold tabular text-danger-600">{formatCurrency(d.outstanding)}</span>} />
                  ))}
                </TodoSection>
                {hasFeature('fareWatch') && (
                  <TodoSection
                    icon={BellRing} tone="success" title="Canh vé đã đạt giá" count={fareHits.length}
                    action={<Button size="xs" variant="soft" iconRight={ArrowRight} onClick={() => navigate('ticketWatch')}>Canh vé</Button>}
                    emptyText="Chưa có vé nào đạt giá"
                  >
                    {fareHits.map((h) => (
                      <TodoRow key={`h${h.id}`} name={h.customer_name}
                        meta={[h.route, h.depart_date ? `bay ${formatDate(h.depart_date)}` : ''].filter(Boolean).join(' · ')}
                        right={(
                          <span className="text-right leading-tight">
                            <span className="block font-semibold tabular text-success-600">{formatCurrency(h.last_price)}</span>
                            <span className="block text-[11px] text-ink-faint tabular">mong {formatCurrency(h.target_price)}</span>
                          </span>
                        )} />
                    ))}
                  </TodoSection>
                )}
                {hasCostPending && (
                  <TodoSection icon={ReceiptText} tone="warning" title="Chưa đủ giá vốn" count={costPending.length} emptyText="Giá vốn đã nhập đủ">
                    {costPending.map((c) => (
                      <TodoRow key={`c${c.type}${c.id}`} name={c.customer_name}
                        meta={[DUE_TYPE[c.type] || c.type, c.issue_date ? formatDate(c.issue_date) : ''].filter(Boolean).join(' · ')}
                        onClick={TYPE_MODULE[c.type] ? () => navigate(TYPE_MODULE[c.type]) : undefined}
                        right={<span className="font-semibold tabular text-ink">{formatCurrency(c.amount)}</span>} />
                    ))}
                  </TodoSection>
                )}
                {hasSupplierDue && (
                  <TodoSection
                    icon={Truck} tone="danger" title="Sắp đến hạn trả NCC" count={supplierDue.length}
                    action={<Button size="xs" variant="soft" iconRight={ArrowRight} onClick={() => navigate('suppliers')}>NCC</Button>}
                    emptyText="Không có khoản nào"
                  >
                    {supplierDue.map((d, i) => (
                      <TodoRow key={`s${d.supplier_id}-${i}`} name={d.supplier_name}
                        meta={[d.label, d.target_label, dueLabel(d.due_date)].filter(Boolean).join(' · ')}
                        onClick={d.supplier_id ? () => navigate('suppliers', d.supplier_id) : undefined}
                        right={<span className={`font-semibold tabular ${(daysUntil(d.due_date) ?? 1) < 0 ? 'text-danger-600' : 'text-warning-600'}`}>{formatCurrency(d.amount_due)}</span>} />
                    ))}
                  </TodoSection>
                )}
              </div>
            )}
          </Card>

          {/* Biểu đồ */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-5">
            <Card padded={false} className="xl:col-span-2 overflow-hidden">
              <CardHeading icon={BarChart3} title="Doanh số & lợi nhuận 12 tháng" sub={`Cột = doanh số và đã thu · đường = lợi nhuận${hasMonthlyNet ? ' và lãi ròng' : ''}`} />
              <div className="px-2 pb-4 pt-2">
                {hasMonthly ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={monthlyData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={{ fontSize: 12, fill: '#64748b' }} interval={0} angle={monthlyData.length > 8 ? -30 : 0} textAnchor={monthlyData.length > 8 ? 'end' : 'middle'} height={monthlyData.length > 8 ? 44 : 30} />
                      <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} width={64} />
                      <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                      <Bar dataKey="amount" name="Doanh số" fill={COLORS.brand} radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="paid" name="Đã thu" fill={COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Line type="monotone" dataKey="profit" name="Lợi nhuận" stroke={COLORS.warning} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
                      {hasMonthlyNet && (
                        <Line type="monotone" dataKey="netProfit" name="Lãi ròng" stroke={COLORS.purple} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={BarChart3} title="Chưa có doanh số trong 12 tháng gần đây" description="Thêm vé, hộ chiếu, vé tàu hoặc tour để thấy biểu đồ." compact />
                )}
              </div>
            </Card>

            <Card padded={false} className="overflow-hidden">
              <CardHeading icon={PieIcon} title="Cơ cấu doanh số" sub="Theo loại dịch vụ" />
              {typeTotal > 0 ? (
                <div className="px-4 pb-4">
                  <div className="relative">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={typeData} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                          {typeData.map((t) => <Cell key={t.key} fill={t.color} />)}
                        </Pie>
                        <Tooltip content={<MoneyTooltip total={typeTotal} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[11px] uppercase tracking-wide text-ink-faint">Tổng</span>
                      <span className="text-lg font-bold tabular text-ink">{formatCompact(typeTotal)}</span>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {typeData.map((t) => (
                      <li key={t.key} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                        <span className="text-ink-soft">{t.label}</span>
                        <span className="text-ink-faint text-xs">{t.count}</span>
                        <span className="ml-auto font-semibold tabular text-ink">{formatCurrency(t.amount)}</span>
                        <span className="w-10 text-right text-xs tabular text-ink-muted">{typeTotal ? Math.round((t.amount / typeTotal) * 100) : 0}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyState icon={PieIcon} title="Chưa có doanh số" compact />
              )}
            </Card>
          </div>

          {/* Top khách còn nợ */}
          <Card padded={false} className="overflow-hidden">
            <CardHeading icon={Users} title="Top khách còn nợ" sub="Gộp cả 4 loại dịch vụ" />
            {(stats.topDebtors || []).length === 0 ? (
              <EmptyState icon={Users} title="Không ai còn nợ 🎉" compact />
            ) : (
              <ol className="divide-y divide-surface-border">
                {stats.topDebtors.map((d, i) => {
                  const max = num(stats.topDebtors[0]?.outstanding) || 1;
                  const pct = Math.max(2, Math.round((num(d.outstanding) / max) * 100));
                  return (
                    <li key={`${d.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted">
                      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-danger-50 text-danger-700' : 'bg-surface-subtle text-ink-muted'}`}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-ink truncate">{d.name || '—'}</span>
                          <span className="font-semibold tabular text-danger-600 shrink-0">{formatCurrency(d.outstanding)}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-surface-subtle overflow-hidden">
                          <div className="h-full rounded-full bg-danger-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Nhãn hạn: "hôm nay", "ngày mai", "còn N ngày", "quá N ngày" + ngày. */
function dueLabel(ymd) {
  const d = daysUntil(ymd);
  const date = formatDate(ymd);
  if (d === null) return date;
  if (d === 0) return `hạn hôm nay`;
  if (d === 1) return `hạn ngày mai`;
  if (d > 1) return `còn ${d} ngày (${date})`;
  return `quá ${-d} ngày (${date})`;
}

function CardHeading({ icon: Icon, title, sub, action }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-border">
      <div className="min-w-0">
        <h3 className="font-semibold text-ink flex items-center gap-2">{Icon && <Icon size={16} className="text-ink-muted" />}{title}</h3>
        {sub && <p className="text-xs text-ink-muted mt-0.5 truncate">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const SECTION_TONE = {
  brand: 'text-brand-600', warning: 'text-warning-600', danger: 'text-danger-600', success: 'text-success-600',
};

function TodoSection({ icon: Icon, tone, title, count, action, emptyText, children }) {
  return (
    <section className="min-w-0 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft min-w-0">
          {Icon && <Icon size={15} className={`shrink-0 ${SECTION_TONE[tone] || ''}`} />}
          <span className="truncate">{title}</span>
          <Badge tone={count ? tone : 'gray'}>{count}</Badge>
        </h4>
        {action}
      </div>
      {count === 0 ? (
        <p className="text-xs text-ink-faint py-2">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-surface-border max-h-64 overflow-y-auto -mx-1">{children}</ul>
      )}
    </section>
  );
}

function TodoRow({ name, phone, meta, right, onClick }) {
  const clickable = onClick ? {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => { if (e.key === 'Enter') onClick(); },
  } : {};
  return (
    <li className={`flex items-center justify-between gap-2 px-1 py-2 text-sm ${onClick ? 'cursor-pointer rounded-md hover:bg-surface-muted' : ''}`} {...clickable}>
      <div className="min-w-0">
        <p className="font-medium text-ink truncate">{name || '—'}</p>
        <p className="text-xs text-ink-muted truncate">
          {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-0.5 hover:text-brand-600"><Phone size={10} />{phone}</a>}
          {phone && meta ? ' · ' : ''}{meta}
        </p>
      </div>
      <div className="shrink-0 text-sm">{right}</div>
    </li>
  );
}

/** Tooltip chung cho biểu đồ tiền. */
function MoneyTooltip({ active, payload, label, total }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs shadow-pop min-w-[160px]">
      {label && <p className="font-semibold text-ink mb-1">{label}</p>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.color || p.fill }} />
            {p.name}
          </span>
          <span className="font-semibold tabular text-ink">
            {formatCurrency(p.value)}
            {total ? <span className="text-ink-faint font-normal"> · {Math.round((num(p.value) / total) * 100)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-6 w-32 mb-2" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <Card className="mb-5">
        <Skeleton className="h-4 w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2"><Skeleton className="h-4 w-56 mb-4" /><Skeleton className="h-[280px] w-full" /></Card>
        <Card><Skeleton className="h-4 w-40 mb-4" /><Skeleton className="h-[200px] w-full rounded-full mx-auto max-w-[200px]" /></Card>
      </div>
    </div>
  );
}

