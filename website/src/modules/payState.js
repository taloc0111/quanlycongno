import { num, today } from '../utils/format';

/**
 * Trạng thái thanh toán của 1 dòng theo config module (amountKey/paidKey/dueKey).
 * @returns {{ total:number, paid:number, remaining:number, isPaid:boolean, overdue:boolean, status:'overdue'|'paid'|'partial'|'unpaid' }}
 */
export function payState(row, cfg) {
  const total = num(row[cfg.amountKey]);
  const paid = num(row[cfg.paidKey]);
  const remaining = total - paid;
  const isPaid = remaining <= 0;
  const due = row[cfg.dueKey];
  const overdue = !isPaid && !!due && due < today();
  const status = overdue ? 'overdue' : isPaid ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { total, paid, remaining, isPaid, overdue, status };
}
