import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiptModal from './ReceiptModal';
import { mockApi } from '../../test/mockApi';
import { storage } from '../../services/client';
import { today } from '../../utils/format';
import { ME, renderWithApp, setupSession } from './testUtils';

const ACCOUNTS = [
  { id: 5, user_id: 1, name: 'TCB chính', is_own: true, archived: false },
  { id: 6, user_id: 1, name: 'VIB', is_own: true, archived: false },
  { id: 7, user_id: 1, name: 'ACB cũ', is_own: true, archived: true },
];
const OUTSTANDING = [
  { type: 'debt', id: 1, label: 'VN123 HAN-SGN', issue_date: '2026-10-01', due_date: null, total: '1000000', paid: '0', remaining: '1000000' },
  { type: 'passport', id: 2, label: 'Hộ chiếu Lê B', issue_date: '2026-10-15', due_date: '2026-11-01', total: '800000', paid: '300000', remaining: '500000' },
  { type: 'tour', id: 3, label: 'Tour Đà Lạt', issue_date: '2026-11-10', due_date: null, total: '2000000', paid: '0', remaining: '2000000' },
];

const routes = (extra = {}) => ({
  'GET /accounts': ACCOUNTS,
  'GET /customers/:id/outstanding': OUTSTANDING,
  'POST /receipts': ({ body }) => ({ receipt: { id: 50, ...body }, payments: [], walletTopup: null }),
  'GET /auth/profile': ME,
  ...extra,
});

beforeEach(() => {
  setupSession();
  storage.remove('payment:lastAccount');
});

const open = async (props = {}) => {
  const onDone = vi.fn();
  const onClose = vi.fn();
  renderWithApp(<ReceiptModal open customerId={9} onClose={onClose} onDone={onDone} {...props} />);
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('VN123 HAN-SGN');
  return { dialog: within(dialog), onDone, onClose };
};

describe('ReceiptModal', () => {
  it('auto-allocates oldest first and posts the receipt body', async () => {
    const { calls } = mockApi(routes());
    const { dialog, onDone, onClose } = await open();
    // TK lưu trữ không có trong danh sách
    await dialog.findByRole('option', { name: /TCB chính/ });
    expect(dialog.queryByRole('option', { name: /ACB cũ/ })).not.toBeInTheDocument();

    await userEvent.type(dialog.getByLabelText(/Số tiền khách chuyển/), '1700000');
    await userEvent.click(dialog.getByRole('button', { name: /Chia tự động/ }));
    expect(dialog.getByLabelText('Chia cho VN123 HAN-SGN')).toHaveValue('1.000.000');
    expect(dialog.getByLabelText('Chia cho Hộ chiếu Lê B')).toHaveValue('500.000');
    expect(dialog.getByLabelText('Chia cho Tour Đà Lạt')).toHaveValue('200.000');
    expect(dialog.getByLabelText('Chọn Tour Đà Lạt')).toBeChecked();
    expect(dialog.queryByText(/sẽ vào ví khách/)).not.toBeInTheDocument();

    await userEvent.selectOptions(dialog.getByLabelText(/Vào tài khoản/), '6');
    await userEvent.selectOptions(dialog.getByLabelText(/Hình thức/), 'cash');
    await userEvent.click(dialog.getByRole('button', { name: /Ghi phiếu thu/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/receipts')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toEqual({
      accountId: 6, receiptDate: today(), method: 'cash', paymentTarget: 'self', notes: '', customerId: 9, amount: 1700000,
      allocations: [
        { type: 'debt', id: 1, amount: 1000000 },
        { type: 'passport', id: 2, amount: 500000 },
        { type: 'tour', id: 3, amount: 200000 },
      ],
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(storage.get('payment:lastAccount')).toBe('6');
  });

  it('allocates only preselected rows and sends the remainder to the wallet', async () => {
    storage.set('payment:lastAccount', '5');
    const { calls } = mockApi(routes());
    const { dialog } = await open({ preselect: [{ type: 'passport', id: 2 }] });
    expect(dialog.getByLabelText('Chọn Hộ chiếu Lê B')).toBeChecked();
    expect(dialog.getByLabelText('Chọn VN123 HAN-SGN')).not.toBeChecked();
    await waitFor(() => expect(dialog.getByLabelText(/Vào tài khoản/)).toHaveValue('5')); // nhớ TK lần trước

    await userEvent.type(dialog.getByLabelText(/Số tiền khách chuyển/), '800000');
    await userEvent.click(dialog.getByRole('button', { name: /Chia tự động/ }));
    expect(dialog.getByLabelText('Chia cho Hộ chiếu Lê B')).toHaveValue('500.000');
    expect(dialog.getByLabelText('Chia cho VN123 HAN-SGN')).toHaveValue('');
    expect(dialog.getByText(/Phần thừa 300\.000.*sẽ vào ví khách/)).toBeInTheDocument();

    await userEvent.click(dialog.getByRole('button', { name: /Ghi phiếu thu/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({
      accountId: 5, customerId: 9, amount: 800000, allocations: [{ type: 'passport', id: 2, amount: 500000 }],
    });
    expect(await screen.findByText(/Đã ghi phiếu thu 800\.000.*300\.000.*vào ví khách/)).toBeInTheDocument();
  });

  it('validates rows against the remaining debt and the total against the amount', async () => {
    const { calls } = mockApi(routes());
    const { dialog } = await open();
    await userEvent.type(dialog.getByLabelText(/Số tiền khách chuyển/), '600000');
    await userEvent.type(dialog.getByLabelText('Chia cho Hộ chiếu Lê B'), '550000');
    expect(dialog.getByLabelText('Chọn Hộ chiếu Lê B')).toBeChecked(); // nhập số chia tự tick
    expect(dialog.getByText(/Vượt số còn nợ 500\.000/)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /Ghi phiếu thu/ })).toBeDisabled();

    await userEvent.clear(dialog.getByLabelText('Chia cho Hộ chiếu Lê B'));
    await userEvent.type(dialog.getByLabelText('Chia cho Hộ chiếu Lê B'), '500000');
    await userEvent.type(dialog.getByLabelText('Chia cho VN123 HAN-SGN'), '200000');
    expect(dialog.getByRole('alert')).toHaveTextContent(/Tổng chia vượt số tiền khách chuyển 100\.000/);
    expect(dialog.getByRole('button', { name: /Ghi phiếu thu/ })).toBeDisabled();

    await userEvent.click(dialog.getByRole('button', { name: 'Xoá chia' }));
    expect(dialog.getByLabelText('Chia cho VN123 HAN-SGN')).toHaveValue('');
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('refuses a remainder when there is no customer', async () => {
    mockApi(routes());
    renderWithApp(<ReceiptModal open customerId={null} onClose={() => {}} onDone={() => {}} />);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Chưa chọn khách hàng/)).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText(/Số tiền khách chuyển/), '100000');
    expect(dialog.getByRole('alert')).toHaveTextContent(/Không có khách để nhận phần thừa/);
    expect(dialog.getByRole('button', { name: /Ghi phiếu thu/ })).toBeDisabled();
  });
});
