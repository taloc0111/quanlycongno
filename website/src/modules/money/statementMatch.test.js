import { describe, it, expect } from 'vitest';
import {
  STATEMENT_FIELDS, mappingReady, matchStatement, parseAmount, parseStatementDate, parseStatementRows, reconcileItemsOf,
} from './statementMatch';
import { autoAllocate, ledgerDeletable, reconcileKindOf } from './moneyUtils';
import { autoMapColumns } from '../../utils/excel';

describe('parseAmount', () => {
  it.each([
    ['1.000.000', 1000000],
    ['-500,000', -500000],
    ['500.000đ', 500000],
    ['1,000,000.50', 1000000.5],
    ['1.000.000,50', 1000000.5],
    ['(200.000)', -200000],
    ['250000', 250000],
    ['22.000 VND', 22000],
    ['1.5', 1.5],
    [1200000, 1200000],
    ['', null],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('parseStatementDate', () => {
  it('reads dd/mm/yyyy (with time), ISO, Date and Excel serials', () => {
    expect(parseStatementDate('02/11/2026')).toBe('2026-11-02');
    expect(parseStatementDate('2/11/2026 14:35:00')).toBe('2026-11-02');
    expect(parseStatementDate('2026-11-05')).toBe('2026-11-05');
    expect(parseStatementDate(new Date(2026, 10, 7))).toBe('2026-11-07');
    expect(parseStatementDate(46000)).toBe('2025-12-09');
    expect(parseStatementDate('không phải ngày')).toBe('');
  });
});

describe('statement columns', () => {
  it('auto-maps common Vietnamese/English bank headers', () => {
    const m = autoMapColumns(STATEMENT_FIELDS, ['Ngày giao dịch', 'Ghi nợ', 'Ghi có', 'Mô tả', 'Số dư']);
    expect(m).toMatchObject({ date: 'Ngày giao dịch', debit: 'Ghi nợ', credit: 'Ghi có', description: 'Mô tả', amount: '' });
    expect(mappingReady(m)).toBe(true);
    expect(mappingReady({ date: 'Ngày' })).toBe(false);
    expect(autoMapColumns(STATEMENT_FIELDS, ['Date', 'Amount', 'Description'])).toMatchObject({ date: 'Date', amount: 'Amount', description: 'Description' });
  });

  it('parses rows with a signed amount column or credit/debit columns, skipping rows without money', () => {
    const signed = parseStatementRows(
      [{ D: '01/11/2026', A: '1.000.000', N: 'CK ve' }, { D: '02/11/2026', A: '-22.000', N: 'Phi SMS' }, { D: '', A: '', N: 'Tổng' }],
      { date: 'D', amount: 'A', description: 'N' },
    );
    expect(signed).toEqual([
      { idx: 0, date: '2026-11-01', direction: 'in', amount: 1000000, description: 'CK ve', error: '' },
      { idx: 1, date: '2026-11-02', direction: 'out', amount: 22000, description: 'Phi SMS', error: '' },
    ]);
    const split = parseStatementRows(
      [{ D: '03/11/2026', C: '', Dr: '500.000' }, { D: 'x', C: '300,000', Dr: '' }],
      { date: 'D', credit: 'C', debit: 'Dr' },
    );
    expect(split.map((r) => [r.direction, r.amount, r.date, r.error])).toEqual([
      ['out', 500000, '2026-11-03', ''],
      ['in', 300000, '', 'Không đọc được ngày'],
    ]);
  });
});

describe('matchStatement', () => {
  const ledger = [
    { kind: 'payment', id: 1, date: '2026-11-01', direction: 'in', amount: '500000.00', reconciled: false },
    { kind: 'receipt', id: 2, date: '2026-11-04', direction: 'in', amount: '500000.00', reconciled: false },
    { kind: 'entry_out', id: 3, date: '2026-11-05', direction: 'out', amount: '22000', reconciled: false },
    { kind: 'transfer_out', id: 4, date: '2026-11-03', direction: 'out', amount: '1000000', reconciled: true },
    { kind: 'supplier_payment', id: 5, date: '2026-11-20', direction: 'out', amount: '700000', reconciled: false },
  ];

  it('matches same direction + amount within 3 days, one-to-one, closest date first', () => {
    const stmt = [
      { idx: 0, date: '2026-11-03', direction: 'in', amount: 500000, error: '' }, // gần receipt (1 ngày) hơn payment (2 ngày)
      { idx: 1, date: '2026-11-02', direction: 'in', amount: 500000, error: '' }, // còn payment (1 ngày)
      { idx: 2, date: '2026-11-05', direction: 'in', amount: 22000, error: '' }, // sai chiều
      { idx: 3, date: '2026-11-03', direction: 'out', amount: 1000000, error: '' }, // dòng sổ đã đối soát
      { idx: 4, date: '2026-11-10', direction: 'out', amount: 700000, error: '' }, // lệch 10 ngày
      { idx: 5, date: '2026-11-08', direction: 'out', amount: 22000, error: '' }, // lệch đúng 3 ngày
    ];
    const m = matchStatement(stmt, ledger);
    expect([...m.entries()].map(([i, l]) => [i, `${l.kind}-${l.id}`]).sort()).toEqual([
      [0, 'receipt-2'],
      [1, 'payment-1'],
      [5, 'entry_out-3'],
    ]);
  });

  it('never matches one ledger row twice', () => {
    const stmt = [
      { idx: 0, date: '2026-11-05', direction: 'out', amount: 22000, error: '' },
      { idx: 1, date: '2026-11-05', direction: 'out', amount: 22000, error: '' },
    ];
    const m = matchStatement(stmt, ledger);
    expect(m.size).toBe(1);
    expect(m.get(0).id).toBe(3);
  });

  it('builds reconcile-batch items with the contract kinds (deduplicated)', () => {
    const rows = [
      { kind: 'payment', id: 1 }, { kind: 'customer_refund', id: 9 }, { kind: 'receipt', id: 2 },
      { kind: 'topup', id: 3 }, { kind: 'refund', id: 4 }, { kind: 'supplier_payment', id: 5 }, { kind: 'supplier_refund', id: 6 },
      { kind: 'transfer_in', id: 7 }, { kind: 'transfer_out', id: 7 }, { kind: 'entry_in', id: 8 }, { kind: 'entry_out', id: 8 },
    ];
    expect(reconcileItemsOf(rows)).toEqual([
      { kind: 'payment', id: 1, reconciled: true },
      { kind: 'payment', id: 9, reconciled: true },
      { kind: 'receipt', id: 2, reconciled: true },
      { kind: 'wallet', id: 3, reconciled: true },
      { kind: 'wallet', id: 4, reconciled: true },
      { kind: 'supplier_payment', id: 5, reconciled: true },
      { kind: 'supplier_payment', id: 6, reconciled: true },
      { kind: 'transfer_in', id: 7, reconciled: true },
      { kind: 'transfer_out', id: 7, reconciled: true },
      { kind: 'entry', id: 8, reconciled: true },
    ]);
  });
});

describe('moneyUtils v3.1', () => {
  it('maps ledger kinds to reconcile kinds and knows which rows can be deleted on the ledger', () => {
    expect(['payment', 'customer_refund', 'receipt', 'topup', 'refund', 'supplier_payment', 'supplier_refund', 'transfer_in', 'transfer_out', 'entry_in', 'entry_out'].map(reconcileKindOf))
      .toEqual(['payment', 'payment', 'receipt', 'wallet', 'wallet', 'supplier_payment', 'supplier_payment', 'transfer_in', 'transfer_out', 'entry', 'entry']);
    expect(['receipt', 'transfer_in', 'transfer_out', 'entry_in', 'entry_out'].every(ledgerDeletable)).toBe(true);
    expect(['payment', 'topup', 'supplier_payment', 'customer_refund'].some(ledgerDeletable)).toBe(false);
  });

  it('autoAllocate fills oldest first up to the amount', () => {
    const rows = [{ key: 'a', remaining: '1000000' }, { key: 'b', remaining: 500000 }, { key: 'c', remaining: 2000000 }];
    expect(autoAllocate(rows, 1700000)).toEqual({ a: 1000000, b: 500000, c: 200000 });
    expect(autoAllocate(rows, 400000)).toEqual({ a: 400000 });
    expect(autoAllocate(rows, 0)).toEqual({});
  });
});
