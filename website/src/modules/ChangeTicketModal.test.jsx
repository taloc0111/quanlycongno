import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackProvider } from '../ui/FeedbackContext';
import ChangeTicketModal from './ChangeTicketModal';
import { debtsConfig } from './serviceConfigs';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { invalidateMoneyCache } from '../services/money';
import { today } from '../utils/format';

const SUPPLIERS = [{ id: 4, name: 'Down Hùng', kind: 'down' }, { id: 3, name: 'F1 Thùy Dương', kind: 'f1' }];
const ROW = {
  id: 8, user_id: 1, customer_name: 'Nguyễn Văn A', customer_id: 11, ticket_code: 'ABC123', route: 'HAN-SGN', flight_date: '2026-12-20',
  ticket_amount: '2000000.00', paid: '0', cost_amount: '1800000.00', cost_pending: false,
  // Dòng đầu là NCC down → vẫn phải gợi ý NCC F1
  cost_items: [
    { id: 52, supplier_id: 4, supplier_name: 'Down Hùng', label: 'Phí down', amount: '95000.00' },
    { id: 50, supplier_id: 3, supplier_name: 'F1 Thùy Dương', label: 'Giá vé F1', amount: '1705000.00' },
  ],
};

beforeEach(() => {
  storage.set('token', 'tok');
  invalidateMoneyCache();
});

describe('ChangeTicketModal', () => {
  it('prefills the ticket + F1 supplier, previews new price/cost/profit and posts the body', async () => {
    const { calls } = mockApi({ 'GET /suppliers': SUPPLIERS, 'POST /debts/:id/change': { ok: true } });
    const onDone = vi.fn();
    render(
      <FeedbackProvider>
        <ChangeTicketModal open row={ROW} cfg={debtsConfig} onClose={() => {}} onDone={onDone} />
      </FeedbackProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Mã vé mới')).toHaveValue('ABC123');
    expect(within(dialog).getByLabelText('Hành trình mới')).toHaveValue('HAN-SGN');
    await waitFor(() => expect(within(dialog).getByLabelText('NCC thu phí đổi')).toHaveValue('3'));

    await userEvent.type(within(dialog).getByLabelText('Phí đổi thu khách'), '300000');
    await userEvent.type(within(dialog).getByLabelText('Phí đổi trả NCC'), '200000');
    await userEvent.clear(within(dialog).getByLabelText('Mã vé mới'));
    await userEvent.type(within(dialog).getByLabelText('Mã vé mới'), 'NEW999');
    await userEvent.clear(within(dialog).getByLabelText('Hành trình mới'));
    await userEvent.type(within(dialog).getByLabelText('Hành trình mới'), 'han-dad');

    const preview = within(dialog).getByTestId('change-preview');
    expect(preview).toHaveTextContent(/Giá bán mới\s*2\.300\.000/);
    expect(preview).toHaveTextContent(/Giá vốn mới\s*2\.000\.000/);
    expect(within(preview).getByTestId('change-profit')).toHaveTextContent(/300\.000/);

    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu đổi vé/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(post.path).toBe('/debts/8/change');
    expect(post.body).toEqual({
      changeDate: today(),
      customerFee: 300000,
      supplierFee: 200000,
      supplierId: 3,
      newFlightDate: '2026-12-20',
      newRoute: 'HAN-DAD',
      newTicketCode: 'NEW999',
      note: '',
    });
    expect(await screen.findByText('Đã ghi nhận đổi vé')).toBeInTheDocument();
  });

  it('no supplier fee → supplierId is not sent', async () => {
    const { calls } = mockApi({ 'GET /suppliers': SUPPLIERS, 'POST /debts/:id/change': { ok: true } });
    const onDone = vi.fn();
    render(
      <FeedbackProvider>
        <ChangeTicketModal open row={ROW} cfg={debtsConfig} onClose={() => {}} onDone={onDone} />
      </FeedbackProvider>,
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Phí đổi thu khách'), '100000');
    await userEvent.click(within(dialog).getByRole('button', { name: /Lưu đổi vé/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ customerFee: 100000, supplierFee: 0, supplierId: null });
  });
});
