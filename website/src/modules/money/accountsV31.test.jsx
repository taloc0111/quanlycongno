import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsApp from '../../AccountsApp';
import { mockApi } from '../../test/mockApi';
import { today } from '../../utils/format';
import { ME, renderWithApp, setupSession } from './testUtils';

const ACCOUNTS = [
  { id: 1, user_id: 1, name: 'TCB chính', bank: 'TCB', is_own: true, archived: false, total_in: '0', total_out: '0', balance: '5000000.00', unreconciled_count: 0 },
  { id: 2, user_id: 1, name: 'TK chị Lan', bank: 'VIB', is_own: false, archived: false, total_in: '1200000', total_out: '0', balance: '1200000.00', unreconciled_count: 1 },
];

beforeEach(setupSession);

describe('Chuyển tiền & thu chi khác', () => {
  it('"Rút về TK chính" prefills the transfer and posts the right body', async () => {
    const { calls } = mockApi({
      'GET /accounts': () => ACCOUNTS,
      'POST /accounts/transfers': ({ body }) => ({ id: 30, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp />);
    await screen.findByText('TK chị Lan');
    // Chỉ TK giữ hộ mới có nút rút về
    expect(within(screen.getByTestId('account-1')).queryByRole('button', { name: /Rút về TK chính/ })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId('account-2')).getByRole('button', { name: /Rút về TK chính/ }));

    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findAllByRole('option', { name: /TCB chính/ });
    await waitFor(() => expect(dialog.getByLabelText(/Từ tài khoản/)).toHaveValue('2'));
    expect(dialog.getByLabelText(/Sang tài khoản/)).toHaveValue('1');
    expect(dialog.getByLabelText(/Số tiền/)).toHaveValue('1.200.000');
    await userEvent.type(dialog.getByLabelText(/Phí chuyển/), '11000');
    expect(dialog.getByText(/TK nguồn bị trừ 1\.211\.000/)).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText(/Ghi chú/), 'Chị Lan trả');
    await userEvent.click(dialog.getByRole('button', { name: /Ghi chuyển tiền/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/accounts/transfers')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({
      fromAccountId: 2, toAccountId: 1, amount: 1200000, fee: 11000, transferDate: today(), notes: 'Chị Lan trả',
    });
    expect(await screen.findByText(/Đã chuyển 1\.200\.000/)).toBeInTheDocument();
  });

  it('refuses a transfer to the same account', async () => {
    const { calls } = mockApi({ 'GET /accounts': () => ACCOUNTS, 'GET /auth/profile': ME });
    renderWithApp(<AccountsApp />);
    await screen.findByText('TK chị Lan');
    await userEvent.click(screen.getByRole('button', { name: /^Chuyển tiền$/ }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findAllByRole('option', { name: /TCB chính/ });
    await userEvent.click(dialog.getByRole('button', { name: /Ghi chuyển tiền/ }));
    expect(await screen.findByText('Chọn tài khoản chuyển và tài khoản nhận')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('EntryModal shows categories by direction and posts an entry', async () => {
    const { calls } = mockApi({
      'GET /accounts': () => ACCOUNTS,
      'POST /accounts/entries': ({ body }) => ({ id: 40, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp />);
    await screen.findByText('TK chị Lan');
    await userEvent.click(screen.getByRole('button', { name: /Thu\/chi khác/ }));
    const dialog = within(await screen.findByRole('dialog'));
    const optionNames = () => within(dialog.getByLabelText(/Danh mục/)).getAllByRole('option').map((o) => o.textContent);

    expect(optionNames()).toEqual(['Phí ngân hàng', 'Văn phòng', 'Lương', 'Quảng cáo', 'Điện nước', 'Rút tiền riêng', 'Khác']);
    await userEvent.selectOptions(dialog.getByLabelText(/Danh mục/), 'Rút tiền riêng');
    expect(dialog.getByText(/không tính vào lãi\/lỗ/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Thu' }));
    expect(optionNames()).toEqual(['Góp vốn', 'Lãi ngân hàng', 'Thu khác']);
    expect(dialog.getByLabelText(/Danh mục/)).toHaveValue('Góp vốn');
    await userEvent.selectOptions(dialog.getByLabelText(/Danh mục/), 'Lãi ngân hàng');
    expect(dialog.queryByText(/không tính vào lãi\/lỗ/)).not.toBeInTheDocument();

    await dialog.findByRole('option', { name: /TCB chính/ });
    await userEvent.selectOptions(dialog.getByLabelText(/Tài khoản/), '1');
    await userEvent.type(dialog.getByLabelText(/Số tiền/), '35000');
    await userEvent.click(dialog.getByRole('button', { name: /Ghi lại/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/accounts/entries')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({
      accountId: 1, direction: 'in', amount: 35000, entryDate: today(), category: 'Lãi ngân hàng', notes: '',
    });
  });
});

const LEDGER = {
  account: { id: 7, user_id: 1, name: 'TCB chính', bank: 'TCB', is_own: true },
  opening: '0',
  rows: [
    { kind: 'receipt', id: 11, date: '2026-11-01', direction: 'in', amount: '1700000', description: 'Phiếu thu · Nguyễn A', reconciled: false, ref: { type: 'receipt', id: 11 } },
    { kind: 'customer_refund', id: 12, date: '2026-11-02', direction: 'out', amount: '300000', description: 'Hoàn khách Nguyễn A', reconciled: false, ref: { type: 'debt', id: 1 } },
    { kind: 'supplier_refund', id: 13, date: '2026-11-03', direction: 'in', amount: '400000', description: 'F1 hoàn', reconciled: false, ref: { type: 'supplier', id: 3 } },
    { kind: 'transfer_in', id: 14, date: '2026-11-04', direction: 'in', amount: '1000000', description: 'Từ TK chị Lan', reconciled: false, ref: null },
    { kind: 'transfer_out', id: 15, date: '2026-11-05', direction: 'out', amount: '511000', description: 'Sang tiền mặt (phí 11.000)', reconciled: false, ref: null },
    { kind: 'entry_in', id: 16, date: '2026-11-06', direction: 'in', amount: '5000', description: 'Lãi ngân hàng', reconciled: false, ref: null },
    { kind: 'entry_out', id: 17, date: '2026-11-07', direction: 'out', amount: '22000', description: 'Phí ngân hàng · SMS', reconciled: false, ref: null },
  ],
  total_in: '3105000', total_out: '833000', closing: '2272000',
};

describe('Sổ tài khoản — kind v3.1', () => {
  const table = () => within(screen.getByRole('table'));

  it('labels the new kinds and reconciles them with the contract kinds', async () => {
    const { calls } = mockApi({
      'GET /accounts/:id/ledger': LEDGER,
      'PUT /accounts/reconcile': { ok: true },
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp param="7" />);
    await screen.findAllByText('Phiếu thu · Nguyễn A');
    for (const label of ['Phiếu thu', 'Hoàn khách', 'NCC hoàn', 'Chuyển đến', 'Chuyển đi', 'Thu khác', 'Chi khác']) {
      expect(table().getByText(label)).toBeInTheDocument();
    }
    const boxes = table().getAllByLabelText('Đã đối soát');
    for (const b of boxes) await userEvent.click(b);
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').length).toBe(7));
    expect(calls.filter((c) => c.method === 'PUT').map((c) => `${c.body.kind}:${c.body.id}`)).toEqual([
      'receipt:11', 'payment:12', 'supplier_payment:13', 'transfer_in:14', 'transfer_out:15', 'entry:16', 'entry:17',
    ]);
  });

  it('deletes transfers / entries / receipts through their endpoints', async () => {
    const { calls } = mockApi({
      'GET /accounts/:id/ledger': LEDGER,
      'DELETE /accounts/transfers/:id': { ok: true },
      'DELETE /accounts/entries/:id': { ok: true },
      'DELETE /receipts/:id': { ok: true },
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp param="7" />);
    await screen.findAllByText('Phiếu thu · Nguyễn A');
    const deletes = () => table().getAllByRole('button', { name: 'Xoá' });
    expect(deletes()).toHaveLength(5); // receipt, transfer_in, transfer_out, entry_in, entry_out

    const removeAt = async (i) => {
      await userEvent.click(deletes()[i]);
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    };
    await removeAt(0);
    await removeAt(2);
    await removeAt(4);
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').length).toBe(3));
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
      '/receipts/11', '/accounts/transfers/15', '/accounts/entries/17',
    ]);
  });

  it('opens transfer / entry modals from the ledger prefilled with this account', async () => {
    mockApi({
      'GET /accounts/:id/ledger': LEDGER,
      'GET /accounts': [{ id: 7, user_id: 1, name: 'TCB chính', is_own: true, archived: false, balance: '0' }, { id: 8, user_id: 1, name: 'Tiền mặt', is_own: true, archived: false }],
      'GET /auth/profile': ME,
    });
    renderWithApp(<AccountsApp param="7" />);
    await screen.findAllByText('Phiếu thu · Nguyễn A');
    await userEvent.click(screen.getByRole('button', { name: /^Chuyển tiền$/ }));
    let dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByLabelText(/Từ tài khoản/)).toHaveValue('7'));
    await userEvent.click(dialog.getByRole('button', { name: 'Huỷ' }));

    await userEvent.click(screen.getByRole('button', { name: /Thu\/chi khác/ }));
    dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByLabelText(/Tài khoản/)).toHaveValue('7'));
  });
});
