import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuppliersApp from '../../SuppliersApp';
import { mockApi } from '../../test/mockApi';
import { ME, renderWithApp, setupSession } from './testUtils';

const SUPPLIERS = [
  { id: 3, user_id: 1, name: 'F1 Thùy Dương', kind: 'f1', total_cost: '1000000', total_paid: '1500000', balance: '-500000.00', items_count: 2, unpaid_items: 0 },
  { id: 4, user_id: 1, name: 'Down Hải', kind: 'down', total_cost: '300000', total_paid: '0', balance: '300000.00', items_count: 1, unpaid_items: 1 },
];

const LEDGER = {
  supplier: { id: 3, user_id: 1, name: 'F1 Thùy Dương', kind: 'f1' },
  items: [
    { id: 11, kind: 'cost', label: 'Giá vé F1', amount: '1500000', paid_amount: '1500000', created_at: '2026-11-01T03:00:00Z', target: { type: 'debt', id: 1, label: 'VN123 HAN-SGN' } },
    { id: 12, kind: 'refund', label: 'Hoàn từ F1 Thùy Dương', amount: '-500000', paid_amount: '0', created_at: '2026-11-05T03:00:00Z', target: { type: 'debt', id: 1, label: 'VN123 HAN-SGN' } },
    { id: 13, kind: 'change', label: 'Phí đổi vé', amount: '200000', paid_amount: '200000', created_at: '2026-11-06T03:00:00Z', target: { type: 'debt', id: 2, label: 'VJ1 SGN-DAD' } },
  ],
  payments: [
    { id: 90, amount: '1500000', pay_date: '2026-11-02', account_name: 'TCB chính', cost_item_label: 'Giá vé F1', reconciled: false },
    { id: 91, amount: '-200000', pay_date: '2026-11-07', account_name: 'TCB chính', cost_item_label: null, reconciled: false },
  ],
  total_cost: '1200000', total_paid: '1700000', balance: '-500000',
};

beforeEach(setupSession);

describe('NCC — số dư âm & NCC trả lại', () => {
  it('shows "Đang giữ của mình" for negative balances and splits the totals', async () => {
    mockApi({ 'GET /suppliers': SUPPLIERS, 'GET /auth/profile': ME });
    renderWithApp(<SuppliersApp />);
    const table = within(await screen.findByRole('table'));
    expect(table.getByText(/Đang giữ của mình 500\.000/)).toBeInTheDocument();
    expect(screen.getByText('Mình còn nợ NCC')).toBeInTheDocument();
    expect(screen.getByText('NCC đang giữ của mình')).toBeInTheDocument();
    expect(screen.getByText('Đang nợ 1 nơi')).toBeInTheDocument();
    expect(screen.getByText('1 nơi cần trả lại/trừ dần')).toBeInTheDocument();
  });

  it('pay modal: "NCC trả lại mình" posts direction "in" (default for negative balance)', async () => {
    const { calls } = mockApi({
      'GET /suppliers': () => SUPPLIERS,
      'GET /suppliers/:id/ledger': LEDGER,
      'GET /accounts': [{ id: 5, user_id: 1, name: 'TCB chính', is_own: true, archived: false }],
      'POST /suppliers/:id/payments': ({ body }) => ({ id: 92, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<SuppliersApp />);
    const table = within(await screen.findByRole('table'));
    await userEvent.click(within(table.getByText('F1 Thùy Dương').closest('tr')).getByRole('button', { name: /Trả tiền/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Nhận tiền về · F1 Thùy Dương/)).toBeInTheDocument();
    expect(dialog.getByLabelText(/Vào tài khoản/)).toBeInTheDocument();
    // Chỉ dòng hoàn đang chờ nhận
    await dialog.findByRole('option', { name: /Hoàn từ F1 Thùy Dương.*chờ nhận 500\.000/ });
    expect(dialog.queryByRole('option', { name: /Giá vé F1/ })).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Nhận hết' }));
    expect(dialog.getByLabelText(/Số tiền/)).toHaveValue('500.000');
    await dialog.findByRole('option', { name: /TCB chính/ });
    await userEvent.selectOptions(dialog.getByLabelText(/Vào tài khoản/), '5');
    await userEvent.click(dialog.getByRole('button', { name: /Ghi nhận tiền về/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ amount: 500000, accountId: 5, costItemId: null, direction: 'in' });

    // Chuyển về "Mình trả NCC" → direction out
    await userEvent.click(within(within(screen.getByRole('table')).getByText('Down Hải').closest('tr')).getByRole('button', { name: /Trả tiền/ }));
    const d2 = within(await screen.findByRole('dialog'));
    expect(d2.getByText(/Trả tiền · Down Hải/)).toBeInTheDocument();
    await userEvent.click(d2.getByRole('button', { name: 'NCC trả lại mình' }));
    await userEvent.click(d2.getByRole('button', { name: 'Mình trả NCC' }));
    await userEvent.type(d2.getByLabelText(/Số tiền/), '100000');
    await userEvent.click(d2.getByRole('button', { name: /Ghi trả tiền/ }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').length).toBe(2));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toMatchObject({ amount: 100000, direction: 'out' });
  });

  it('ledger labels refund/change items and negative payments as "NCC hoàn"', async () => {
    mockApi({ 'GET /suppliers/:id/ledger': LEDGER, 'GET /auth/profile': ME });
    renderWithApp(<SuppliersApp param="3" />);
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('NCC hoàn')).toBeInTheDocument();
    expect(table.getByText('Phí đổi')).toBeInTheDocument();
    expect(table.getByText(/Chờ nhận 500\.000/)).toBeInTheDocument();
    expect(table.getByRole('button', { name: 'Nhận' })).toBeInTheDocument();
    expect(screen.getByText('Đang giữ của mình')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Lần trả \(2\)/ }));
    const pays = within(screen.getByRole('table'));
    expect(pays.getByText('NCC hoàn')).toBeInTheDocument();
    expect(pays.getByText(/\+200\.000/)).toBeInTheDocument();
  });
});
