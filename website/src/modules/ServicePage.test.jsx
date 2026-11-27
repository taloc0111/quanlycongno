import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth/AuthContext';
import { NavigationProvider } from '../hooks/useNavigation.jsx';
import { FeedbackProvider } from '../ui/FeedbackContext';
import ServicePage from './ServicePage';
import { debtsConfig, trainsConfig, toursConfig, passportsConfig } from './serviceConfigs';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { invalidateMoneyCache } from '../services/money';
import { today, addDays } from '../utils/format';

// ReceiptModal do module Dòng tiền cung cấp — ở đây chỉ kiểm tra props truyền vào.
vi.mock('./money/ReceiptModal', () => ({
  default: ({ customerId, preselect, onClose }) => (
    <div data-testid="receipt-modal">
      {JSON.stringify({ customerId, preselect })}
      <button type="button" onClick={onClose}>Đóng phiếu thu</button>
    </div>
  ),
}));

const ME = { id: 1, username: 'admin', role: 'admin', features: {} };
const ACCOUNTS = [{ id: 7, name: 'TCB chính', account_number: '19031234', is_own: true, archived: false }];
const SUPPLIERS = [{ id: 2, name: 'Khác A', kind: 'other' }, { id: 3, name: 'F1 Thùy Dương', kind: 'f1' }, { id: 4, name: 'Down Hùng', kind: 'down' }];
const MONEY = { 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS };
const OTHER_ROW = { id: 9, user_id: 2, owner_name: 'Đại lý B', customer_name: 'Khách Của B', phone_number: '0999', ticket_amount: '500000.00', cost_amount: '400000.00', paid: '0', issue_date: '2026-11-01', flight_date: '2026-12-20', route: 'HAN-SGN', airline: 'VJ' };

function debtRows() {
  return [
    { id: 1, user_id: 1, customer_name: 'Nguyễn Văn A', customer_id: 11, phone_number: '0901', ticket_code: 'ABC123', route: 'SGN-HAN', airline: 'Vietnam Airlines', flight_date: addDays(today(), 1), issue_date: '2026-11-05', due_date: addDays(today(), -3), ticket_amount: '2500000.00', cost_amount: '2200000.00', paid: '1000000.00', agency_paid: '0', checked_in: false },
    { id: 2, user_id: 1, customer_name: 'Trần Thị B', customer_id: 12, phone_number: '0902', ticket_code: 'XYZ789', route: 'HAN-DAD', airline: 'Vietjet Air', flight_date: null, issue_date: '2026-10-15', due_date: null, ticket_amount: '1000000.00', cost_amount: '900000.00', paid: '1000000.00', agency_paid: '0', checked_in: true },
    OTHER_ROW,
  ];
}

// jsdom không áp CSS nên cả bảng (desktop) lẫn thẻ (mobile) cùng render → luôn query trong <table>.
const tbl = () => within(screen.getByRole('table'));
const waitRows = async (name) => { await screen.findAllByText(name); return tbl(); };

function renderPage(config) {
  return render(
    <FeedbackProvider>
      <AuthProvider>
        <NavigationProvider>
          <ServicePage config={config} />
        </NavigationProvider>
      </AuthProvider>
    </FeedbackProvider>,
  );
}

beforeEach(() => {
  storage.set('token', 'tok');
  storage.setJSON('authUser', ME);
  window.location.hash = '';
  storage.remove('payment:lastAccount');
  invalidateMoneyCache();
});

