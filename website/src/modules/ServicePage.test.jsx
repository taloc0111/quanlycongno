import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth/AuthContext';
import { NavigationProvider } from '../hooks/useNavigation.jsx';
import { FeedbackProvider } from '../ui/FeedbackContext';
import ServicePage from './ServicePage';
import { debtsConfig, trainsConfig, toursConfig, passportsConfig } from './serviceConfigs';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { today, addDays } from '../utils/format';

const ME = { id: 1, username: 'admin', role: 'admin', features: {} };
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
});

describe('ServicePage (debts)', () => {
  it('renders rows, stats and read-only guard', async () => {
    mockApi({
      'GET /debts': debtRows(),
      'GET /companies': [{ id: 5, name: 'Công ty X' }],
      'GET /customers': [],
      'GET /routes': ['HAN-SGN'],
      'GET /auth/profile': ME,
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
    mockApi({ 'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME });
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
      'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME,
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
      'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME,
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
      'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME,
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
      'GET /debts': debtRows(), 'GET /companies': [], 'GET /customers': [], 'GET /routes': [], 'GET /auth/profile': ME,
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
      'GET /companies': [], 'GET /customers': [], 'GET /auth/profile': ME,
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
