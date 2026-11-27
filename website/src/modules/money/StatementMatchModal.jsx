import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Plus, ScanSearch, Upload } from 'lucide-react';
import { useFeedback } from '../../ui/FeedbackContext';
import { Badge, Button, ErrorBanner, Field, Modal, Select, Skeleton } from '../../ui';
import { accountsApi } from '../../services/money';
import { autoMapColumns, readSpreadsheet } from '../../utils/excel';
import { formatCurrency, formatDate } from '../../utils/format';
import EntryModal from './EntryModal';
import {
  STATEMENT_FIELDS, mappingReady, matchStatement, parseStatementRows, reconcileItemsOf,
} from './statementMatch';

/**
 * Khớp sao kê: tải file Excel/CSV của ngân hàng → map cột → gợi ý khớp với các dòng sổ CHƯA đối soát
 * của tài khoản (cùng chiều, cùng số tiền, lệch ≤ 3 ngày) → xác nhận → PUT /accounts/reconcile-batch.
 * Dòng sao kê không khớp: tạo nhanh "Thu/chi khác".
 * Props: account ({ id, name }), onClose, onDone().
 */
export default function StatementMatchModal({ account, onClose, onDone }) {
  const { toast } = useFeedback();
  const [ledger, setLedger] = useState(null);
  const [ledgerError, setLedgerError] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');
  const [unticked, setUnticked] = useState(() => new Set()); // idx dòng sao kê người dùng bỏ khớp
  const [entryPrefill, setEntryPrefill] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadLedger = useCallback(() => {
    let alive = true;
    accountsApi.ledger(account.id)
      .then((d) => { if (alive) { setLedger(d?.rows || []); setLedgerError(''); } })
      .catch((err) => { if (alive) { setLedger([]); setLedgerError(err.message); } });
    return () => { alive = false; };
  }, [account.id]);
  useEffect(() => loadLedger(), [loadLedger]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    try {
      const { headers: hs, rows } = await readSpreadsheet(file);
      if (!rows.length) { setParseError('File rỗng hoặc không đọc được dữ liệu.'); return; }
      setFileName(file.name);
      setHeaders(hs);
      setRawRows(rows);
      setMapping(autoMapColumns(STATEMENT_FIELDS, hs));
      setUnticked(new Set());
    } catch (err) {
      setParseError(`Không đọc được file: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const ready = mappingReady(mapping);
  const stmtRows = useMemo(() => (ready ? parseStatementRows(rawRows, mapping) : []), [ready, rawRows, mapping]);
  const matches = useMemo(() => matchStatement(stmtRows, ledger || []), [stmtRows, ledger]);
  const chosen = stmtRows.filter((s) => matches.has(s.idx) && !unticked.has(s.idx));
  const unmatchedCount = stmtRows.length - matches.size;

  const toggle = (idx, on) => setUnticked((prev) => {
    const next = new Set(prev);
    if (on) next.delete(idx); else next.add(idx);
    return next;
  });

  const confirmMatch = async () => {
    const items = reconcileItemsOf(chosen.map((s) => matches.get(s.idx)));
    if (!items.length) return;
    setSaving(true);
    try {
      const res = await accountsApi.reconcileBatch(items);
      toast.success(`Đã đối soát ${res?.updated ?? items.length} giao dịch`);
      onDone?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setMap = (key, value) => setMapping((m) => ({ ...m, [key]: value }));

  return (
    <>
      <Modal
        open={!entryPrefill}
        onClose={onClose}
        icon={ScanSearch}
        size="xl"
        title={`Khớp sao kê · ${account.name}`}
        subtitle="Tải sao kê ngân hàng (Excel/CSV) để tự đánh dấu các giao dịch đã khớp"
        footer={(
          <>
            <Button variant="secondary" onClick={onClose}>Đóng</Button>
            <Button icon={CheckCircle2} loading={saving} disabled={!chosen.length} onClick={confirmMatch}>
              Xác nhận khớp {chosen.length} dòng
            </Button>
          </>
        )}
      >
        <ErrorBanner message={ledgerError} onRetry={loadLedger} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-surface-border px-4 py-3 text-sm font-medium text-ink-soft hover:bg-surface-subtle">
            <Upload size={16} /> {fileName ? 'Chọn file khác' : 'Chọn file sao kê (.xlsx, .xls, .csv)'}
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" aria-label="File sao kê" onChange={handleFile} />
          </label>
          {fileName && <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted"><FileSpreadsheet size={15} />{fileName} · {rawRows.length} dòng</span>}
        </div>
        {parseError && <p className="mt-2 text-sm text-danger-600">{parseError}</p>}

        {headers.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-ink">Cột trong file</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              {STATEMENT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} htmlFor={`sm-${f.key}`}>
                  <Select id={`sm-${f.key}`} size="sm" value={mapping[f.key] || ''} onChange={(e) => setMap(f.key, e.target.value)}>
                    <option value="">— Không có —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            {!ready && <p className="mt-2 text-sm text-warning-700">Chọn cột Ngày và cột Số tiền (hoặc Ghi có / Ghi nợ).</p>}
          </div>
        )}

        {ready && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">{matches.size} khớp</Badge>
              <Badge tone={unmatchedCount ? 'warning' : 'gray'}>{unmatchedCount} không khớp</Badge>
              <span className="text-ink-muted">So với {ledger ? ledger.filter((r) => !r.reconciled).length : '…'} giao dịch chưa đối soát trong sổ</span>
            </div>
            {ledger === null ? (
              <Skeleton className="h-24 w-full" />
            ) : stmtRows.length === 0 ? (
              <p className="rounded-lg bg-surface-muted px-3 py-3 text-sm text-ink-muted">Không đọc được dòng nào có số tiền.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-surface-border">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="bg-surface-muted text-[11.5px] uppercase tracking-wide text-ink-muted">
                      <th className="w-9 px-3 py-2" />
                      <th className="px-3 py-2 text-left">Ngày</th>
                      <th className="px-3 py-2 text-left">Nội dung sao kê</th>
                      <th className="px-3 py-2 text-right">Số tiền</th>
                      <th className="px-3 py-2 text-left">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {stmtRows.map((s) => {
                      const m = matches.get(s.idx);
                      const on = m && !unticked.has(s.idx);
                      return (
                        <tr key={s.idx} data-testid={`stmt-${s.idx}`} className={on ? 'bg-success-50/40' : ''}>
                          <td className="px-3 py-2">
                            {m && (
                              <input
                                type="checkbox"
                                aria-label={`Khớp dòng ${s.idx + 1}`}
                                checked={!!on}
                                onChange={(e) => toggle(s.idx, e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-success-600 cursor-pointer"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{s.date ? formatDate(s.date) : <span className="text-danger-600">{s.error}</span>}</td>
                          <td className="px-3 py-2 max-w-[260px] truncate" title={s.description}>{s.description || '—'}</td>
                          <td className={`px-3 py-2 text-right tabular font-semibold ${s.direction === 'out' ? 'text-danger-600' : 'text-success-600'}`}>
                            {s.direction === 'out' ? '−' : '+'}{formatCurrency(s.amount)}
                          </td>
                          <td className="px-3 py-2">
                            {m ? (
                              <span className="inline-flex min-w-0 max-w-[300px] items-center gap-1.5">
                                <Badge tone="success">Khớp</Badge>
                                <span className="truncate text-ink-soft" title={m.description}>{formatDate(m.date)} · {m.description || m.kind}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <Badge tone="warning">Không khớp</Badge>
                                {s.date && (
                                  <Button
                                    size="xs"
                                    variant="soft"
                                    icon={Plus}
                                    onClick={() => setEntryPrefill({ accountId: account.id, direction: s.direction, amount: s.amount, entryDate: s.date, notes: s.description })}
                                  >
                                    Tạo thu/chi khác
                                  </Button>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {entryPrefill && (
        <EntryModal
          initial={entryPrefill}
          onClose={() => setEntryPrefill(null)}
          onSaved={() => { onDone?.(); loadLedger(); }}
        />
      )}
    </>
  );
}
