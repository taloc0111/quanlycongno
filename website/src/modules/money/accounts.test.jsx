import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsApp from '../../AccountsApp';
import { mockApi } from '../../test/mockApi';
import { ME, renderWithApp, setupSession } from './testUtils';

const ACCOUNTS = [
  { id: 1, user_id: 1, name: 'TCB chính', bank: 'TCB', account_number: '19031234567890', holder_name: 'NGUYEN VAN A', is_own: true, opening_balance: '0', archived: false, total_in: '7000000.00', total_out: '2000000.00', balance: '5000000.00', unreconciled_count: 3 },
  { id: 2, user_id: 1, name: 'TK chị Lan', bank: 'VIB', is_own: false, opening_balance: '0', archived: false, total_in: '1200000', total_out: '0', balance: '1200000.00', unreconciled_count: 1 },
  { id: 3, user_id: 1, name: 'ACB cũ', bank: 'ACB', is_own: true, opening_balance: '0', archived: true, total_in: '0', total_out: '0', balance: '0', unreconciled_count: 0 },
];

beforeEach(setupSession);

describe('AccountsApp — danh sách', () => {
  it('renders balances, totals and hides archived accounts by default', async () => {
    mockApi({ 'GET /accounts': ACCOUNTS, 'GET /auth/profile': ME });
    renderWithApp(<AccountsApp />);
    expect(await screen.findByText('TCB chính')).toBeInTheDocument();
    expect(screen.getByText('TK chị Lan')).toBeInTheDocument();
    expect(screen.queryByText('ACB cũ')).not.toBeInTheDocument();
    // Số dư thẻ + thẻ tổng (TK của mình = 5tr, TK người khác = 1,2tr)
    expect(screen.getAllByText(/5\.000\.000/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/1\.200\.000/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('4 giao dịch')).toBeInTheDocument(); // chưa đối soát = 3 + 1 + 0
    expect(screen.getByText('Giữ hộ')).toBeInTheDocument();
    expect(screen.getByText('•••• 7890', { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText('ACB cũ')).toBeInTheDocument();
  });

  it('creates an account with the right body', async () => {
    const { calls } = mockApi({
      'GET /accounts': () => ACCOUNTS,
      'POST /accounts': ({ body }) => ({ id: 9, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp />);
    await screen.findByText('TCB chính');
    await userEvent.click(screen.getByRole('button', { name: /Thêm tài khoản/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Tên tài khoản/), 'TK anh Hùng');
    await userEvent.type(within(dialog).getByLabelText(/Ngân hàng/), 'MB');
    await userEvent.type(within(dialog).getByLabelText(/Số tài khoản/), '0123456789');
    await userEvent.click(within(dialog).getByRole('switch')); // → TK người khác giữ hộ
    expect(within(dialog).getByText('TK người khác giữ hộ')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Số dư đầu/), '-250000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Thêm tài khoản/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/accounts')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/accounts');
    expect(post.body).toEqual({
      name: 'TK anh Hùng', bank: 'MB', accountNumber: '0123456789', holderName: '', isOwn: false, openingBalance: -250000, notes: '',
    });
    expect(await screen.findByText('Đã thêm tài khoản')).toBeInTheDocument();
  });

  it('offers to archive when delete is refused (400)', async () => {
    const { calls } = mockApi({
      'GET /accounts': () => ACCOUNTS,
      'DELETE /accounts/:id': { status: 400, body: { error: 'Tài khoản đã có giao dịch, hãy lưu trữ thay vì xoá' } },
      'PUT /accounts/:id': ({ body }) => ({ id: 1, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp />);
    await screen.findByText('TCB chính');
    const card = screen.getByTestId('account-1');
    await userEvent.click(within(card).getByRole('button', { name: 'Xoá' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá' }));
    const second = await screen.findByText(/hãy lưu trữ thay vì xoá/);
    expect(second).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Lưu trữ' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/accounts/1')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/accounts/1').body).toEqual({ archived: true });
  });
});

const LEDGER = {
  account: { id: 7, user_id: 1, name: 'TCB chính', bank: 'TCB', account_number: '1903000011112222', is_own: true },
  opening: '1000000.00',
  rows: [
    { kind: 'payment', id: 1, date: '2026-11-01', direction: 'in', amount: '500000.00', description: 'Khách Nguyễn A · Vé VN123 HAN-SGN', reconciled: false, ref: { type: 'debt', id: 4 } },
    { kind: 'supplier_payment', id: 1, date: '2026-11-02', direction: 'out', amount: '200000.00', description: 'Trả F1 Thùy Dương · Giá vé F1', supplier_name: 'F1 Thùy Dương', reconciled: true, ref: { type: 'supplier', id: 3 } },
    { kind: 'topup', id: 2, date: '2026-11-03', direction: 'in', amount: '100000.00', description: 'Nạp ví · Đại lý Minh', reconciled: false, ref: { type: 'wallet', id: 8 } },
  ],
  total_in: '600000.00',
  total_out: '200000.00',
  closing: '1400000.00',
};

describe('AccountsApp — sổ chi tiết', () => {
  const table = () => within(screen.getByRole('table'));

  it('computes the running balance from the opening balance', async () => {
    mockApi({ 'GET /accounts/:id/ledger': LEDGER, 'GET /auth/profile': ME });
    renderWithApp(<AccountsApp param="7" />);
    await screen.findAllByText('Khách Nguyễn A · Vé VN123 HAN-SGN');
    const running = table().getAllByTestId('running').map((el) => el.textContent.replace(/\D/g, ''));
    expect(running).toEqual(['1500000', '1300000', '1400000']);
    // Đầu kỳ + cuối kỳ
    expect(screen.getAllByText(/1\.000\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1\.400\.000/).length).toBeGreaterThan(0);
    // Lọc "Tiền ra" chỉ còn dòng trả NCC
    await userEvent.click(screen.getByRole('button', { name: /Tiền ra \(1\)/ }));
    await waitFor(() => expect(table().queryByText('Khách Nguyễn A · Vé VN123 HAN-SGN')).not.toBeInTheDocument());
    expect(table().getByText('Trả F1 Thùy Dương · Giá vé F1')).toBeInTheDocument();
  });

  it('toggles reconcile with the right kind and rolls back on error', async () => {
    const { calls } = mockApi({
      'GET /accounts/:id/ledger': LEDGER,
      'PUT /accounts/reconcile': ({ body }) => (body.kind === 'wallet' ? { status: 500, body: { error: 'Lỗi ghi đối soát' } } : { ok: true }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp param="7" />);
    await screen.findAllByText('Khách Nguyễn A · Vé VN123 HAN-SGN');
    const boxes = () => table().getAllByLabelText('Đã đối soát');
    expect(boxes().map((b) => b.checked)).toEqual([false, true, false]);

    await userEvent.click(boxes()[0]);
    await userEvent.click(boxes()[1]);
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').length).toBe(2));
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.body);
    expect(puts).toEqual([
      { kind: 'payment', id: 1, reconciled: true },
      { kind: 'supplier_payment', id: 1, reconciled: false },
    ]);
    expect(boxes().map((b) => b.checked)).toEqual([true, false, false]);

    // Nạp ví → kind 'wallet'; server lỗi → trả lại trạng thái cũ + toast
    await userEvent.click(boxes()[2]);
    expect(await screen.findByText('Lỗi ghi đối soát')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PUT').at(-1).body).toEqual({ kind: 'wallet', id: 2, reconciled: true });
    await waitFor(() => expect(boxes()[2].checked).toBe(false));
  });
});
