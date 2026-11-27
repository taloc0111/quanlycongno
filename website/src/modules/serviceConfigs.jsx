// Cấu hình 4 module nghiệp vụ dùng chung ServicePage. Thêm loại dịch vụ mới = thêm 1 config.
import { Plane, Train, BookOpen, Palmtree, Building2, Route, CheckCircle2, Circle } from 'lucide-react';
import { api } from '../services/client';
import { formatCurrency, formatDate, num } from '../utils/format';
import { Badge, Button } from '../ui';
import { DateCell, PayBadge } from './ServicePage';
import { RouteManagerModal, CompanyManagerModal } from './DebtExtras';

const DEFAULT_ROUTES = ['HAN-SGN', 'SGN-HAN', 'HAN-DAD', 'DAD-HAN', 'SGN-DAD', 'DAD-SGN', 'HAN-PQC', 'SGN-PQC', 'HAN-CXR', 'SGN-CXR', 'HAN-DLI', 'SGN-DLI', 'HAN-HPH', 'SGN-HPH'];
const AIRLINES = ['Vietnam Airlines', 'Vietjet Air', 'Bamboo Airways', 'Vietravel Airlines', 'Pacific Airlines', 'Sun PhuQuoc Airways'];
const PAY_TARGET = [{ value: 'self', label: 'TK cá nhân' }, { value: 'agency', label: 'TK cấp trên (nộp quỹ)' }];

