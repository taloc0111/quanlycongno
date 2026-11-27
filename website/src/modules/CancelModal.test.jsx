import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackProvider } from '../ui/FeedbackContext';
import CancelModal from './CancelModal';
import { debtsConfig, trainsConfig } from './serviceConfigs';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { invalidateMoneyCache } from '../services/money';
import { today } from '../utils/format';

const ACCOUNTS = [{ id: 7, name: 'TCB chính', is_own: true, archived: false }, { id: 9, name: 'VIB', is_own: true, archived: false }];
const SUPPLIERS = [{ id: 3, name: 'F1 Thùy Dương', kind: 'f1' }, { id: 4, name: 'Down Hùng', kind: 'down' }];
const ROW = {
  id: 5, user_id: 1, customer_name: 'Nguyễn Văn A', customer_id: 11, ticket_code: 'ABC123',
  ticket_amount: '2000000.00', paid: '1500000.00', cost_amount: '1800000.00',
  cost_items: [
    { id: 50, supplier_id: 3, supplier_name: 'F1 Thùy Dương', label: 'Giá vé F1', amount: '1700000.00', kind: 'cost' },
    { id: 51, supplier_id: 3, supplier_name: 'F1 Thùy Dương', label: 'Phí F1', amount: '5000.00', kind: 'cost' },
    { id: 52, supplier_id: 4, supplier_name: 'Down Hùng', label: 'Phí down', amount: '95000.00', kind: 'cost' },
  ],
};

function renderModal({ row = ROW, cfg = debtsConfig, onDone = vi.fn() } = {}) {
  render(
    <FeedbackProvider>
      <CancelModal open row={row} cfg={cfg} onClose={() => {}} onDone={onDone} />
    </FeedbackProvider>,
  );
  return { onDone, dialog: screen.getByRole('dialog') };
}

beforeEach(() => {
  storage.set('token', 'tok');
  storage.remove('payment:lastAccount');
  invalidateMoneyCache();
});

