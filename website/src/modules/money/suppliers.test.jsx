import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuppliersApp from '../../SuppliersApp';
import { mockApi } from '../../test/mockApi';
import { today } from '../../utils/format';
import { ME, renderWithApp, setupSession } from './testUtils';

const SUPPLIERS = [
  { id: 3, user_id: 1, name: 'F1 Thùy Dương', kind: 'f1', phone: '0901', total_cost: '1505000', total_paid: '0', balance: '1505000.00', items_count: 2, unpaid_items: 2 },
  { id: 4, user_id: 1, name: 'Down Hải', kind: 'down', phone: '', total_cost: '300000', total_paid: '300000', balance: '0', items_count: 1, unpaid_items: 0 },
];

const LEDGER = {
  supplier: { id: 3, user_id: 1, name: 'F1 Thùy Dương', kind: 'f1' },
  items: [
    { id: 11, label: 'Giá vé F1', amount: '1500000', paid_amount: '0', due_date: null, created_at: '2026-11-20T03:00:00Z', target: { type: 'debt', id: 1, customer_name: 'Nguyễn A', label: 'VN123 HAN-SGN' } },
    { id: 12, label: 'Phí F1', amount: '5000', paid_amount: '0', due_date: null, created_at: '2026-11-20T03:00:00Z', target: { type: 'debt', id: 1, customer_name: 'Nguyễn A', label: 'VN123 HAN-SGN' } },
    { id: 13, label: 'Giá vé F1', amount: '900000', paid_amount: '900000', due_date: null, created_at: '2026-11-10T03:00:00Z', target: { type: 'debt', id: 2, customer_name: 'Trần B', label: 'VJ1 SGN-DAD' } },
  ],
  payments: [],
  total_cost: '2405000', total_paid: '900000', balance: '1505000',
};

const ACCOUNTS = [
  { id: 5, user_id: 1, name: 'TCB chính', account_number: '1903', is_own: true, archived: false },
  { id: 6, user_id: 1, name: 'ACB cũ', is_own: true, archived: true },
];

beforeEach(setupSession);

describe('SuppliersApp', () => {
  it('lists suppliers with totals and filters by kind', async () => {
    mockApi({ 'GET /suppliers': SUPPLIERS, 'GET /auth/profile': ME });
    renderWithApp(<SuppliersApp />);
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('F1 Thùy Dương')).toBeInTheDocument();
    expect(table.getByText('Down Hải')).toBeInTheDocument();
    expect(screen.getAllByText(/1\.505\.000/).length).toBeGreaterThanOrEqual(2); // thẻ tổng + dòng
    fireEvent.change(screen.getByLabelText('Lọc loại nhà cung cấp'), { target: { value: 'down' } });
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('F1 Thùy Dương')).not.toBeInTheDocument());
  });

  it('pays a supplier for one cost item: posts {amount, payDate, accountId, costItemId}', async () => {
    const { calls } = mockApi({
      'GET /suppliers': () => SUPPLIERS,
      'GET /suppliers/:id/ledger': LEDGER,
      'GET /accounts': ACCOUNTS,
      'POST /suppliers/:id/payments': ({ body }) => ({ id: 70, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<SuppliersApp />);
    const table = within(await screen.findByRole('table'));
    await userEvent.click(table.getAllByRole('button', { name: /Trả tiền/ })[0]);
    const dialog = await screen.findByRole('dialog');
    // Chỉ dòng còn nợ mới có trong danh sách; TK lưu trữ bị ẩn
    await within(dialog).findByRole('option', { name: /Giá vé F1.*còn 1\.500\.000/ });
    expect(within(dialog).getAllByRole('option', { name: /Giá vé F1/ })).toHaveLength(1);
    await within(dialog).findByRole('option', { name: /TCB chính/ });
    expect(within(dialog).queryByRole('option', { name: /ACB cũ/ })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Cho dòng giá vốn/), { target: { value: '11' } });
    expect(within(dialog).getByLabelText(/Số tiền/)).toHaveValue('1.500.000'); // tự điền phần còn lại
    fireEvent.change(within(dialog).getByLabelText(/Từ tài khoản/), { target: { value: '5' } });
    await userEvent.click(within(dialog).getByRole('button', { name: /Ghi trả tiền/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/suppliers/3/payments')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/suppliers/3/payments');
    expect(post.body).toMatchObject({ amount: 1500000, payDate: today(), accountId: 5, costItemId: 11 });
  });

  it('"Trả hết" fills the supplier balance for a lump-sum payment', async () => {
    const { calls } = mockApi({
      'GET /suppliers': () => SUPPLIERS,
      'GET /suppliers/:id/ledger': LEDGER,
      'GET /accounts': ACCOUNTS,
      'POST /suppliers/:id/payments': ({ body }) => ({ id: 71, ...body }),
      'GET /auth/profile': ME,
    });
    renderWithApp(<SuppliersApp />);
    const table = within(await screen.findByRole('table'));
    await userEvent.click(table.getAllByRole('button', { name: /Trả tiền/ })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Trả hết' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Ghi trả tiền/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ amount: 1505000, accountId: null, costItemId: null });
  });

  it('detail shows cost items and payments tabs', async () => {
    mockApi({
      'GET /suppliers/:id/ledger': {
        ...LEDGER,
        payments: [{ id: 90, amount: '900000', pay_date: '2026-11-11', account_id: 5, account_name: 'TCB chính', cost_item_id: 13, cost_item_label: 'Giá vé F1', reconciled: false, notes: 'CK' }],
      },
      'GET /auth/profile': ME,
    });
    renderWithApp(<SuppliersApp param="3" />);
    const table = within(await screen.findByRole('table'));
    expect(table.getAllByText('VN123 HAN-SGN').length).toBe(2);
    expect(table.getByText('Đã trả đủ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Lần trả \(1\)/ }));
    expect(await within(screen.getByRole('table')).findByText('TCB chính')).toBeInTheDocument();
  });
});
