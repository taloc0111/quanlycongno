import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerDetail from '../CustomerDetail';
import { mockApi } from '../../test/mockApi';
import { ME, renderWithApp, setupSession } from './testUtils';

const DETAIL = {
  customer: { id: 9, user_id: 1, name: 'Nguyễn A', type: 'individual', credit_limit: '0' },
  debts: [
    { id: 1, issue_date: '2026-11-01', ticket_code: 'VN123', route: 'HAN-SGN', ticket_amount: '1000000', paid: '0', status: 'active' },
    { id: 2, issue_date: '2026-11-02', ticket_code: 'VJ9', route: 'SGN-DAD', ticket_amount: '200000', paid: '200000', status: 'cancelled', original_amount: '1500000' },
  ],
  passports: [], trainTickets: [], tours: [],
  payments: [{ id: 70, type: 'debt', payment_date: '2026-11-02', amount: '200000', target_label: 'VJ9', method: 'bank_transfer' }],
  totals: { sold: 1200000, cost: 0, paid: 200000, outstanding: 1000000 },
};
const RECEIPTS = [
  {
    id: 50, user_id: 1, receipt_date: '2026-11-03', amount: '1500000', account_name: 'TCB chính', method: 'bank_transfer',
    allocations: [{ type: 'debt', id: 1, label: 'VN123 HAN-SGN', amount: '1000000' }], wallet_amount: '500000',
  },
];

const routes = (extra = {}) => ({
  'GET /customers/:id/detail': DETAIL,
  'GET /companies': [],
  'GET /receipts': RECEIPTS,
  'GET /wallets/:id': { customer: { id: 9 }, balance: '500000', entries: [] },
  'GET /customers/:id/outstanding': [{ type: 'debt', id: 1, label: 'VN123 HAN-SGN', issue_date: '2026-11-01', total: '1000000', paid: '0', remaining: '1000000' }],
  'GET /accounts': [],
  'GET /auth/profile': ME,
  ...extra,
});

beforeEach(setupSession);

describe('CustomerDetail — v3.1', () => {
  it('marks cancelled services and lists receipts in the payments tab', async () => {
    const { calls } = mockApi(routes({ 'DELETE /receipts/:id': { ok: true } }));
    renderWithApp(<CustomerDetail id="9" />);
    const table = within(await screen.findByRole('table'));
    const cancelledRow = within(table.getByText('VJ9 · SGN-DAD').closest('tr'));
    expect(cancelledRow.getByText('Đã huỷ')).toBeInTheDocument();
    expect(cancelledRow.getByText(/1\.500\.000/)).toHaveClass('line-through');
    expect(calls.find((c) => c.path === '/receipts').url).toContain('customerId=9');

    await userEvent.click(screen.getByRole('button', { name: /^Thanh toán/ }));
    const card = within(await screen.findByTestId('customer-receipts'));
    expect(card.getByText(/VN123 HAN-SGN 1\.000\.000/)).toBeInTheDocument();
    expect(card.getByText(/Vào ví 500\.000/)).toBeInTheDocument();
    expect(card.getByText(/TCB chính/)).toBeInTheDocument();

    await userEvent.click(card.getByRole('button', { name: 'Xoá phiếu thu' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/receipts/50')).toBe(true));
  });

  it('"Thu tiền nhiều vé" opens the receipt modal for this customer (owner only)', async () => {
    mockApi(routes());
    renderWithApp(<CustomerDetail id="9" />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: /Thu tiền nhiều vé/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('VN123 HAN-SGN')).toBeInTheDocument();
  });

  it('hides "Thu tiền nhiều vé" for a read-only customer', async () => {
    mockApi(routes({ 'GET /customers/:id/detail': { ...DETAIL, customer: { ...DETAIL.customer, user_id: 2, owner_name: 'Đại lý con' } } }));
    renderWithApp(<CustomerDetail id="9" />);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Thu tiền nhiều vé/ })).not.toBeInTheDocument();
  });
});