describe('CancelModal', () => {
  it('defaults the refund to paid − fee; one supplier-refund row per supplier with the amount left EMPTY (cost shown as hint)', async () => {
    mockApi({ 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS });
    const { dialog } = renderModal();
    const refund = within(dialog).getByLabelText(/Trả lại khách/);
    expect(refund).toHaveValue('1.500.000');
    await userEvent.type(within(dialog).getByLabelText(/Khách chịu/), '300000');
    expect(refund).toHaveValue('1.200.000');

    const rows = within(dialog).getAllByTestId('supplier-refund');
    expect(rows).toHaveLength(2);
    expect(within(dialog).getByLabelText('NCC hoàn 1')).toHaveValue('3');
    expect(within(dialog).getByLabelText('Số tiền NCC hoàn 1')).toHaveValue('');
    expect(within(dialog).getByLabelText('Số tiền NCC hoàn 1')).toHaveAttribute('placeholder', expect.stringMatching(/1.705.000/));
    expect(within(dialog).getByLabelText('NCC hoàn 2')).toHaveValue('4');
    expect(within(dialog).getByLabelText('Số tiền NCC hoàn 2')).toHaveValue('');
  });

  it('preview: profit = fee − cost not refunded, customer receives the refund', async () => {
    mockApi({ 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS });
    const { dialog } = renderModal();
    await userEvent.type(within(dialog).getByLabelText(/Khách chịu/), '300000');
    // F1 hoàn 1.705.000, Down Hùng không hoàn → giá vốn còn lại 95.000 → lãi 205.000
    await userEvent.type(within(dialog).getByLabelText('Số tiền NCC hoàn 1'), '1705000');
    const preview = within(dialog).getByTestId('cancel-preview');
    expect(within(preview).getByTestId('cancel-profit')).toHaveTextContent(/205\.000/);
    expect(preview).toHaveTextContent(/Giá vốn còn lại\s*95\.000/);
    expect(preview).toHaveTextContent(/Khách sẽ nhận lại\s*1\.200\.000/);

    // Phí 2.500.000 > giá vốn: không hoàn gì, khách còn nợ 1.000.000; lãi âm khi phí < giá vốn còn lại
    await userEvent.clear(within(dialog).getByLabelText(/Khách chịu/));
    await userEvent.type(within(dialog).getByLabelText(/Khách chịu/), '50000');
    expect(within(preview).getByTestId('cancel-profit')).toHaveTextContent(/-45\.000/);
    expect(within(preview).getByTestId('cancel-profit')).toHaveClass('text-danger-600');
  });

  it('posts the exact body (refund to wallet, supplier refunds received later)', async () => {
    const { calls } = mockApi({ 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS, 'POST /debts/:id/cancel': { ok: true } });
    const { dialog, onDone } = renderModal();
    await userEvent.type(within(dialog).getByLabelText(/Khách chịu/), '300000');
    await userEvent.type(within(dialog).getByLabelText('Ghi chú'), 'Khách bận');
    await userEvent.type(within(dialog).getByLabelText('Số tiền NCC hoàn 1'), '1705000');
    await userEvent.type(within(dialog).getByLabelText('Số tiền NCC hoàn 2'), '95000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Xác nhận huỷ/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(post.path).toBe('/debts/5/cancel');
    expect(post.body).toEqual({
      cancelDate: today(),
      note: 'Khách bận',
      finalAmount: 300000,
      customerRefund: { amount: 1200000, to: 'wallet', accountId: null },
      supplierRefunds: [
        { supplierId: 3, amount: 1705000, receivedNow: false, accountId: null },
        { supplierId: 4, amount: 95000, receivedNow: false, accountId: null },
      ],
    });
    expect(await screen.findByText(/Đã huỷ vé, hoàn khách 1\.200\.000/)).toBeInTheDocument();
  });

  it('account variant: refund from an account, supplier money received now, zero rows dropped', async () => {
    const { calls } = mockApi({ 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS, 'POST /train-tickets/:id/cancel': { ok: true } });
    const row = { ...ROW, ticket_amount: '2000000', paid: '2000000' };
    const { dialog, onDone } = renderModal({ row, cfg: trainsConfig });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tài khoản' }));
    // Chưa chọn TK chi → báo lỗi, không gửi
    await userEvent.click(within(dialog).getByRole('button', { name: /Xác nhận huỷ/ }));
    expect(await screen.findByText('Chọn tài khoản chi tiền hoàn cho khách')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(within(dialog).getByLabelText('Chi từ tài khoản'), { target: { value: '9' } });
    // Sửa tay số hoàn khách
    const refund = within(dialog).getByLabelText(/Trả lại khách/);
    await userEvent.clear(refund);
    await userEvent.type(refund, '1000000');
    // NCC 1 hoàn 1.500.000, đã nhận vào TK 7; NCC 2 không hoàn (0 → bỏ)
    await userEvent.clear(within(dialog).getByLabelText('Số tiền NCC hoàn 1'));
    await userEvent.type(within(dialog).getByLabelText('Số tiền NCC hoàn 1'), '1500000');
    await userEvent.click(within(dialog).getByLabelText('Đã nhận tiền 1'));
    fireEvent.change(within(dialog).getByLabelText('Nhận vào tài khoản 1'), { target: { value: '7' } });
    await userEvent.clear(within(dialog).getByLabelText('Số tiền NCC hoàn 2'));

    await userEvent.click(within(dialog).getByRole('button', { name: /Xác nhận huỷ/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(post.path).toBe('/train-tickets/5/cancel');
    expect(post.body).toMatchObject({
      finalAmount: 0,
      customerRefund: { amount: 1000000, to: 'account', accountId: 9 },
      supplierRefunds: [{ supplierId: 3, amount: 1500000, receivedNow: true, accountId: 7 }],
    });
  });

  it('blocks refunds larger than the amount paid', async () => {
    const { calls } = mockApi({ 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS });
    const { dialog } = renderModal();
    const refund = within(dialog).getByLabelText(/Trả lại khách/);
    await userEvent.clear(refund);
    await userEvent.type(refund, '1600000');
    expect(within(dialog).getAllByText(/Không hoàn quá số khách đã trả/).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole('button', { name: /Xác nhận huỷ/ }));
    await waitFor(() => expect(screen.getAllByText(/Không hoàn quá số khách đã trả/).length).toBeGreaterThan(1));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('a service without customer can only refund from an account', async () => {
    mockApi({ 'GET /accounts': ACCOUNTS, 'GET /suppliers': SUPPLIERS });
    const { dialog } = renderModal({ row: { ...ROW, customer_id: null, cost_items: [] } });
    expect(within(dialog).queryByRole('button', { name: 'Ví khách' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Chi từ tài khoản')).toBeInTheDocument();
    expect(within(dialog).queryAllByTestId('supplier-refund')).toHaveLength(0);
  });
});
