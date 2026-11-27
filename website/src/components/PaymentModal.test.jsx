import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackProvider } from '../ui/FeedbackContext';
import PaymentModal from './PaymentModal';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { invalidateMoneyCache } from '../services/money';
import { today } from '../utils/format';

const ACCOUNTS = [
  { id: 7, name: 'TCB chính', account_number: '19031234', is_own: true, archived: false },
  { id: 9, name: 'VIB', is_own: true, archived: false },
  { id: 8, name: 'TK cũ', is_own: true, archived: true },
];
const TARGET = { type: 'debt', id: 1, name: 'Nguyễn Văn A · VN123', total: '2500000.00', paid: '0', customerId: 11 };

function renderModal(target = TARGET) {
  return render(
    <FeedbackProvider>
      <PaymentModal target={target} onClose={() => {}} onChanged={() => {}} />
    </FeedbackProvider>,
  );
}

const amountInput = () => screen.getByPlaceholderText('0');
const submitBtn = () => screen.getByRole('button', { name: /Thêm thanh toán/ });

beforeEach(() => {
  storage.set('token', 'tok');
  storage.remove('payment:lastAccount');
  invalidateMoneyCache();
});

describe('PaymentModal', () => {
  it('sends the chosen account as accountId and remembers it', async () => {
    const { calls } = mockApi({
      'GET /payments': [],
      'GET /accounts': ACCOUNTS,
      'POST /payments': ({ body }) => ({ id: 5, ...body }),
    });
    renderModal();
    const acc = await screen.findByLabelText('Vào tài khoản');
    await waitFor(() => expect(within(acc).getByText(/TCB chính/)).toBeInTheDocument());
    expect(within(acc).queryByText(/TK cũ/)).not.toBeInTheDocument();
    fireEvent.change(acc, { target: { value: '9' } });
    await userEvent.type(amountInput(), '1000000');
    await userEvent.click(submitBtn());
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ debtId: 1, amount: 1000000, method: 'cash', accountId: 9, paymentDate: today() });
    expect(storage.get('payment:lastAccount')).toBe('9');
  });

  it('defaults to the last used account', async () => {
    storage.set('payment:lastAccount', '7');
    mockApi({ 'GET /payments': [], 'GET /accounts': ACCOUNTS });
    renderModal();
    const acc = await screen.findByLabelText('Vào tài khoản');
    await waitFor(() => expect(acc).toHaveValue('7'));
  });

  it('lists account name, method and a "Trừ ví" badge', async () => {
    mockApi({
      'GET /payments': [
        { id: 1, amount: '100000', payment_date: '2026-11-01', method: 'wallet', account_name: null, payment_target: 'self' },
        { id: 2, amount: '200000', payment_date: '2026-11-02', method: 'bank_transfer', account_name: 'VIB', payment_target: 'self' },
      ],
      'GET /accounts': ACCOUNTS,
    });
    renderModal();
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Trừ ví')).toBeInTheDocument();
    expect(within(list).getByText('VIB')).toBeInTheDocument();
    expect(within(list).getByText('Chuyển khoản')).toBeInTheDocument();
  });

  it('wallet method shows the balance, hides the account and blocks over-balance amounts', async () => {
    const { calls } = mockApi({
      'GET /payments': [],
      'GET /accounts': ACCOUNTS,
      'GET /wallets/:id': { customer: { id: 11 }, balance: '300000.00', entries: [] },
      'POST /payments': ({ body }) => ({ id: 6, ...body }),
    });
    renderModal();
    await screen.findByLabelText('Vào tài khoản');
    fireEvent.change(screen.getByLabelText('Hình thức'), { target: { value: 'wallet' } });
    expect(screen.queryByLabelText('Vào tài khoản')).not.toBeInTheDocument();
    const info = await screen.findByTestId('wallet-info');
    await waitFor(() => expect(info).toHaveTextContent(/Số dư ví: 300\.000/));
    expect(calls.some((c) => c.path === '/wallets/11')).toBe(true);

    await userEvent.type(amountInput(), '500000');
    expect(submitBtn()).toBeDisabled();
    expect(screen.getByText(/Vượt số dư ví/)).toBeInTheDocument();

    await userEvent.clear(amountInput());
    await userEvent.type(amountInput(), '200000');
    expect(submitBtn()).not.toBeDisabled();
    await userEvent.click(submitBtn());
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ method: 'wallet', amount: 200000, accountId: null });
  });

  it('wallet method without a customer shows a message and cannot submit', async () => {
    const { calls } = mockApi({ 'GET /payments': [], 'GET /accounts': ACCOUNTS });
    renderModal({ ...TARGET, customerId: undefined });
    await screen.findByLabelText('Vào tài khoản');
    fireEvent.change(screen.getByLabelText('Hình thức'), { target: { value: 'wallet' } });
    expect(screen.getByText('Dịch vụ chưa gắn khách hàng, không trừ ví được')).toBeInTheDocument();
    await userEvent.type(amountInput(), '1000');
    expect(submitBtn()).toBeDisabled();
    expect(calls.some((c) => c.path.startsWith('/wallets'))).toBe(false);
  });

  it('overpaying a service with a customer: shows the wallet overflow info and the server split in the toast', async () => {
    const { calls } = mockApi({
      'GET /payments': [],
      'GET /accounts': ACCOUNTS,
      'POST /payments': ({ body }) => ({ id: 7, ...body, amount: 2500000, overflowToWallet: 500000, receiptId: 3 }),
    });
    renderModal();
    await screen.findByLabelText('Vào tài khoản');
    await userEvent.type(amountInput(), '3000000');
    expect(screen.getByTestId('overflow-info')).toHaveTextContent(/Phần thừa 500\.000.*sẽ vào ví khách/);
    expect(screen.queryByText(/Vượt số còn nợ/)).not.toBeInTheDocument();
    await userEvent.click(submitBtn());
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ amount: 3000000, debtId: 1 });
    expect(await screen.findByText(/Đã ghi 2\.500\.000.*, 500\.000.* vào ví khách/)).toBeInTheDocument();
  });

  it('overpaying without a customer keeps the old warning; wallet method never overflows', async () => {
    mockApi({ 'GET /payments': [], 'GET /accounts': ACCOUNTS, 'GET /wallets/:id': { balance: '9000000', entries: [] } });
    const { unmount } = renderModal({ ...TARGET, customerId: undefined });
    await screen.findByLabelText('Vào tài khoản');
    await userEvent.type(amountInput(), '3000000');
    expect(screen.getByText(/Vượt số còn nợ/)).toBeInTheDocument();
    expect(screen.queryByTestId('overflow-info')).not.toBeInTheDocument();
    unmount();

    renderModal();
    await screen.findByLabelText('Vào tài khoản');
    fireEvent.change(screen.getByLabelText('Hình thức'), { target: { value: 'wallet' } });
    await userEvent.type(amountInput(), '3000000');
    expect(screen.queryByTestId('overflow-info')).not.toBeInTheDocument();
  });

  it('cancelled service: shows a notice and cannot add payments; refund rows are labelled', async () => {
    const { calls } = mockApi({
      'GET /payments': [
        { id: 1, amount: '1500000', payment_date: '2026-11-01', method: 'cash', payment_target: 'self', kind: 'payment' },
        { id: 2, amount: '-1200000', payment_date: '2026-11-20', method: 'wallet', payment_target: 'self', kind: 'refund' },
      ],
      'GET /accounts': ACCOUNTS,
    });
    // Giá bán sau huỷ 300k, đã trả 1.5tr, hoàn 1.2tr → hết nợ → khoá.
    renderModal({ ...TARGET, total: '300000', cancelled: true });
    const list = await screen.findByRole('list');
    expect(screen.getByTestId('cancelled-notice')).toHaveTextContent(/đã huỷ và khách không còn nợ/);
    expect(submitBtn()).toBeDisabled();
    expect(amountInput()).toBeDisabled();
    expect(within(list).getByText('Hoàn tiền vào ví')).toBeInTheDocument();
    // Dòng hoàn không có nút xoá (xoá bằng Hoàn tác huỷ)
    expect(within(list).getAllByRole('button', { name: 'Xoá' })).toHaveLength(1);
    fireEvent.submit(amountInput().closest('form'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('cancelled service with fee still owed: collects up to the remaining fee, no overflow to wallet', async () => {
    const { calls } = mockApi({
      'GET /payments': [{ id: 1, amount: '100000', payment_date: '2026-11-01', method: 'cash', payment_target: 'self', kind: 'payment' }],
      'GET /accounts': ACCOUNTS,
      'POST /payments': ({ body }) => ({ id: 9, ...body, overflowToWallet: 0 }),
    });
    // Phí huỷ 400k, đã trả 100k → còn nợ 300k
    renderModal({ ...TARGET, total: '400000', cancelled: true });
    await screen.findByRole('list');
    expect(screen.getByTestId('cancelled-notice')).toHaveTextContent(/chỉ thu phần phí huỷ khách còn nợ/);
    expect(amountInput()).not.toBeDisabled();
    await userEvent.type(amountInput(), '350000');
    expect(screen.queryByText(/sẽ vào ví khách/)).not.toBeInTheDocument();
    fireEvent.submit(amountInput().closest('form'));
    expect(await screen.findByText(/chỉ thu tối đa/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.clear(amountInput());
    await userEvent.type(amountInput(), '300000');
    fireEvent.submit(amountInput().closest('form'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ amount: 300000 }));
  });
});
