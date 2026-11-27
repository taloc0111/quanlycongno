import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardApp from '../../DashboardApp';
import { mockApi } from '../../test/mockApi';
import { addDays, today } from '../../utils/format';
import { ME, renderWithApp, setupSession } from './testUtils';

const BASE = {
  totalAmount: '10000000', totalPaid: '6000000', totalProfit: '1500000', outstanding: '4000000', overdue: '0',
  counts: { debts: 3, passports: 0, trainTickets: 0, tours: 0, customers: 2 },
  monthly: [], byType: {}, topDebtors: [],
  todo: { flightsTomorrow: [], dueSoon: [], overdue: [] },
};

beforeEach(setupSession);

describe('DashboardApp — dòng tiền', () => {
  it('renders the money cards and new todo sections when the fields exist', async () => {
    mockApi({
      'GET /stats': {
        ...BASE,
        costPendingCount: 2, supplierOwed: '1505000', walletTotal: '300000', othersHolding: '1200000',
        todo: {
          ...BASE.todo,
          costPending: [{ type: 'passport', id: 5, customer_name: 'Lê Văn C', issue_date: '2026-11-20', amount: '2000000' }],
          supplierDue: [{ supplier_id: 3, supplier_name: 'F1 Thùy Dương', label: 'Giá vé F1', amount_due: '1500000', due_date: addDays(today(), 2), target_label: 'VN123 HAN-SGN' }],
        },
      },
      'GET /users': [],
      'GET /auth/profile': ME,
    });
    renderWithApp(<DashboardApp />);
    expect(await screen.findByText('Nợ nhà cung cấp')).toBeInTheDocument();
    expect(screen.getByText('Tiền ở TK người khác')).toBeInTheDocument();
    expect(screen.getByText('Ví khách đang giữ')).toBeInTheDocument();
    expect(screen.getByText('Không tính 2 dòng chưa đủ giá vốn')).toBeInTheDocument();
    expect(screen.getByText('Chưa đủ giá vốn')).toBeInTheDocument();
    expect(screen.getByText('Lê Văn C')).toBeInTheDocument();
    expect(screen.getByText('Sắp đến hạn trả NCC')).toBeInTheDocument();

    await userEvent.click(screen.getByText('F1 Thùy Dương'));
    await waitFor(() => expect(window.location.hash).toBe('#suppliers/3'));
    await userEvent.click(screen.getByText('Lê Văn C'));
    await waitFor(() => expect(window.location.hash).toBe('#passport'));
    await userEvent.click(screen.getByText('Ví khách đang giữ'));
    await waitFor(() => expect(window.location.hash).toBe('#wallets'));
  });

  it('does not crash and hides the new pieces on an old backend', async () => {
    mockApi({ 'GET /stats': BASE, 'GET /users': [], 'GET /auth/profile': ME });
    renderWithApp(<DashboardApp />);
    expect(await screen.findByText('Tổng phải thu')).toBeInTheDocument();
    expect(screen.queryByText('Nợ nhà cung cấp')).not.toBeInTheDocument();
    expect(screen.queryByText('Chưa đủ giá vốn')).not.toBeInTheDocument();
    expect(screen.queryByText(/chưa đủ giá vốn/)).not.toBeInTheDocument();
  });
});
