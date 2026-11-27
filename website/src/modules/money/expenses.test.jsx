import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpensesApp from '../../ExpensesApp';
import { mockApi } from '../../test/mockApi';
import { formatMonth, today } from '../../utils/format';
import { ME, renderWithApp, setupSession } from './testUtils';
import { monthRange } from './moneyUtils';

const T = today();
const LAST = monthRange(-1).from;
const ENTRIES = [
  { id: 1, user_id: 1, account_id: 5, direction: 'out', amount: '22000', entry_date: T, category: 'Phí ngân hàng', notes: 'SMS', reconciled: false },
  { id: 2, user_id: 1, account_id: 5, direction: 'out', amount: '5000000', entry_date: T, category: 'Lương', notes: 'Lương NV', reconciled: true },
  { id: 3, user_id: 1, account_id: 6, direction: 'in', amount: '15000', entry_date: T, category: 'Lãi ngân hàng', notes: '', reconciled: false },
  { id: 4, user_id: 1, account_id: 5, direction: 'out', amount: '2000000', entry_date: T, category: 'Rút tiền riêng', notes: '', reconciled: false },
  { id: 5, user_id: 1, account_id: 6, direction: 'in', amount: '10000000', entry_date: T, category: 'Góp vốn', notes: '', reconciled: false },
  { id: 6, user_id: 1, account_id: 5, direction: 'out', amount: '300000', entry_date: LAST, category: 'Văn phòng', notes: 'Tháng trước', reconciled: false },
];
const ACCOUNTS = [
  { id: 5, user_id: 1, name: 'TCB chính', is_own: true, archived: false },
  { id: 6, user_id: 1, name: 'VIB', is_own: true, archived: false },
];

beforeEach(setupSession);

describe('ExpensesApp — Thu chi khác', () => {
  const table = () => within(screen.getByRole('table'));
  const rowsShown = () => table().getAllByRole('row').length - 2; // bỏ header + footer

  it('shows month stats (owner categories apart) and filters by month, direction, category, account', async () => {
    mockApi({ 'GET /accounts/entries': ENTRIES, 'GET /accounts': ACCOUNTS, 'GET /auth/profile': ME });
    renderWithApp(<ExpensesApp />);
    await waitFor(() => expect(table().getByText('SMS')).toBeInTheDocument());
    // Thẻ: chi = 22.000 + 5.000.000 (không gồm rút tiền riêng); thu khác = 15.000; chủ = góp 10tr − rút 2tr
    expect(screen.getAllByText(/^5\.022\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^15\.000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^8\.000\.000/).length).toBeGreaterThan(0);

    // Mặc định tháng này: 5 dòng, không có dòng tháng trước
    expect(rowsShown()).toBe(5);
    expect(table().queryByText('Tháng trước')).not.toBeInTheDocument();
    expect(table().getAllByText('Của chủ')).toHaveLength(2);
    expect(table().getAllByText('TCB chính').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Lọc chiều'), { target: { value: 'in' } });
    await waitFor(() => expect(rowsShown()).toBe(2));
    expect(within(screen.getByLabelText('Lọc danh mục')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Mọi danh mục', 'Góp vốn', 'Lãi ngân hàng', 'Thu khác']);
    fireEvent.change(screen.getByLabelText('Lọc danh mục'), { target: { value: 'Lãi ngân hàng' } });
    await waitFor(() => expect(rowsShown()).toBe(1));

    fireEvent.change(screen.getByLabelText('Lọc chiều'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Lọc danh mục'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Lọc tài khoản'), { target: { value: '6' } });
    await waitFor(() => expect(rowsShown()).toBe(2));

    fireEvent.change(screen.getByLabelText('Lọc tài khoản'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Lọc tháng'), { target: { value: LAST.slice(0, 7) } });
    await waitFor(() => expect(rowsShown()).toBe(1));
    expect(table().getByText('Tháng trước')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Lọc tháng')).getByRole('option', { name: formatMonth(LAST.slice(0, 7)) })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Lọc tháng'), { target: { value: 'all' } });
    await waitFor(() => expect(rowsShown()).toBe(6));
  });

  it('edits, reconciles and deletes an entry', async () => {
    const { calls } = mockApi({
      'GET /accounts/entries': () => ENTRIES,
      'PUT /accounts/reconcile': { ok: true },
      'PUT /accounts/entries/:id': ({ body }) => ({ id: 1, ...body }),
      'DELETE /accounts/entries/:id': { ok: true },
      'GET /accounts': ACCOUNTS,
      'GET /auth/profile': ME,
    });
    renderWithApp(<ExpensesApp />);
    await waitFor(() => expect(table().getByText('SMS')).toBeInTheDocument());
    const firstRow = () => within(table().getByText('SMS').closest('tr'));

    await userEvent.click(firstRow().getByLabelText('Đã đối soát'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/accounts/reconcile')).toBe(true));
    expect(calls.find((c) => c.path === '/accounts/reconcile').body).toEqual({ kind: 'entry', id: 1, reconciled: true });

    await userEvent.click(firstRow().getByRole('button', { name: 'Sửa' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(/Danh mục/)).toHaveValue('Phí ngân hàng');
    expect(dialog.getByLabelText(/Số tiền/)).toHaveValue('22.000');
    await waitFor(() => expect(dialog.getByLabelText(/Tài khoản/)).toHaveValue('5'));
    await userEvent.clear(dialog.getByLabelText(/Số tiền/));
    await userEvent.type(dialog.getByLabelText(/Số tiền/), '33000');
    await userEvent.click(dialog.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/accounts/entries/1')).toBe(true));
    expect(calls.find((c) => c.path === '/accounts/entries/1').body).toMatchObject({ accountId: 5, direction: 'out', amount: 33000, category: 'Phí ngân hàng', notes: 'SMS' });

    await userEvent.click(firstRow().getByRole('button', { name: 'Xoá' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/accounts/entries/1')).toBe(true));
  });
});
