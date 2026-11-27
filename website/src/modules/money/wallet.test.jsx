import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WalletPanel from './WalletPanel';
import WalletsApp from '../../WalletsApp';
import { mockApi } from '../../test/mockApi';
import { today } from '../../utils/format';
import { ME, renderWithApp, setupSession } from './testUtils';

const WALLET = {
  customer: { id: 4, user_id: 1, name: 'Đại lý Minh', phone: '0903' },
  balance: '300000.00',
  entries: [
    { id: 1, kind: 'topup', amount: '1000000', entry_date: '2026-11-01', account_id: 5, account_name: 'TCB chính', notes: '' },
    { id: 2, kind: 'charge', amount: '-700000', entry_date: '2026-11-05', target_label: 'VN123 HAN-SGN', notes: '' },
  ],
};
const ACCOUNTS = [{ id: 5, user_id: 1, name: 'TCB chính', is_own: true, archived: false }];

beforeEach(setupSession);

describe('WalletPanel', () => {
  it('shows the balance and entries; charge entries cannot be deleted', async () => {
    mockApi({ 'GET /wallets/:id': WALLET, 'GET /auth/profile': ME });
    renderWithApp(<WalletPanel customerId={4} />);
    expect(await screen.findByTestId('wallet-balance')).toHaveTextContent(/300\.000/);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Trừ vé')).toBeInTheDocument();
    expect(table.getByText('VN123 HAN-SGN')).toBeInTheDocument();
    expect(table.getAllByRole('button', { name: 'Xoá giao dịch' })).toHaveLength(1); // chỉ dòng nạp
  });

  it('tops up the wallet with the right body', async () => {
    const { calls } = mockApi({
      'GET /wallets/:id': () => WALLET,
      'GET /accounts': ACCOUNTS,
      'POST /wallets/:id/topup': ({ body }) => ({ id: 3, kind: 'topup', ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<WalletPanel customerId={4} />);
    await screen.findByTestId('wallet-balance');
    await userEvent.click(screen.getByRole('button', { name: /Nạp tiền/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Số tiền/), '2000000');
    await within(dialog).findByRole('option', { name: /TCB chính/ });
    fireEvent.change(within(dialog).getByLabelText(/Vào tài khoản/), { target: { value: '5' } });
    await userEvent.click(within(dialog).getByRole('button', { name: /Nạp tiền/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/wallets/4/topup')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ amount: 2000000, entryDate: today(), accountId: 5, notes: '' });
    expect(await screen.findByText(/Đã nạp 2\.000\.000/)).toBeInTheDocument();
  });

  it('shows the server error toast when refunding more than the balance', async () => {
    const { calls } = mockApi({
      'GET /wallets/:id': () => WALLET,
      'GET /accounts': ACCOUNTS,
      'POST /wallets/:id/refund': { status: 400, body: { error: 'Ví khách chỉ còn 300.000đ' } },
      'GET /auth/profile': ME,
    });
    renderWithApp(<WalletPanel customerId={4} />);
    await screen.findByTestId('wallet-balance');
    await userEvent.click(screen.getByRole('button', { name: /Hoàn tiền/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Số tiền/), '500000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Hoàn tiền/ }));
    expect(await screen.findByText('Ví khách chỉ còn 300.000đ')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ amount: 500000 });
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // lỗi → modal vẫn mở
  });

  it('is read-only for a customer of another agency', async () => {
    mockApi({ 'GET /wallets/:id': { ...WALLET, customer: { ...WALLET.customer, user_id: 2 } }, 'GET /auth/profile': ME });
    renderWithApp(<WalletPanel customerId={4} />);
    await screen.findByTestId('wallet-balance');
    expect(screen.queryByRole('button', { name: /Nạp tiền/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá giao dịch' })).not.toBeInTheDocument();
  });
});

describe('WalletsApp', () => {
  it('lists wallets and tops up a new customer picked from the list', async () => {
    const { calls } = mockApi({
      'GET /wallets': [{ customer_id: 4, customer_name: 'Đại lý Minh', phone: '0903', balance: '300000', last_entry_date: '2026-11-05', entries_count: 2 }],
      'GET /customers': [{ id: 4, user_id: 1, name: 'Đại lý Minh' }, { id: 8, user_id: 1, name: 'Khách Lan', phone: '0911' }, { id: 9, user_id: 2, name: 'Khách đại lý khác' }],
      'GET /accounts': ACCOUNTS,
      'POST /wallets/:id/topup': ({ body }) => ({ id: 10, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<WalletsApp />);
    expect(await within(await screen.findByRole('table')).findByText('Đại lý Minh')).toBeInTheDocument();
    expect(screen.getByText('Ví âm/sắp hết').nextSibling).toHaveTextContent('1'); // 1 ví dưới 500k

    await userEvent.click(screen.getByRole('button', { name: /Nạp ví cho khách mới/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: /Khách Lan/ });
    expect(within(dialog).queryByRole('option', { name: /đại lý khác/ })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Khách hàng/), { target: { value: '8' } });
    await userEvent.type(within(dialog).getByLabelText(/Số tiền/), '1000000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Nạp tiền/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/wallets/8/topup')).toBe(true));
  });
});
