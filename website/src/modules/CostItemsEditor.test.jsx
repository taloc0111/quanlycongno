import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackProvider } from '../ui/FeedbackContext';
import CostItemsEditor from './CostItemsEditor';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { invalidateMoneyCache } from '../services/money';

const SUPPLIERS = [
  { id: 3, name: 'F1 Thùy Dương', kind: 'f1' },
  { id: 4, name: 'Down Hùng', kind: 'down' },
];
const ACCOUNTS = [
  { id: 7, name: 'TCB chính', account_number: '19031234', is_own: true, archived: false },
  { id: 8, name: 'TK cũ', is_own: true, archived: true },
];

// Giá trị mới nhất CostItemsEditor gửi qua onChange (ghi trong handler, không ghi lúc render).
const captured = { items: [] };
function Harness({ initial, suppliers = SUPPLIERS, accounts = ACCOUNTS }) {
  const [items, setItems] = useState(initial);
  const onChange = (next) => { captured.items = next; setItems(next); };
  return (
    <FeedbackProvider>
      <CostItemsEditor value={items} onChange={onChange} suppliers={suppliers} accounts={accounts} readOnlyPaid />
    </FeedbackProvider>
  );
}

const rows = () => screen.queryAllByTestId('cost-item');
const total = () => screen.getByTestId('cost-total').textContent;

beforeEach(() => {
  storage.set('token', 'tok');
  storage.remove('payment:lastAccount');
  invalidateMoneyCache();
  captured.items = [];
});

describe('CostItemsEditor', () => {
  it('adds and removes rows and keeps the total in sync', async () => {
    render(<Harness initial={[{ _key: 'a', supplierId: '', label: 'Giá vé F1', amount: '1000', dueDate: '', paidAmount: 0, payNow: false }]} />);
    expect(rows()).toHaveLength(1);
    expect(total()).toMatch(/1\.000/);

    await userEvent.click(screen.getByRole('button', { name: /Thêm dòng/ }));
    expect(rows()).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Số tiền 2'), '2500');
    await userEvent.type(screen.getByLabelText('Tên khoản 2'), 'Phí F1');
    expect(total()).toMatch(/3\.500/);

    await userEvent.click(screen.getByRole('button', { name: 'Xoá dòng 1' }));
    expect(rows()).toHaveLength(1);
    expect(total()).toMatch(/2\.500/);
    expect(captured.items).toHaveLength(1);
    expect(captured.items[0]).toMatchObject({ label: 'Phí F1', amount: '2500' });
  });

  it('"Trả ngay" only for rows with a supplier and reveals an account select (non-archived)', async () => {
    render(<Harness initial={[
      { _key: 'a', supplierId: '', label: 'Khác', amount: '1000', dueDate: '', paidAmount: 0, payNow: false },
      { _key: 'b', supplierId: '3', label: 'Giá vé F1', amount: '2000', dueDate: '', paidAmount: 0, payNow: false },
    ]} />);
    expect(screen.queryByLabelText('Trả ngay 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trả từ tài khoản 2')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Trả ngay 2'));
    const acc = screen.getByLabelText('Trả từ tài khoản 2');
    expect(within(acc).getByText(/TCB chính/)).toBeInTheDocument();
    expect(within(acc).queryByText(/TK cũ/)).not.toBeInTheDocument();
    fireEvent.change(acc, { target: { value: '7' } });
    expect(captured.items[1].payNow).toMatchObject({ accountId: '7' });
    expect(captured.items[1].payNow.payDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Bỏ tick → payNow false
    await userEvent.click(screen.getByLabelText('Trả ngay 2'));
    expect(captured.items[1].payNow).toBe(false);
  });

  it('shows paid status badges for saved rows and locks the supplier of paid rows', () => {
    render(<Harness initial={[
      { id: 1, supplierId: '3', label: 'Giá vé F1', amount: '1000000.00', dueDate: '', paidAmount: 1000000, payNow: false },
      { id: 2, supplierId: '3', label: 'Phí F1', amount: '5000.00', dueDate: '', paidAmount: 2000, payNow: false },
      { id: 3, supplierId: '4', label: 'Phí down', amount: '30000.00', dueDate: '2026-12-01', paidAmount: 0, payNow: false },
    ]} />);
    expect(screen.getByText('Đã trả')).toBeInTheDocument();
    expect(screen.getByText('Trả 1 phần')).toBeInTheDocument();
    expect(screen.getByText('Chưa trả')).toBeInTheDocument();
    expect(screen.getByLabelText('Nhà cung cấp 1')).toBeDisabled();
    expect(screen.getByLabelText('Nhà cung cấp 3')).not.toBeDisabled();
    // Dòng đã trả đủ không có "Trả ngay"
    expect(screen.queryByLabelText('Trả ngay 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Trả ngay 2')).toBeInTheDocument();
    expect(total()).toMatch(/1\.035\.000/);
  });

  it('creates a supplier inline and selects it', async () => {
    const { calls } = mockApi({ 'POST /suppliers': ({ body }) => ({ id: 99, ...body }) });
    render(<Harness initial={[{ _key: 'a', supplierId: '', label: 'Phí down', amount: '', dueDate: '', paidAmount: 0, payNow: false }]} />);
    fireEvent.change(screen.getByLabelText('Nhà cung cấp 1'), { target: { value: '__new' } });
    const panel = screen.getByRole('group', { name: 'Thêm nhà cung cấp' });
    // Nhãn "Phí down" → gợi ý loại "down"
    expect(within(panel).getByLabelText('Loại')).toHaveValue('down');
    await userEvent.type(within(panel).getByLabelText(/Tên/), 'Down Mới');
    await userEvent.click(within(panel).getByRole('button', { name: 'Lưu nhà cung cấp' }));
    await waitFor(() => expect(captured.items[0].supplierId).toBe('99'));
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ name: 'Down Mới', kind: 'down' });
    expect(screen.queryByRole('group', { name: 'Thêm nhà cung cấp' })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Nhà cung cấp 1')).getByText('Down Mới')).toBeInTheDocument();
  });
});