// ---- Các cột dùng chung ----
const nameCol = (sub) => ({
  key: 'customer_name', label: 'Khách hàng', required: true, sortable: true, sticky: true,
  sortValue: (r) => (r.customer_name || '').toLowerCase(),
  render: (r, ctx) => (
    <div className="min-w-[160px]">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (r.customer_id) ctx.navigate('customer', r.customer_id); }}
        className={`font-semibold text-left ${ctx.payState(r, ctx.cfg).overdue ? 'text-danger-700' : 'text-ink'} ${r.customer_id ? 'hover:text-brand-600' : ''}`}
      >
        {r.customer_name}
      </button>
      <div className="text-xs text-ink-muted truncate">{sub ? sub(r, ctx) : r.phone_number}</div>
    </div>
  ),
});
const statusCol = { key: '__status', label: 'Trạng thái', defaultVisible: true, render: (r, ctx) => <PayBadge row={r} cfg={ctx.cfg} /> };
const moneyCols = (amountKey, { amountLabel = 'Giá bán' } = {}) => [
  { key: amountKey, label: amountLabel, align: 'right', sortable: true, sortValue: (r) => num(r[amountKey]), render: (r) => <span className="font-semibold">{formatCurrency(r[amountKey])}</span> },
  { key: 'cost_amount', label: 'Giá gốc', align: 'right', sortable: true, defaultVisible: false, sortValue: (r) => num(r.cost_amount), render: (r) => <span className="text-ink-muted">{formatCurrency(r.cost_amount)}</span> },
  { key: 'profit', label: 'Lợi nhuận', align: 'right', sortable: true, sortValue: (r) => num(r[amountKey]) - num(r.cost_amount), render: (r) => { const p = num(r[amountKey]) - num(r.cost_amount); return <span className={`font-semibold ${p >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(p)}</span>; } },
];
const paidCols = (amountKey, paidKey) => [
  { key: paidKey, label: 'Đã trả', align: 'right', sortable: true, sortValue: (r) => num(r[paidKey]), render: (r) => (
    <span className="text-success-600 font-medium">
      {formatCurrency(r[paidKey])}
      {num(r.agency_paid) > 0 && <span className="block text-[10.5px] text-warning-600 font-normal" title="Đã chuyển vào TK cấp trên">↑ cấp trên {formatCurrency(r.agency_paid)}</span>}
    </span>
  ) },
  { key: 'remaining', label: 'Còn nợ', align: 'right', sortable: true, sortValue: (r) => num(r[amountKey]) - num(r[paidKey]), render: (r) => { const rem = num(r[amountKey]) - num(r[paidKey]); return <span className={`font-bold ${rem <= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(rem)}</span>; } },
];
const dueCol = { key: 'due_date', label: 'Hạn trả', sortable: true, defaultVisible: false, render: (r) => r.due_date ? formatDate(r.due_date) : <span className="text-ink-faint">—</span> };
const companyCol = { key: 'company', label: 'Công ty', defaultVisible: false, render: (r, ctx) => { const c = ctx.companyById(r.company_id); return c ? <Badge tone="purple">{c.name}</Badge> : <span className="text-ink-faint">Khách lẻ</span>; } };
const ownerCol = { key: 'owner', label: 'Đại lý', defaultVisible: false, render: (r) => <span className="text-ink-muted">{r.owner_name || r.owner_username || ''}</span> };
const notesCol = { key: 'notes', label: 'Ghi chú', defaultVisible: false, render: (r) => <span className="text-ink-muted line-clamp-1 max-w-[220px]" title={r.notes || ''}>{r.notes || ''}</span> };

const customerField = { key: 'customerName', label: 'Tên khách hàng', type: 'customer', required: true, placeholder: 'Chọn khách cũ hoặc nhập tên mới' };
const phoneField = { key: 'phoneNumber', label: 'Số điện thoại', placeholder: '09xx…' };
const companyField = { key: 'companyId', label: 'Công ty', type: 'company' };
const costField = { key: 'costAmount', label: 'Giá gốc / giá vốn', type: 'money', placeholder: 'Giá nhập' };
const paidField = { key: 'paid', label: 'Trả trước', type: 'money', placeholder: 'Khách trả trước (nếu có)', showWhen: (f) => !f.id };
const payTargetField = { key: 'paymentTarget', label: 'Trả trước vào TK', type: 'select', options: PAY_TARGET, showWhen: (f) => !f.id && num(f.paid) > 0 };
const dueField = { key: 'dueDate', label: 'Hạn thanh toán', type: 'date' };
const notesField = { key: 'notes', label: 'Ghi chú', type: 'textarea', span: 3 };
const paidEditHint = { key: '__paidHint', label: 'Đã trả', type: 'money', disabled: () => true, showWhen: (f) => !!f.id, hint: 'Dùng nút Thanh toán để ghi nhận thêm các lần trả.' };

const exportCommon = (ctx) => ({
  company: { label: 'Công ty', value: (r) => ctx.companyById(r.company_id)?.name || 'Khách lẻ', width: 18 },
  payTarget: {
    label: 'Thanh toán vào', value: (r) => { const paid = num(r.paid ?? r.paid_amount); const ag = num(r.agency_paid); if (paid <= 0) return ''; if (ag <= 0) return 'Cá nhân'; if (ag >= paid) return 'Nộp quỹ (cấp trên)'; return 'Hỗn hợp'; },
  },
});

const baseValidate = (amountField, amountLabel) => (f) => {
  if (!f.customerName?.trim()) return 'Vui lòng nhập tên khách hàng';
  if (!num(f[amountField])) return `Vui lòng nhập ${amountLabel}`;
  if (num(f.costAmount) < 0 || num(f.paid) < 0) return 'Số tiền không được âm';
  return null;
};

// =====================================================================
// VÉ MÁY BAY
// =====================================================================
export const debtsConfig = {
  key: 'debts', storageKey: 'debts', endpoint: '/debts', changeEvent: 'data:debts-changed',
  title: 'Công nợ vé máy bay', description: 'Vé đã xuất, giá bán/giá gốc, thanh toán và công nợ của khách.',
  icon: Plane, itemLabel: 'vé', addLabel: 'Thêm vé', exportName: 'cong-no-ve-may-bay',
  paymentType: 'debt', paymentLabel: (r) => `${r.customer_name} · ${r.ticket_code || r.route || 'vé máy bay'}`,
  amountKey: 'ticket_amount', costKey: 'cost_amount', paidKey: 'paid', dateKey: 'issue_date', dueKey: 'due_date', sourceKey: 'ticket_source',
  searchPlaceholder: 'Tìm khách, SĐT, mã vé, hành trình, công ty…',
  searchText: (r, ctx) => [r.customer_name, r.phone_number, r.ticket_code, r.route, r.airline, ctx.companyById(r.company_id)?.name].filter(Boolean).join(' '),
  mobileSubtitle: (r) => [r.ticket_code, r.route, r.flight_date ? `bay ${formatDate(r.flight_date)}` : ''].filter(Boolean).join(' · '),
  loadLists: async () => ({ routes: await api.get('/routes').catch(() => []) }),
  emptyForm: { customerName: '', phoneNumber: '', ticketCode: '', airline: '', route: '', flightDate: '', issueDate: '', dueDate: '', ticketSource: '', ticketAmount: '', costAmount: '', paid: '', notes: '', companyId: '', paymentTarget: 'self' },
  toForm: (d) => ({
    customerName: d.customer_name || '', phoneNumber: d.phone_number || '', ticketCode: d.ticket_code || '', airline: d.airline || '',
    route: d.route || '', flightDate: d.flight_date || '', issueDate: d.issue_date || '', dueDate: d.due_date || '', ticketSource: d.ticket_source || '',
    ticketAmount: d.ticket_amount, costAmount: d.cost_amount, __paidHint: d.paid, notes: d.notes || '', companyId: d.company_id || '', paymentTarget: 'self',
  }),
  toPayload: (f, { editing }) => ({
    customerName: f.customerName.trim(), phoneNumber: f.phoneNumber, ticketCode: f.ticketCode, airline: f.airline, route: f.route,
    flightDate: f.flightDate || null, issueDate: f.issueDate || null, dueDate: f.dueDate || null, ticketSource: f.ticketSource,
    ticketAmount: num(f.ticketAmount), costAmount: num(f.costAmount), notes: f.notes, companyId: f.companyId || null,
    ...(editing ? {} : { paid: num(f.paid), paymentTarget: f.paymentTarget }),
  }),
  validate: baseValidate('ticketAmount', 'tiền vé'),
  form: {
    amountField: 'ticketAmount', dateField: 'issueDate',
    fields: [
      customerField, phoneField,
      { key: 'ticketCode', label: 'Mã vé', placeholder: 'Mã đặt chỗ / số vé' },
      { key: 'airline', label: 'Hãng bay', type: 'datalist', options: AIRLINES, placeholder: 'VD: Vietnam Airlines' },
      { key: 'route', label: 'Hành trình', type: 'datalist', upper: true, options: (ctx) => [...new Set([...(ctx.lists.routes || []), ...DEFAULT_ROUTES])], placeholder: 'VD: HAN-SGN' },
      { key: 'flightDate', label: 'Ngày bay', type: 'date' },
      { key: 'issueDate', label: 'Ngày xuất vé', type: 'date' },
      dueField,
      { key: 'ticketSource', label: 'Nguồn xuất vé', type: 'datalist', options: (ctx) => ctx.sources, placeholder: 'VD: Ngọc Mai, website…' },
      companyField,
      { key: 'ticketAmount', label: 'Tiền vé / giá bán', type: 'money', required: true, placeholder: 'Giá bán cho khách' },
      costField, paidField, payTargetField, paidEditHint, notesField,
    ],
  },
  columns: [
    nameCol((r) => [r.phone_number, r.ticket_code].filter(Boolean).join(' · ')),
    { key: 'route', label: 'Hành trình', render: (r) => r.route ? <Badge tone="brand">{r.route}</Badge> : <span className="text-ink-faint">—</span> },
    { key: 'flight_date', label: 'Ngày bay', sortable: true, render: (r) => <DateCell value={r.flight_date} /> },
    { key: 'airline', label: 'Hãng', render: (r) => <span className="text-ink-soft">{r.airline || '—'}</span> },
    { key: 'checked_in', label: 'Check-in', align: 'center', defaultVisible: false, render: (r, ctx) => (
      <button type="button" title={r.checked_in ? 'Đã check-in — bấm để bỏ' : 'Chưa check-in — bấm để đánh dấu'} disabled={r.user_id !== ctx.currentUserId}
        onClick={async (e) => { e.stopPropagation(); try { await api.put(`/debts/${r.id}/checkin`, { checkedIn: !r.checked_in }); ctx.reload(); window.dispatchEvent(new CustomEvent('data:debts-changed')); } catch (err) { ctx.toast.error(err.message); } }}
        className={`inline-flex ${r.checked_in ? 'text-success-600' : 'text-ink-faint hover:text-ink'} disabled:cursor-default`}>
        {r.checked_in ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </button>
    ) },
    statusCol,
    { key: 'issue_date', label: 'Ngày xuất', sortable: true, defaultVisible: false, render: (r) => formatDate(r.issue_date) },
    { key: 'ticket_source', label: 'Nguồn vé', defaultVisible: false, render: (r) => r.ticket_source || <span className="text-ink-faint">—</span> },
    ...moneyCols('ticket_amount', { amountLabel: 'Tiền vé' }),
    ...paidCols('ticket_amount', 'paid'),
    dueCol, companyCol, ownerCol, notesCol,
  ],
  exportColumns: (ctx) => {
    const c = exportCommon(ctx);
    return [
      { label: 'Khách hàng', value: (r) => r.customer_name, width: 22 }, c.company, { label: 'SĐT', value: (r) => r.phone_number || '' },
      { label: 'Mã vé', value: (r) => r.ticket_code || '' }, { label: 'Hãng', value: (r) => r.airline || '', width: 16 }, { label: 'Nguồn vé', value: (r) => r.ticket_source || '' },
      { label: 'Hành trình', value: (r) => r.route || '' }, { label: 'Ngày bay', value: (r) => formatDate(r.flight_date) }, { label: 'Ngày xuất vé', value: (r) => formatDate(r.issue_date) },
      { label: 'Tiền vé', value: (r) => num(r.ticket_amount), money: true }, { label: 'Giá gốc', value: (r) => num(r.cost_amount), money: true },
      { label: 'Lợi nhuận', value: (r) => num(r.ticket_amount) - num(r.cost_amount), money: true }, { label: 'Đã thanh toán', value: (r) => num(r.paid), money: true },
      c.payTarget, { label: 'Còn nợ', value: (r) => num(r.ticket_amount) - num(r.paid), money: true }, { label: 'Hạn trả', value: (r) => formatDate(r.due_date) }, { label: 'Ghi chú', value: (r) => r.notes || '', width: 24 },
    ];
  },
  importFields: [
    { key: 'customerName', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên', 'customer'] },
    { key: 'phoneNumber', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone', 'điện thoại'] },
    { key: 'ticketCode', label: 'Mã vé', aliases: ['ma ve', 'code', 'ticket'] },
    { key: 'airline', label: 'Hãng', aliases: ['hang', 'hãng bay', 'hãng hàng không', 'airline'] },
    { key: 'route', label: 'Hành trình', aliases: ['chặng', 'tuyến', 'route', 'chang'] },
    { key: 'flightDate', label: 'Ngày bay', aliases: ['ngay bay', 'flight date', 'ngày khởi hành'] },
    { key: 'issueDate', label: 'Ngày xuất vé', aliases: ['ngay xuat', 'issue date', 'ngày xuất', 'ngày'] },
    { key: 'ticketAmount', label: 'Tiền vé', required: true, aliases: ['so tien', 'số tiền', 'amount', 'giá vé', 'tổng tiền'] },
    { key: 'costAmount', label: 'Giá gốc', aliases: ['gia goc', 'giá vốn', 'cost'] },
    { key: 'paid', label: 'Đã trả', aliases: ['da tra', 'đã thanh toán', 'paid', 'thanh toán'] },
    { key: 'notes', label: 'Ghi chú', aliases: ['ghi chu', 'note', 'notes', 'diễn giải'] },
  ],
  importSample: { customerName: 'Nguyễn Văn A', phoneNumber: '0901234567', ticketCode: 'VN123', airline: 'Vietnam Airlines', route: 'HAN-SGN', flightDate: '20/12/2025', issueDate: '01/12/2025', ticketAmount: 2500000, costAmount: 2200000, paid: 1000000, notes: 'Khách quen' },
  extraActions: (ctx, { open }) => (
    <>
      <Button variant="secondary" icon={Route} onClick={() => open('routes')}>Hành trình</Button>
      <Button variant="secondary" icon={Building2} onClick={() => open('companies')}>Công ty</Button>
    </>
  ),
  extraModals: (ctx, { open, close }) => (
    <>
      <RouteManagerModal open={open === 'routes'} onClose={close} routes={ctx.lists.routes || []} onChanged={ctx.reloadLists} />
      <CompanyManagerModal open={open === 'companies'} onClose={close} companies={ctx.companies} onChanged={ctx.reloadCompanies} />
    </>
  ),
};

// =====================================================================
// VÉ TÀU
// =====================================================================
export const trainsConfig = {
  key: 'trains', storageKey: 'trains', endpoint: '/train-tickets',
  title: 'Vé tàu hỏa', description: 'Vé tàu đã bán, giá bán/giá gốc và công nợ.',
  icon: Train, itemLabel: 'vé tàu', addLabel: 'Thêm vé tàu', exportName: 'cong-no-ve-tau',
  paymentType: 'train', paymentLabel: (r) => `${r.customer_name} · ${r.train_no || r.route || 'vé tàu'}`,
  amountKey: 'ticket_amount', costKey: 'cost_amount', paidKey: 'paid', dateKey: 'issue_date', dueKey: 'due_date', sourceKey: 'ticket_source',
  searchPlaceholder: 'Tìm khách, SĐT, số tàu, hành trình…',
  searchText: (r) => [r.customer_name, r.phone_number, r.train_no, r.route, r.seat_class].filter(Boolean).join(' '),
  mobileSubtitle: (r) => [r.train_no, r.route, r.depart_date ? `đi ${formatDate(r.depart_date)}` : ''].filter(Boolean).join(' · '),
  emptyForm: { customerName: '', phoneNumber: '', trainNo: '', route: '', seatClass: '', departDate: '', issueDate: '', dueDate: '', ticketSource: '', ticketAmount: '', costAmount: '', paid: '', notes: '', companyId: '', paymentTarget: 'self' },
  toForm: (d) => ({
    customerName: d.customer_name || '', phoneNumber: d.phone_number || '', trainNo: d.train_no || '', route: d.route || '', seatClass: d.seat_class || '',
    departDate: d.depart_date || '', issueDate: d.issue_date || '', dueDate: d.due_date || '', ticketSource: d.ticket_source || '',
    ticketAmount: d.ticket_amount, costAmount: d.cost_amount, __paidHint: d.paid, notes: d.notes || '', companyId: d.company_id || '', paymentTarget: 'self',
  }),
  toPayload: (f, { editing }) => ({
    customerName: f.customerName.trim(), phoneNumber: f.phoneNumber, trainNo: f.trainNo, route: f.route, seatClass: f.seatClass,
    departDate: f.departDate || null, issueDate: f.issueDate || null, dueDate: f.dueDate || null, ticketSource: f.ticketSource,
    ticketAmount: num(f.ticketAmount), costAmount: num(f.costAmount), notes: f.notes, companyId: f.companyId || null,
    ...(editing ? {} : { paid: num(f.paid), paymentTarget: f.paymentTarget }),
  }),
  validate: baseValidate('ticketAmount', 'giá bán'),
  form: {
    amountField: 'ticketAmount', dateField: 'issueDate',
    fields: [
      customerField, phoneField,
      { key: 'trainNo', label: 'Số tàu', placeholder: 'VD: SE7' },
      { key: 'route', label: 'Hành trình', placeholder: 'Ga đi - Ga đến' },
      { key: 'seatClass', label: 'Loại chỗ', placeholder: 'Ngồi mềm / Giường nằm…' },
      { key: 'departDate', label: 'Ngày đi', type: 'date' },
      { key: 'issueDate', label: 'Ngày xuất vé', type: 'date' },
      dueField,
      { key: 'ticketSource', label: 'Nguồn vé', type: 'datalist', options: (ctx) => ctx.sources },
      companyField,
      { key: 'ticketAmount', label: 'Giá bán', type: 'money', required: true },
      costField, paidField, payTargetField, paidEditHint, notesField,
    ],
  },
  columns: [
    nameCol((r) => [r.phone_number, r.train_no].filter(Boolean).join(' · ')),
    { key: 'route', label: 'Hành trình', render: (r) => r.route ? <Badge tone="brand">{r.route}</Badge> : <span className="text-ink-faint">—</span> },
    { key: 'depart_date', label: 'Ngày đi', sortable: true, render: (r) => <DateCell value={r.depart_date} /> },
    { key: 'seat_class', label: 'Loại chỗ', defaultVisible: false, render: (r) => r.seat_class || '—' },
    statusCol,
    { key: 'issue_date', label: 'Ngày xuất', sortable: true, defaultVisible: false, render: (r) => formatDate(r.issue_date) },
    { key: 'ticket_source', label: 'Nguồn vé', defaultVisible: false, render: (r) => r.ticket_source || '—' },
    ...moneyCols('ticket_amount'), ...paidCols('ticket_amount', 'paid'),
    dueCol, companyCol, ownerCol, notesCol,
  ],
  exportColumns: (ctx) => {
    const c = exportCommon(ctx);
    return [
      { label: 'Khách hàng', value: (r) => r.customer_name, width: 22 }, c.company, { label: 'SĐT', value: (r) => r.phone_number || '' },
      { label: 'Số tàu', value: (r) => r.train_no || '' }, { label: 'Hành trình', value: (r) => r.route || '', width: 18 }, { label: 'Loại chỗ', value: (r) => r.seat_class || '' },
      { label: 'Ngày đi', value: (r) => formatDate(r.depart_date) }, { label: 'Ngày xuất', value: (r) => formatDate(r.issue_date) }, { label: 'Nguồn', value: (r) => r.ticket_source || '' },
      { label: 'Giá bán', value: (r) => num(r.ticket_amount), money: true }, { label: 'Giá gốc', value: (r) => num(r.cost_amount), money: true },
      { label: 'Lợi nhuận', value: (r) => num(r.ticket_amount) - num(r.cost_amount), money: true }, { label: 'Đã trả', value: (r) => num(r.paid), money: true },
      c.payTarget, { label: 'Còn nợ', value: (r) => num(r.ticket_amount) - num(r.paid), money: true }, { label: 'Ghi chú', value: (r) => r.notes || '', width: 24 },
    ];
  },
  importFields: [
    { key: 'customerName', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên'] },
    { key: 'phoneNumber', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone'] },
    { key: 'trainNo', label: 'Số tàu', aliases: ['so tau', 'tàu', 'train'] },
    { key: 'route', label: 'Hành trình', aliases: ['chặng', 'tuyến', 'route', 'ga'] },
    { key: 'seatClass', label: 'Loại chỗ', aliases: ['loai cho', 'ghế', 'giường', 'seat'] },
    { key: 'departDate', label: 'Ngày đi', aliases: ['ngay di', 'ngày khởi hành', 'depart'] },
    { key: 'issueDate', label: 'Ngày xuất vé', aliases: ['ngay xuat', 'ngày xuất', 'ngày'] },
    { key: 'ticketAmount', label: 'Giá bán', required: true, aliases: ['so tien', 'số tiền', 'tiền vé', 'amount'] },
    { key: 'costAmount', label: 'Giá gốc', aliases: ['gia goc', 'giá vốn', 'cost'] },
    { key: 'paid', label: 'Đã trả', aliases: ['da tra', 'đã thanh toán', 'paid'] },
    { key: 'notes', label: 'Ghi chú', aliases: ['ghi chu', 'note'] },
  ],
  importSample: { customerName: 'Lê Văn C', phoneNumber: '0912345678', trainNo: 'SE7', route: 'Hà Nội - Đà Nẵng', seatClass: 'Giường nằm', departDate: '20/12/2025', issueDate: '01/12/2025', ticketAmount: 900000, costAmount: 820000, paid: 0, notes: '' },
};

// =====================================================================
// TOUR DU LỊCH
// =====================================================================
const TOUR_STATUS = [
  { value: 'consulting', label: 'Tư vấn', tone: 'brand' },
  { value: 'deposited', label: 'Đã cọc', tone: 'warning' },
  { value: 'completed', label: 'Đã đi', tone: 'success' },
  { value: 'cancelled', label: 'Huỷ', tone: 'gray' },
];
export const toursConfig = {
  key: 'tours', storageKey: 'tours', endpoint: '/tours',
  title: 'Tour du lịch', description: 'Tour đã bán, tiến độ (tư vấn/cọc/đã đi) và công nợ.',
  icon: Palmtree, itemLabel: 'tour', addLabel: 'Thêm tour', exportName: 'cong-no-tour',
  paymentType: 'tour', paymentLabel: (r) => `${r.customer_name} · ${r.tour_name || 'tour'}`,
  amountKey: 'sell_amount', costKey: 'cost_amount', paidKey: 'paid', dateKey: 'issue_date', dueKey: 'due_date', sourceKey: 'source',
  searchPlaceholder: 'Tìm khách, SĐT, tên tour…',
  searchText: (r) => [r.customer_name, r.phone_number, r.tour_name, r.source].filter(Boolean).join(' '),
  mobileSubtitle: (r) => [r.tour_name, r.depart_date ? `đi ${formatDate(r.depart_date)}` : '', r.pax ? `${r.pax} khách` : ''].filter(Boolean).join(' · '),
  extraFilters: [{ key: 'status', label: 'Mọi trạng thái', options: TOUR_STATUS, fn: (r, v) => r.status === v }],
  emptyForm: { customerName: '', phoneNumber: '', tourName: '', departDate: '', returnDate: '', pax: '1', issueDate: '', dueDate: '', source: '', sellAmount: '', costAmount: '', paid: '', status: 'deposited', notes: '', companyId: '', paymentTarget: 'self' },
  toForm: (d) => ({
    customerName: d.customer_name || '', phoneNumber: d.phone_number || '', tourName: d.tour_name || '', departDate: d.depart_date || '', returnDate: d.return_date || '',
    pax: String(d.pax ?? 1), issueDate: d.issue_date || '', dueDate: d.due_date || '', source: d.source || '', sellAmount: d.sell_amount, costAmount: d.cost_amount,
    __paidHint: d.paid, status: d.status || 'deposited', notes: d.notes || '', companyId: d.company_id || '', paymentTarget: 'self',
  }),
  toPayload: (f, { editing }) => ({
    customerName: f.customerName.trim(), phoneNumber: f.phoneNumber, tourName: f.tourName, departDate: f.departDate || null, returnDate: f.returnDate || null,
    pax: parseInt(f.pax, 10) || 1, issueDate: f.issueDate || null, dueDate: f.dueDate || null, source: f.source,
    sellAmount: num(f.sellAmount), costAmount: num(f.costAmount), status: f.status, notes: f.notes, companyId: f.companyId || null,
    ...(editing ? {} : { paid: num(f.paid), paymentTarget: f.paymentTarget }),
  }),
  validate: (f) => baseValidate('sellAmount', 'giá bán')(f) || (f.returnDate && f.departDate && f.returnDate < f.departDate ? 'Ngày về phải sau ngày đi' : null),
  form: {
    amountField: 'sellAmount', dateField: 'issueDate',
    fields: [
      customerField, phoneField,
      { key: 'tourName', label: 'Tên tour / điểm đến', placeholder: 'VD: Đà Nẵng 3N2Đ' },
      { key: 'departDate', label: 'Ngày đi', type: 'date' },
      { key: 'returnDate', label: 'Ngày về', type: 'date' },
      { key: 'pax', label: 'Số khách', type: 'number', min: 1 },
      { key: 'status', label: 'Trạng thái', type: 'select', options: TOUR_STATUS },
      { key: 'issueDate', label: 'Ngày bán', type: 'date' },
      dueField,
      { key: 'source', label: 'Nguồn / đối tác', type: 'datalist', options: (ctx) => ctx.sources },
      companyField,
      { key: 'sellAmount', label: 'Giá bán (tổng)', type: 'money', required: true },
      costField, paidField, payTargetField, paidEditHint, notesField,
    ],
  },
  columns: [
    nameCol((r) => [r.phone_number, r.pax ? `${r.pax} khách` : ''].filter(Boolean).join(' · ')),
    { key: 'tour_name', label: 'Tour', sortable: true, render: (r) => <span className="font-medium">{r.tour_name || '—'}</span> },
    { key: 'depart_date', label: 'Ngày đi', sortable: true, render: (r) => <DateCell value={r.depart_date} /> },
    { key: 'return_date', label: 'Ngày về', defaultVisible: false, render: (r) => formatDate(r.return_date) || '—' },
    { key: 'status', label: 'Tiến độ', render: (r) => { const s = TOUR_STATUS.find((x) => x.value === r.status) || TOUR_STATUS[1]; return <Badge tone={s.tone}>{s.label}</Badge>; } },
    statusCol,
    { key: 'pax', label: 'Khách', align: 'center', defaultVisible: false, render: (r) => r.pax ?? 1 },
    { key: 'issue_date', label: 'Ngày bán', sortable: true, defaultVisible: false, render: (r) => formatDate(r.issue_date) },
    { key: 'source', label: 'Nguồn', defaultVisible: false, render: (r) => r.source || '—' },
    ...moneyCols('sell_amount'), ...paidCols('sell_amount', 'paid'),
    dueCol, companyCol, ownerCol, notesCol,
  ],
  exportColumns: (ctx) => {
    const c = exportCommon(ctx);
    return [
      { label: 'Khách hàng', value: (r) => r.customer_name, width: 22 }, c.company, { label: 'SĐT', value: (r) => r.phone_number || '' },
      { label: 'Tour', value: (r) => r.tour_name || '', width: 24 }, { label: 'Ngày đi', value: (r) => formatDate(r.depart_date) }, { label: 'Ngày về', value: (r) => formatDate(r.return_date) },
      { label: 'Số khách', value: (r) => r.pax ?? 1 }, { label: 'Trạng thái', value: (r) => TOUR_STATUS.find((x) => x.value === r.status)?.label || r.status },
      { label: 'Ngày bán', value: (r) => formatDate(r.issue_date) }, { label: 'Nguồn', value: (r) => r.source || '' },
      { label: 'Giá bán', value: (r) => num(r.sell_amount), money: true }, { label: 'Giá gốc', value: (r) => num(r.cost_amount), money: true },
      { label: 'Lợi nhuận', value: (r) => num(r.sell_amount) - num(r.cost_amount), money: true }, { label: 'Đã trả', value: (r) => num(r.paid), money: true },
      c.payTarget, { label: 'Còn nợ', value: (r) => num(r.sell_amount) - num(r.paid), money: true }, { label: 'Ghi chú', value: (r) => r.notes || '', width: 24 },
    ];
  },
  importFields: [
    { key: 'customerName', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên'] },
    { key: 'phoneNumber', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone'] },
    { key: 'tourName', label: 'Tên tour', aliases: ['tour', 'điểm đến', 'diem den'] },
    { key: 'departDate', label: 'Ngày đi', aliases: ['ngay di', 'khởi hành'] },
    { key: 'returnDate', label: 'Ngày về', aliases: ['ngay ve', 'return'] },
    { key: 'pax', label: 'Số khách', aliases: ['so khach', 'pax', 'khách'] },
    { key: 'issueDate', label: 'Ngày bán', aliases: ['ngay ban', 'ngày xuất', 'ngày'] },
    { key: 'sellAmount', label: 'Giá bán', required: true, aliases: ['so tien', 'số tiền', 'tổng tiền', 'amount'] },
    { key: 'costAmount', label: 'Giá gốc', aliases: ['gia goc', 'giá vốn', 'cost'] },
    { key: 'paid', label: 'Đã trả', aliases: ['da tra', 'đã cọc', 'paid'] },
    { key: 'notes', label: 'Ghi chú', aliases: ['ghi chu', 'note'] },
  ],
  importSample: { customerName: 'Phạm Thị D', phoneNumber: '0987654321', tourName: 'Phú Quốc 3N2Đ', departDate: '25/12/2025', returnDate: '27/12/2025', pax: 2, issueDate: '01/12/2025', sellAmount: 9800000, costAmount: 8500000, paid: 3000000, notes: '' },
};

// =====================================================================
// HỘ CHIẾU
// =====================================================================
export const passportsConfig = {
  key: 'passports', storageKey: 'passports', endpoint: '/passports',
  title: 'Dịch vụ hộ chiếu', description: 'Hồ sơ làm hộ chiếu, phí dịch vụ và công nợ.',
  icon: BookOpen, itemLabel: 'hồ sơ', addLabel: 'Thêm hồ sơ', exportName: 'cong-no-ho-chieu',
  paymentType: 'passport', paymentLabel: (r) => `${r.customer_name} · ${r.passport_number || 'hộ chiếu'}`,
  amountKey: 'total_amount', costKey: 'cost_amount', paidKey: 'paid_amount', dateKey: 'service_date', dueKey: 'due_date', sourceKey: 'address',
  defaultSort: { key: 'service_date', dir: 'desc' },
  searchPlaceholder: 'Tìm khách, SĐT, số hộ chiếu, địa chỉ…',
  searchText: (r) => [r.customer_name, r.phone_number, r.passport_number, r.address].filter(Boolean).join(' '),
  mobileSubtitle: (r) => [r.passport_number, r.service_date ? `làm ${formatDate(r.service_date)}` : ''].filter(Boolean).join(' · '),
  emptyForm: { customerName: '', phoneNumber: '', passportNumber: '', address: '', serviceDate: '', dueDate: '', totalAmount: '', costAmount: '', paid: '', notes: '', companyId: '', paymentTarget: 'self' },
  toForm: (d) => ({
    customerName: d.customer_name || '', phoneNumber: d.phone_number || '', passportNumber: d.passport_number || '', address: d.address || '',
    serviceDate: d.service_date || '', dueDate: d.due_date || '', totalAmount: d.total_amount, costAmount: d.cost_amount, __paidHint: d.paid_amount,
    notes: d.notes || '', companyId: d.company_id || '', paymentTarget: 'self',
  }),
  toPayload: (f, { editing }) => ({
    customerName: f.customerName.trim(), phoneNumber: f.phoneNumber, passportNumber: f.passportNumber, address: f.address,
    serviceDate: f.serviceDate, dueDate: f.dueDate || null, totalAmount: num(f.totalAmount), costAmount: num(f.costAmount), notes: f.notes, companyId: f.companyId || null,
    ...(editing ? {} : { paidAmount: num(f.paid), paymentTarget: f.paymentTarget }),
  }),
  validate: (f) => baseValidate('totalAmount', 'tổng tiền')(f) || (!f.serviceDate ? 'Vui lòng chọn ngày làm' : null),
  form: {
    amountField: 'totalAmount', dateField: 'serviceDate',
    fields: [
      customerField, phoneField,
      { key: 'passportNumber', label: 'Số hộ chiếu', placeholder: 'VD: C1234567' },
      { key: 'address', label: 'Địa chỉ', span: 2 },
      { key: 'serviceDate', label: 'Ngày làm', type: 'date', required: true },
      dueField, companyField,
      { key: 'totalAmount', label: 'Tổng tiền', type: 'money', required: true },
      costField, paidField, payTargetField, paidEditHint, notesField,
    ],
  },
  columns: [
    nameCol((r) => [r.phone_number, r.passport_number].filter(Boolean).join(' · ')),
    { key: 'passport_number', label: 'Số HC', render: (r) => r.passport_number ? <span className="font-mono text-[12.5px]">{r.passport_number}</span> : <span className="text-ink-faint">—</span> },
    { key: 'service_date', label: 'Ngày làm', sortable: true, render: (r) => formatDate(r.service_date) },
    { key: 'address', label: 'Địa chỉ', defaultVisible: false, render: (r) => <span className="line-clamp-1 max-w-[200px]">{r.address || '—'}</span> },
    statusCol,
    ...moneyCols('total_amount', { amountLabel: 'Tổng tiền' }), ...paidCols('total_amount', 'paid_amount'),
    dueCol, companyCol, ownerCol, notesCol,
  ],
  exportColumns: (ctx) => {
    const c = exportCommon(ctx);
    return [
      { label: 'Khách hàng', value: (r) => r.customer_name, width: 22 }, c.company, { label: 'SĐT', value: (r) => r.phone_number || '' },
      { label: 'Số hộ chiếu', value: (r) => r.passport_number || '' }, { label: 'Địa chỉ', value: (r) => r.address || '', width: 24 },
      { label: 'Ngày làm', value: (r) => formatDate(r.service_date) }, { label: 'Hạn trả', value: (r) => formatDate(r.due_date) },
      { label: 'Tổng tiền', value: (r) => num(r.total_amount), money: true }, { label: 'Giá gốc', value: (r) => num(r.cost_amount), money: true },
      { label: 'Lợi nhuận', value: (r) => num(r.total_amount) - num(r.cost_amount), money: true }, { label: 'Đã trả', value: (r) => num(r.paid_amount), money: true },
      { label: 'Còn nợ', value: (r) => num(r.total_amount) - num(r.paid_amount), money: true }, { label: 'Ghi chú', value: (r) => r.notes || '', width: 24 },
    ];
  },
  importFields: [
    { key: 'customerName', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên'] },
    { key: 'passportNumber', label: 'Số hộ chiếu', aliases: ['so ho chieu', 'passport', 'số HC'] },
    { key: 'phoneNumber', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone', 'điện thoại'] },
    { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'address'] },
    { key: 'serviceDate', label: 'Ngày làm', required: true, aliases: ['ngay lam', 'ngày dịch vụ', 'service date', 'ngày'] },
    { key: 'totalAmount', label: 'Tổng tiền', required: true, aliases: ['tong tien', 'so tien', 'số tiền', 'amount'] },
    { key: 'costAmount', label: 'Giá gốc', aliases: ['gia goc', 'giá vốn', 'cost'] },
    { key: 'paidAmount', label: 'Đã trả', aliases: ['da tra', 'đã thanh toán', 'paid'] },
    { key: 'notes', label: 'Ghi chú', aliases: ['ghi chu', 'note', 'notes'] },
  ],
  importSample: { customerName: 'Trần Thị B', passportNumber: 'C1234567', phoneNumber: '0912345678', address: 'Hà Nội', serviceDate: '15/12/2025', totalAmount: 1200000, costAmount: 900000, paidAmount: 0, notes: 'Làm mới' },
};
