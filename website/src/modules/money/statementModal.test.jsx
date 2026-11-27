import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsApp from '../../AccountsApp';
import { mockApi } from '../../test/mockApi';
import { readSpreadsheet } from '../../utils/excel';
import { ME, renderWithApp, setupSession } from './testUtils';

vi.mock('../../utils/excel', async (importOriginal) => ({ ...(await importOriginal()), readSpreadsheet: vi.fn() }));

const LEDGER = {
  account: { id: 7, user_id: 1, name: 'TCB chính', bank: 'TCB', is_own: true },
  opening: '0',
  rows: [
    { kind: 'payment', id: 1, date: '2026-11-01', direction: 'in', amount: '500000.00', description: 'Khách Nguyễn A · Vé VN123', reconciled: false },
    { kind: 'transfer_out', id: 4, date: '2026-11-03', direction: 'out', amount: '1000000', description: 'Sang tiền mặt', reconciled: true },
    { kind: 'entry_out', id: 3, date: '2026-11-05', direction: 'out', amount: '22000', description: 'Phí ngân hàng · SMS', reconciled: false },
  ],
  total_in: '500000', total_out: '1022000', closing: '-522000',
};

const FILE_ROWS = {
  headers: ['Ngày giao dịch', 'Ghi có', 'Ghi nợ', 'Nội dung'],
  rows: [
    { 'Ngày giao dịch': '02/11/2026', 'Ghi có': '500.000', 'Ghi nợ': '', 'Nội dung': 'NGUYEN A CK VE' },
    { 'Ngày giao dịch': '03/11/2026', 'Ghi có': '', 'Ghi nợ': '1.000.000', 'Nội dung': 'RUT TIEN' },
    { 'Ngày giao dịch': '05/11/2026', 'Ghi có': '', 'Ghi nợ': '22.000', 'Nội dung': 'PHI SMS' },
    { 'Ngày giao dịch': '10/11/2026', 'Ghi có': '300.000', 'Ghi nợ': '', 'Nội dung': 'LAI TIEN GUI' },
  ],
};

beforeEach(setupSession);

const openMatcher = async () => {
  renderWithApp(<AccountsApp param="7" />);
  await screen.findAllByText('Khách Nguyễn A · Vé VN123');
  await userEvent.click(screen.getByRole('button', { name: /Khớp sao kê/ }));
  const dialog = within(await screen.findByRole('dialog'));
  const file = new File(['x'], 'saoke.csv', { type: 'text/csv' });
  await userEvent.upload(dialog.getByLabelText('File sao kê'), file);
  await dialog.findByText('NGUYEN A CK VE');
  return dialog;
};

describe('Khớp sao kê', () => {
  it('auto-maps columns, suggests matches and reconciles the ticked ones in one batch', async () => {
    readSpreadsheet.mockResolvedValue(FILE_ROWS);
    const { calls } = mockApi({
      'GET /accounts/:id/ledger': LEDGER,
      'PUT /accounts/reconcile-batch': ({ body }) => ({ updated: body.items.length }),
      'GET /auth/profile': ME,
    });
    const dialog = await openMatcher();
    expect(dialog.getByLabelText(/^Ngày/)).toHaveValue('Ngày giao dịch');
    expect(dialog.getByLabelText(/Ghi có/)).toHaveValue('Ghi có');
    expect(dialog.getByLabelText(/Ghi nợ/)).toHaveValue('Ghi nợ');
    expect(dialog.getByLabelText(/Nội dung/)).toHaveValue('Nội dung');

    const row = (i) => within(screen.getByTestId(`stmt-${i}`));
    expect(row(0).getByText('Khớp')).toBeInTheDocument();
    expect(row(0).getByText(/Khách Nguyễn A · Vé VN123/)).toBeInTheDocument();
    expect(row(1).getByText('Không khớp')).toBeInTheDocument(); // dòng sổ đã đối soát rồi
    expect(row(2).getByText('Khớp')).toBeInTheDocument();
    expect(row(3).getByText('Không khớp')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /Xác nhận khớp 2 dòng/ })).toBeEnabled();

    await userEvent.click(dialog.getByLabelText('Khớp dòng 3')); // bỏ gợi ý phí SMS
    await userEvent.click(dialog.getByRole('button', { name: /Xác nhận khớp 1 dòng/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/accounts/reconcile-batch')).toBe(true));
    expect(calls.find((c) => c.path === '/accounts/reconcile-batch').body).toEqual({ items: [{ kind: 'payment', id: 1, reconciled: true }] });
    expect(await screen.findByText('Đã đối soát 1 giao dịch')).toBeInTheDocument();
  });

  it('offers a prefilled "Thu/chi khác" for unmatched statement rows', async () => {
    readSpreadsheet.mockResolvedValue(FILE_ROWS);
    mockApi({
      'GET /accounts/:id/ledger': LEDGER,
      'GET /accounts': [{ id: 7, user_id: 1, name: 'TCB chính', is_own: true, archived: false }],
      'GET /auth/profile': ME,
    });
    await openMatcher();
    await userEvent.click(within(screen.getByTestId('stmt-3')).getByRole('button', { name: /Tạo thu\/chi khác/ }));
    const entry = within(await screen.findByRole('dialog'));
    expect(entry.getByText('Thu/chi khác')).toBeInTheDocument();
    expect(entry.getByLabelText(/Số tiền/)).toHaveValue('300.000');
    expect(entry.getByLabelText(/Danh mục/)).toHaveValue('Góp vốn'); // chiều Thu
    expect(entry.getByLabelText(/Ghi chú/)).toHaveValue('LAI TIEN GUI');
    await waitFor(() => expect(entry.getByLabelText(/Tài khoản/)).toHaveValue('7'));
  });
});