describe('ServicePage (debts)', () => {
  it('renders rows, stats and read-only guard', async () => {
    mockApi({
      'GET /debts': debtRows(),
      'GET /companies': [{ id: 5, name: 'Công ty X' }],
      'GET /customers': [],
      'GET /routes': ['HAN-SGN'],
      'GET /auth/profile': ME, ...MONEY,
    });
    renderPage(debtsConfig);
    const t = await waitRows('Nguyễn Văn A');
    expect(t.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(t.getByText('Trần Thị B')).toBeInTheDocument();
    // Dòng của người khác: chỉ xem
    expect(t.getByText('Chỉ xem')).toBeInTheDocument();
    // Thẻ số liệu: doanh số = 2.5tr + 1tr + 0.5tr = 4.000.000
    expect(screen.getAllByText(/4\.000\.000/).length).toBeGreaterThan(0);
    // Quá hạn: dòng 1 còn nợ 1.5tr và hạn đã qua
    expect(t.getByText('Quá hạn')).toBeInTheDocument();
    expect(t.getByText('Đã trả đủ')).toBeInTheDocument();
  });

  it('filters by search and payment status', async () => {
    mockApi({ 'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME, ...MONEY });
    renderPage(debtsConfig);
    await waitRows('Nguyễn Văn A');
    const search = screen.getByPlaceholderText(/Tìm khách/);
    await userEvent.type(search, 'xyz');
    await waitFor(() => expect(tbl().queryByText('Nguyễn Văn A')).not.toBeInTheDocument());
    expect(tbl().getByText('Trần Thị B')).toBeInTheDocument();
    await userEvent.clear(search);

    const selects = screen.getAllByRole('combobox');
    const paySelect = selects.find((s) => within(s).queryByText('Còn nợ'));
    fireEvent.change(paySelect, { target: { value: 'paid' } });
    await waitFor(() => expect(tbl().queryByText('Nguyễn Văn A')).not.toBeInTheDocument());
    expect(tbl().getByText('Trần Thị B')).toBeInTheDocument();
  });

  it('creates a debt through the modal form and shows a toast', async () => {
    const { calls } = mockApi({
      'GET /debts': () => debtRows(),
      'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME, ...MONEY,
      'POST /debts': ({ body }) => ({ id: 100, ...body }),
    });
    renderPage(debtsConfig);
    await waitRows('Nguyễn Văn A');
    await userEvent.click(screen.getByRole('button', { name: /Thêm vé/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Tên khách hàng/), 'Khách Mới');
    await userEvent.type(within(dialog).getByLabelText(/Tiền vé/), '3000000');
    await userEvent.type(within(dialog).getByLabelText(/Giá gốc/), '2500000');
    expect(within(dialog).getByText(/500\.000/)).toBeInTheDocument(); // lợi nhuận dự kiến
    await userEvent.click(within(dialog).getByRole('button', { name: /Thêm mới/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/debts')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/debts');
    expect(post.body).toMatchObject({ customerName: 'Khách Mới', ticketAmount: 3000000, costAmount: 2500000, paid: 0, paymentTarget: 'self' });
    expect(post.body.issueDate).toBe(today());
    expect(await screen.findByText(/Đã thêm vé/)).toBeInTheDocument();
  });

  it('shows the server validation error instead of success', async () => {
    mockApi({
      'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME, ...MONEY,
      'POST /debts': { status: 400, body: { error: 'Số điện thoại quá dài' } },
    });
    renderPage(debtsConfig);
    await waitRows('Nguyễn Văn A');
    await userEvent.click(screen.getByRole('button', { name: /Thêm vé/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Tên khách hàng/), 'X');
    await userEvent.type(within(dialog).getByLabelText(/Tiền vé/), '100');
    await userEvent.click(within(dialog).getByRole('button', { name: /Thêm mới/ }));
    expect(await screen.findByText('Số điện thoại quá dài')).toBeInTheDocument();
    expect(screen.queryByText(/Đã thêm vé/)).not.toBeInTheDocument();
  });

  it('deletes after confirm and bulk-deletes selected rows', async () => {
    const { calls } = mockApi({
      'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME, ...MONEY,
      'DELETE /debts/:id': { message: 'ok' },
      'POST /debts/bulk-delete': ({ body }) => ({ deleted: body.ids.length }),
    });
    renderPage(debtsConfig);
    await waitRows('Nguyễn Văn A');
    await userEvent.click(tbl().getAllByRole('button', { name: 'Xoá' })[0]);
    const dlg = await screen.findByRole('alertdialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(tbl().queryByText('Nguyễn Văn A')).not.toBeInTheDocument());

    // Chọn tất cả: chỉ chọn dòng của mình (dòng của B không có checkbox)
    await userEvent.click(screen.getByLabelText('Chọn tất cả'));
    expect(screen.getByText(/Đã chọn 1 vé/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Xoá đã chọn/ }));
    const dlg2 = await screen.findByRole('alertdialog');
    await userEvent.click(within(dlg2).getByRole('button', { name: /Xoá 1 mục/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/debts/bulk-delete')?.body).toEqual({ ids: [2] }));
  });

  it('edit form does not send paid and keeps the other fields', async () => {
    const { calls } = mockApi({
      'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME, ...MONEY,
      'PUT /debts/:id': ({ body }) => ({ id: 1, ...body }),
    });
    renderPage(debtsConfig);
    await waitRows('Nguyễn Văn A');
    await userEvent.click(tbl().getAllByRole('button', { name: 'Sửa' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Đã trả/)).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe('/debts/1');
    expect(put.body).not.toHaveProperty('paid');
    expect(put.body).toMatchObject({ customerName: 'Nguyễn Văn A', ticketCode: 'ABC123', ticketAmount: 2500000 });
  });
});

describe('ServicePage (other configs)', () => {
  it('train / tour / passport configs render and compute stats', async () => {
    mockApi({
      'GET /train-tickets': [{ id: 1, user_id: 1, customer_name: 'Tàu A', train_no: 'SE7', route: 'HN-DN', depart_date: '2026-12-01', issue_date: '2026-11-01', ticket_amount: '900000', cost_amount: '800000', paid: '0' }],
      'GET /tours': [{ id: 1, user_id: 1, customer_name: 'Tour A', tour_name: 'Phú Quốc', status: 'deposited', pax: 2, depart_date: '2026-12-25', issue_date: '2026-11-01', sell_amount: '9800000', cost_amount: '8500000', paid: '3000000' }],
      'GET /passports': [{ id: 1, user_id: 1, customer_name: 'HC A', passport_number: 'C123', service_date: '2026-11-10', total_amount: '1200000', cost_amount: '900000', paid_amount: '1200000' }],
      'GET /companies': [], 'GET /customers': [], 'GET /auth/profile': ME, ...MONEY,
    });
    const r1 = renderPage(trainsConfig);
    expect((await waitRows('Tàu A')).getByText('Tàu A')).toBeInTheDocument();
    expect(tbl().getByText('Chưa trả')).toBeInTheDocument();
    r1.unmount();

    const r2 = renderPage(toursConfig);
    expect((await waitRows('Tour A')).getByText('Tour A')).toBeInTheDocument();
    expect(tbl().getByText('Đã cọc')).toBeInTheDocument();
    expect(tbl().getByText('Trả 1 phần')).toBeInTheDocument();
    r2.unmount();

    renderPage(passportsConfig);
    expect((await waitRows('HC A')).getByText('HC A')).toBeInTheDocument();
    expect(tbl().getByText('Đã trả đủ')).toBeInTheDocument();
    // Lợi nhuận 300.000 (không còn NaN như bản cũ)
    expect(screen.getAllByText(/300\.000/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dòng tiền v3: giá vốn nhiều khoản, vé down, chưa đủ giá vốn, nợ NCC.
// ---------------------------------------------------------------------------
const base = (extra = {}) => ({ 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME, ...MONEY, ...extra });

function costRows() {
  return [
    { id: 1, user_id: 1, customer_name: 'Khách Đủ Vốn', customer_id: 11, ticket_code: 'AAA111', issue_date: '2026-11-05', ticket_amount: '1000000.00', cost_amount: '800000.00', paid: '0', cost_pending: false, cost_unpaid: '0', cost_items: [] },
    { id: 2, user_id: 1, customer_name: 'Khách Chờ Vốn', customer_id: 12, ticket_code: 'BBB222', issue_date: '2026-11-06', ticket_amount: '2000000.00', cost_amount: '0.00', paid: '0', cost_pending: true, cost_unpaid: '0', cost_items: [] },
    {
      id: 3, user_id: 1, customer_name: 'Khách Vé Down', customer_id: 13, ticket_code: 'CCC333', issue_date: '2026-11-07', ticket_amount: '1500000.00', cost_amount: '1225000.00', paid: '0',
      cost_pending: false, ticket_kind: 'down', cost_unpaid: '25000.00',
      cost_items: [
        { id: 50, supplier_id: 3, supplier_name: 'F1 Thùy Dương', label: 'Giá vé F1', amount: '1200000.00', paid_amount: '1200000.00', due_date: null },
        { id: 51, supplier_id: 4, supplier_name: 'Down Hùng', label: 'Phí down', amount: '25000.00', paid_amount: '0.00', due_date: '2026-12-01' },
      ],
    },
  ];
}

async function openAddForm() {
  await userEvent.click(screen.getByRole('button', { name: /Thêm vé/ }));
  return screen.findByRole('dialog');
}

describe('ServicePage (giá vốn / dòng tiền)', () => {
  it('"Vé down" adds the 3 template rows with F1 / down suppliers', async () => {
    mockApi(base({ 'GET /debts': costRows() }));
    renderPage(debtsConfig);
    await waitRows('Khách Đủ Vốn');
    const dialog = await openAddForm();
    expect(within(dialog).getByText(/Vé down = vé xuất giảm/)).toBeInTheDocument();
    // Chưa nhập giá vốn → gợi ý "Chưa đủ giá vốn"
    expect(within(dialog).getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Vé down' }));
    expect(within(dialog).getAllByTestId('cost-item')).toHaveLength(3);
    expect(within(dialog).getByLabelText('Tên khoản 1')).toHaveValue('Giá vé F1');
    expect(within(dialog).getByLabelText('Tên khoản 2')).toHaveValue('Phí F1');
    expect(within(dialog).getByLabelText('Tên khoản 3')).toHaveValue('Phí down');
    expect(within(dialog).getByLabelText('Nhà cung cấp 1')).toHaveValue('3');
    expect(within(dialog).getByLabelText('Nhà cung cấp 2')).toHaveValue('3');
    expect(within(dialog).getByLabelText('Nhà cung cấp 3')).toHaveValue('4');
    expect(within(dialog).getByLabelText('Số tiền 2')).toHaveValue('5.000');
    expect(within(dialog).getByLabelText('Số tiền 3')).toHaveValue('');
    // Ô giá gốc đơn bị thay bằng trình nhập nhiều dòng
    expect(within(dialog).queryByLabelText(/Giá gốc/)).not.toBeInTheDocument();
    // Phí down còn trống → vẫn "Chưa đủ giá vốn"
    expect(within(dialog).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('saves costItems (with payNow), ticketKind, costPending and the initial-payment account', async () => {
    const { calls } = mockApi(base({ 'GET /debts': () => costRows(), 'POST /debts': ({ body }) => ({ id: 100, ...body }) }));
    renderPage(debtsConfig);
    await waitRows('Khách Đủ Vốn');
    const dialog = await openAddForm();
    await userEvent.type(within(dialog).getByLabelText(/Tên khách hàng/), 'Khách Down');
    await userEvent.type(within(dialog).getByLabelText(/Tiền vé/), '1600000');
    await userEvent.type(within(dialog).getByLabelText(/Trả trước/), '500000');
    fireEvent.change(within(dialog).getByLabelText('Vào tài khoản'), { target: { value: '7' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vé down' }));
    await userEvent.type(within(dialog).getByLabelText('Số tiền 1'), '1500000');
    await userEvent.type(within(dialog).getByLabelText('Số tiền 3'), '20000');
    // Đủ giá vốn → tự tắt công tắc, có lợi nhuận dự kiến 75.000
    expect(within(dialog).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByText(/75\.000/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Trả ngay 1'));
    fireEvent.change(within(dialog).getByLabelText('Trả từ tài khoản 1'), { target: { value: '7' } });

    await userEvent.click(within(dialog).getByRole('button', { name: /Thêm mới/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/debts')).toBe(true));
    const { body } = calls.find((c) => c.method === 'POST' && c.path === '/debts');
    expect(body).toMatchObject({ ticketKind: 'down', costPending: false, costAmount: 1525000, paid: 500000, accountId: 7 });
    expect(body.costItems).toEqual([
      { supplierId: 3, label: 'Giá vé F1', amount: 1500000, dueDate: null, payNow: { accountId: 7, payDate: today() } },
      { supplierId: 3, label: 'Phí F1', amount: 5000, dueDate: null },
      { supplierId: 4, label: 'Phí down', amount: 20000, dueDate: null },
    ]);
    expect(storage.get('payment:lastAccount')).toBe('7');
  });

  it('creating without any cost sends costPending true and no costItems key', async () => {
    const { calls } = mockApi(base({ 'GET /debts': () => costRows(), 'POST /debts': ({ body }) => ({ id: 101, ...body }) }));
    renderPage(debtsConfig);
    await waitRows('Khách Đủ Vốn');
    const dialog = await openAddForm();
    await userEvent.type(within(dialog).getByLabelText(/Tên khách hàng/), 'Khách Trả Trước');
    await userEvent.type(within(dialog).getByLabelText(/Tiền vé/), '900000');
    expect(within(dialog).getByText(/Chưa tính \(chưa đủ giá vốn\)/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Thêm mới/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/debts')).toBe(true));
    const { body } = calls.find((c) => c.method === 'POST' && c.path === '/debts');
    expect(body).toMatchObject({ costPending: true, ticketKind: 'normal', costAmount: 0 });
    expect(body).not.toHaveProperty('costItems');
    expect(body).not.toHaveProperty('accountId');
  });

  it('editing a row without cost items omits costItems', async () => {
    const { calls } = mockApi(base({ 'GET /debts': costRows(), 'PUT /debts/:id': ({ body }) => ({ id: 1, ...body }) }));
    renderPage(debtsConfig);
    await waitRows('Khách Đủ Vốn');
    const row = tbl().getByText('Khách Đủ Vốn').closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Sửa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Giá gốc/)).toHaveValue('800.000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const { body } = calls.find((c) => c.method === 'PUT');
    expect(body).not.toHaveProperty('costItems');
    expect(body).toMatchObject({ costAmount: 800000, costPending: false, ticketKind: 'normal' });
  });

  it('editing a row with items keeps ids (no paidAmount); removing all rows sends costItems: []', async () => {
    const { calls } = mockApi(base({ 'GET /debts': costRows(), 'PUT /debts/:id': ({ body }) => ({ id: 3, ...body }) }));
    renderPage(debtsConfig);
    await waitRows('Khách Vé Down');
    const row = tbl().getByText('Khách Vé Down').closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Sửa' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByTestId('cost-item')).toHaveLength(2);
    expect(within(within(dialog).getAllByTestId('cost-item')[0]).getByText('Đã trả')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Vé down' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    const first = calls.find((c) => c.method === 'PUT').body;
    expect(first.ticketKind).toBe('down');
    expect(first.costItems).toEqual([
      { id: 50, supplierId: 3, label: 'Giá vé F1', amount: 1200000, dueDate: null },
      { id: 51, supplierId: 4, label: 'Phí down', amount: 25000, dueDate: '2026-12-01' },
    ]);

    // Mở lại, xoá hết dòng → gửi costItems: []
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(within(tbl().getByText('Khách Vé Down').closest('tr')).getByRole('button', { name: 'Sửa' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá dòng 2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá dòng 1' }));
    expect(within(dialog).getByLabelText(/Giá gốc/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    const second = calls.filter((c) => c.method === 'PUT')[1].body;
    expect(second.costItems).toEqual([]);
  });

  it('profit card excludes cost-pending rows and the table shows cost badges', async () => {
    mockApi(base({ 'GET /debts': costRows() }));
    renderPage(debtsConfig);
    const t = await waitRows('Khách Đủ Vốn');
    // Lợi nhuận = 200.000 (dòng 1) + 275.000 (dòng 3); dòng 2 (2tr, chưa đủ vốn) không tính
    const sub = screen.getByText('Không tính 1 dòng chưa đủ giá vốn');
    const card = sub.closest('.card');
    expect(within(card).getByText(/475\.000/)).toBeInTheDocument();
    // Doanh số vẫn tính đủ 4.500.000
    expect(screen.getAllByText(/4\.500\.000/).length).toBeGreaterThan(0);
    expect(t.getByText('Vé down')).toBeInTheDocument();
    expect(t.getByText('Chưa đủ giá vốn')).toBeInTheDocument();
    expect(t.getByText(/Nợ NCC 25\.000/)).toBeInTheDocument();
    // Cột lợi nhuận của dòng chưa đủ vốn: "Chưa tính"
    expect(within(t.getByText('Khách Chờ Vốn').closest('tr')).getByText('Chưa tính')).toBeInTheDocument();
  });

  it('"Giá vốn" filter: Chưa đủ giá vốn / Còn nợ NCC', async () => {
    mockApi(base({ 'GET /debts': costRows() }));
    renderPage(debtsConfig);
    await waitRows('Khách Đủ Vốn');
    const filter = screen.getByLabelText('Lọc giá vốn');
    fireEvent.change(filter, { target: { value: 'pending' } });
    await waitFor(() => expect(tbl().queryByText('Khách Đủ Vốn')).not.toBeInTheDocument());
    expect(tbl().getByText('Khách Chờ Vốn')).toBeInTheDocument();
    expect(tbl().queryByText('Khách Vé Down')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'owed' } });
    await waitFor(() => expect(tbl().queryByText('Khách Chờ Vốn')).not.toBeInTheDocument());
    expect(tbl().getByText('Khách Vé Down')).toBeInTheDocument();
  });

  it('passes customerId to the payment modal (wallet payments)', async () => {
    const { calls } = mockApi(base({ 'GET /debts': costRows(), 'GET /payments': [], 'GET /wallets/:id': { balance: '0', entries: [] } }));
    renderPage(debtsConfig);
    await waitRows('Khách Đủ Vốn');
    await userEvent.click(within(tbl().getByText('Khách Chờ Vốn').closest('tr')).getByRole('button', { name: 'Thanh toán' }));
    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText('Hình thức'), { target: { value: 'wallet' } });
    await waitFor(() => expect(calls.some((c) => c.path === '/wallets/12')).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// v3.1: huỷ / hoàn, hoàn tác huỷ, đổi vé, thu tiền nhiều vé.
// ---------------------------------------------------------------------------
function lifeRows() {
  return [
    { id: 1, user_id: 1, customer_name: 'Khách Còn Hạn', customer_id: 11, ticket_code: 'AAA111', issue_date: '2026-11-05', due_date: addDays(today(), -3), ticket_amount: '2500000.00', cost_amount: '2200000.00', paid: '1000000.00', status: 'active' },
    { id: 2, user_id: 1, customer_name: 'Khách Hai Vé', customer_id: 11, ticket_code: 'AAA222', issue_date: '2026-11-06', due_date: null, ticket_amount: '1000000.00', cost_amount: '900000.00', paid: '0', status: 'active' },
    {
      id: 4, user_id: 1, customer_name: 'Khách Đã Huỷ', customer_id: 12, ticket_code: 'CXL444', issue_date: '2026-11-01', due_date: addDays(today(), -10),
      ticket_amount: '300000.00', original_amount: '2000000.00', cost_amount: '95000.00', paid: '0', status: 'cancelled', cancelled_at: '2026-11-20', cancel_note: 'Khách bận',
    },
    { id: 5, user_id: 1, customer_name: 'Khách Khác', customer_id: 13, ticket_code: 'BBB555', issue_date: '2026-11-07', due_date: null, ticket_amount: '800000.00', cost_amount: '700000.00', paid: '0', status: 'active' },
  ];
}
const rowOf = (name) => tbl().getByText(name).closest('tr');
const lifeFilter = () => screen.getByLabelText('Trạng thái');
const overdueCard = () => screen.getAllByText('Quá hạn').map((el) => el.closest('.card')).find((c) => c && !c.querySelector('table'));

describe('ServicePage (huỷ / hoàn / đổi vé / thu nhiều vé)', () => {
  it('hides cancelled rows by default; the status filter shows them with badge + struck original price; a cancellation fee still owed stays payable and overdue', async () => {
    mockApi(base({ 'GET /debts': lifeRows() }));
    renderPage(debtsConfig);
    await waitRows('Khách Còn Hạn');
    expect(lifeFilter()).toHaveValue('active');
    expect(tbl().queryByText('Khách Đã Huỷ')).not.toBeInTheDocument();
    // Quá hạn chỉ tính dòng 1 (còn nợ 1.500.000)
    expect(within(overdueCard()).getByText(/1\.500\.000/)).toBeInTheDocument();
    expect(within(overdueCard()).getByText('1 vé')).toBeInTheDocument();

    fireEvent.change(lifeFilter(), { target: { value: 'cancelled' } });
    await waitFor(() => expect(tbl().queryByText('Khách Còn Hạn')).not.toBeInTheDocument());
    const row = rowOf('Khách Đã Huỷ');
    expect(within(row).getByText('Đã huỷ')).toBeInTheDocument();
    expect(row).toHaveClass('opacity-60');
    // Khách còn nợ phí huỷ 300k, hạn đã qua → vẫn quá hạn và vẫn thu được
    expect(within(row).getByText('Quá hạn')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Thanh toán' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Sửa' })).toBeInTheDocument();
    const struck = within(row).getByTitle('Giá bán gốc trước khi huỷ');
    expect(struck.tagName).toBe('S');
    expect(struck).toHaveTextContent(/2\.000\.000/);
    expect(within(overdueCard()).getByText('1 vé')).toBeInTheDocument();
    expect(within(overdueCard()).getByText(/300.000/)).toBeInTheDocument();

    fireEvent.change(lifeFilter(), { target: { value: 'all' } });
    await waitFor(() => expect(tbl().getByText('Khách Còn Hạn')).toBeInTheDocument());
    expect(tbl().getByText('Khách Đã Huỷ')).toBeInTheDocument();
  });

  it('"Huỷ / hoàn" opens the cancel modal and posts to the module endpoint, then reloads', async () => {
    let loads = 0;
    const { calls } = mockApi(base({
      'GET /debts': () => { loads += 1; return lifeRows(); },
      'POST /debts/:id/cancel': { ok: true },
    }));
    renderPage(debtsConfig);
    await waitRows('Khách Còn Hạn');
    const row = rowOf('Khách Hai Vé');
    await userEvent.click(within(row).getByRole('button', { name: 'Thao tác khác' }));
    expect(within(row).queryByRole('button', { name: /Hoàn tác huỷ/ })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /Huỷ \/ hoàn/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Huỷ / hoàn vé')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Xác nhận huỷ/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/debts/2/cancel')).toBe(true));
    expect(calls.find((c) => c.path === '/debts/2/cancel').body).toMatchObject({ finalAmount: 0, customerRefund: { amount: 0 } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(loads).toBeGreaterThan(1);
  });

  it('"Hoàn tác huỷ" asks for confirmation then calls uncancel', async () => {
    const { calls } = mockApi(base({ 'GET /debts': () => lifeRows(), 'POST /debts/:id/uncancel': { ok: true } }));
    renderPage(debtsConfig);
    await waitRows('Khách Còn Hạn');
    fireEvent.change(lifeFilter(), { target: { value: 'cancelled' } });
    const row = await waitFor(() => rowOf('Khách Đã Huỷ'));
    await userEvent.click(within(row).getByRole('button', { name: 'Thao tác khác' }));
    expect(within(row).queryByRole('button', { name: /Huỷ \/ hoàn/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Đổi vé/ })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /Hoàn tác huỷ/ }));
    const dlg = await screen.findByRole('alertdialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Hoàn tác huỷ' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/debts/4/uncancel')).toBe(true));
    expect(await screen.findByText('Đã hoàn tác huỷ')).toBeInTheDocument();
  });

  it('"Đổi vé" exists only for air tickets and posts /debts/:id/change', async () => {
    const { calls } = mockApi(base({ 'GET /debts': () => lifeRows(), 'POST /debts/:id/change': { ok: true } }));
    const r = renderPage(debtsConfig);
    await waitRows('Khách Còn Hạn');
    const row = rowOf('Khách Khác');
    await userEvent.click(within(row).getByRole('button', { name: 'Thao tác khác' }));
    await userEvent.click(within(row).getByRole('button', { name: /Đổi vé/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Mã vé mới')).toHaveValue('BBB555');
    await userEvent.type(within(dialog).getByLabelText('Phí đổi thu khách'), '100000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu đổi vé/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/debts/5/change')).toBe(true));
    r.unmount();

    mockApi(base({ 'GET /train-tickets': [{ id: 1, user_id: 1, customer_name: 'Tàu A', train_no: 'SE7', issue_date: '2026-11-01', ticket_amount: '900000', cost_amount: '800000', paid: '0' }] }));
    renderPage(trainsConfig);
    await waitRows('Tàu A');
    const trow = rowOf('Tàu A');
    await userEvent.click(within(trow).getByRole('button', { name: 'Thao tác khác' }));
    expect(within(trow).getByRole('button', { name: /Huỷ \/ hoàn/ })).toBeInTheDocument();
    expect(within(trow).queryByRole('button', { name: /Đổi vé/ })).not.toBeInTheDocument();
  });

  it('"Thu tiền các vé đã chọn" is enabled only when all selected rows share one customer', async () => {
    mockApi(base({ 'GET /debts': lifeRows() }));
    renderPage(debtsConfig);
    await waitRows('Khách Còn Hạn');
    await userEvent.click(within(rowOf('Khách Còn Hạn')).getByLabelText('Chọn dòng'));
    await userEvent.click(within(rowOf('Khách Khác')).getByLabelText('Chọn dòng'));
    const btn = screen.getByRole('button', { name: /Thu tiền các vé đã chọn/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Chỉ thu chung được cho cùng 1 khách');

    await userEvent.click(within(rowOf('Khách Khác')).getByLabelText('Chọn dòng'));
    await userEvent.click(within(rowOf('Khách Hai Vé')).getByLabelText('Chọn dòng'));
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    const modal = await screen.findByTestId('receipt-modal');
    expect(JSON.parse(modal.textContent.replace('Đóng phiếu thu', ''))).toEqual({
      customerId: 11,
      preselect: [{ type: 'debt', id: 1 }, { type: 'debt', id: 2 }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Đóng phiếu thu' }));
    expect(screen.queryByTestId('receipt-modal')).not.toBeInTheDocument();
  });

  it('rows without a customer cannot be collected together', async () => {
    const rows = lifeRows().map((r) => (r.id === 1 || r.id === 2 ? { ...r, customer_id: null } : r));
    mockApi(base({ 'GET /debts': rows }));
    renderPage(debtsConfig);
    await waitRows('Khách Còn Hạn');
    await userEvent.click(within(rowOf('Khách Còn Hạn')).getByLabelText('Chọn dòng'));
    await userEvent.click(within(rowOf('Khách Hai Vé')).getByLabelText('Chọn dòng'));
    expect(screen.getByRole('button', { name: /Thu tiền các vé đã chọn/ })).toBeDisabled();
  });

  it('tours keep their own progress filter (no lifecycle filter, cancelled tours visible; fee settled → no pay button, not overdue)', async () => {
    mockApi(base({
      'GET /tours': [
        { id: 1, user_id: 1, customer_name: 'Tour Huỷ', tour_name: 'Phú Quốc', status: 'cancelled', original_amount: '9800000', issue_date: '2026-11-01', due_date: addDays(today(), -5), sell_amount: '500000', cost_amount: '0', paid: '500000' },
      ],
    }));
    renderPage(toursConfig);
    await waitRows('Tour Huỷ');
    expect(screen.queryByLabelText('Trạng thái')).not.toBeInTheDocument();
    const row = rowOf('Tour Huỷ');
    expect(within(row).getByText('Đã huỷ')).toBeInTheDocument();
    expect(within(row).queryByText('Quá hạn')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Thanh toán' })).not.toBeInTheDocument();
  });

  it('Excel export adds "Trạng thái" and "Giá bán gốc"', () => {
    const [active, , cancelled] = lifeRows();
    const cols = debtsConfig.exportColumns({ companyById: () => null });
    const status = cols.find((c) => c.label === 'Trạng thái');
    const orig = cols.find((c) => c.label === 'Giá bán gốc');
    expect(status.value(active)).toBe('Đang hiệu lực');
    expect(status.value(cancelled)).toBe('Đã huỷ');
    expect(orig.value(cancelled)).toBe(2000000);
    expect(orig.value(active)).toBe(2500000);
    expect(orig.money).toBe(true);
    const tourCols = toursConfig.exportColumns({ companyById: () => null });
    expect(tourCols.filter((c) => c.label === 'Trạng thái')).toHaveLength(1);
    expect(tourCols.some((c) => c.label === 'Tiến độ')).toBe(true);
  });
});
