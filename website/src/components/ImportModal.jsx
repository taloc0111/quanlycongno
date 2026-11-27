import { useMemo, useState } from 'react';
import { Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { readSpreadsheet, autoMapColumns, downloadTemplate } from '../utils/excel';
import { useFeedback } from '../ui/FeedbackContext';
import { Button, Select, Modal, Badge, ErrorBanner } from '../ui';

const TH = 'px-3 py-2 text-left font-semibold whitespace-nowrap';

/**
 * Modal import dữ liệu từ Excel/CSV — tái sử dụng cho nợ vé / hộ chiếu / khách hàng.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - title: string
 *  - templateName: string                    tên file template tải về
 *  - fields: [{ key, label, required, aliases? }]
 *  - sampleRow?: Record<key, any>            dòng ví dụ trong template
 *  - onImport: (rows) => Promise<{inserted, failed, skipped?, errors?}>
 *  - onSuccess?: () => void                   gọi sau khi import xong (vd: tải lại danh sách)
 */
export default function ImportModal({
  open,
  onClose,
  title,
  templateName,
  fields,
  sampleRow,
  onImport,
  onSuccess,
}) {
  const { toast } = useFeedback();
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  function reset() {
    setFileName('');
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    setParseError('');
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setResult(null);
    try {
      const { headers: hs, rows } = await readSpreadsheet(file);
      if (rows.length === 0) {
        setParseError('File rỗng hoặc không đọc được dữ liệu.');
        return;
      }
      setFileName(file.name);
      setHeaders(hs);
      setRawRows(rows);
      setMapping(autoMapColumns(fields, hs));
    } catch (err) {
      setParseError('Không đọc được file: ' + err.message);
    } finally {
      e.target.value = '';
    }
  }

  // Chuyển dữ liệu thô sang đúng field key theo mapping hiện tại.
  const mappedRows = useMemo(() => {
    if (rawRows.length === 0) return [];
    return rawRows.map((r) => {
      const o = {};
      for (const f of fields) {
        const col = mapping[f.key];
        o[f.key] = col ? r[col] : '';
      }
      return o;
    });
  }, [rawRows, mapping, fields]);

  // Đếm lỗi thiếu trường bắt buộc (kiểm tra sơ bộ phía client).
  const clientErrors = useMemo(() => {
    const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
    let count = 0;
    mappedRows.forEach((row) => {
      if (requiredKeys.some((k) => String(row[k] ?? '').trim() === '')) count += 1;
    });
    return count;
  }, [mappedRows, fields]);

  const unmappedRequired = fields.filter((f) => f.required && !mapping[f.key]);

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await onImport(mappedRows);
      setResult(res);
      if (res.inserted > 0) {
        toast.success(`Đã import ${res.inserted} dòng`);
        onSuccess?.();
      } else if (res.failed) {
        toast.warning('Không import được dòng nào — xem chi tiết lỗi bên dưới');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Import thất bại';
      setResult({ inserted: 0, failed: mappedRows.length, errors: [{ row: '-', message: msg }] });
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const downloadSample = () =>
    downloadTemplate(templateName, fields, sampleRow).catch((err) => toast.error('Không tạo được file mẫu: ' + err.message));

  const fmt = (v) => {
    if (v instanceof Date) return v.toLocaleDateString('vi-VN');
    return String(v ?? '');
  };

  const hasFile = headers.length > 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      icon={FileSpreadsheet}
      title={title}
      subtitle="Bước 1 chọn file → Bước 2 ghép cột → Import"
      size="xl"
      footer={(
        <>
          <Button variant="secondary" onClick={handleClose}>{result ? 'Đóng' : 'Huỷ'}</Button>
          {hasFile && !result && (
            <Button icon={Upload} loading={submitting} disabled={mappedRows.length === 0} onClick={handleSubmit}>
              Import {mappedRows.length} dòng
            </Button>
          )}
          {result && result.inserted === 0 && (
            <Button variant="secondary" onClick={() => setResult(null)}>Sửa lại và thử lại</Button>
          )}
        </>
      )}
    >
      <div className="space-y-5">
        {/* Bước 1: chọn file + tải template */}
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-within:ring-2 focus-within:ring-brand-500/40">
            <Upload size={17} /> Chọn file Excel/CSV
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="sr-only" />
          </label>
          <Button variant="secondary" icon={Download} onClick={downloadSample}>Tải file mẫu</Button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
              <FileText size={15} className="text-ink-faint" />
              <span className="font-medium text-ink truncate max-w-[220px]" title={fileName}>{fileName}</span>
              <Badge tone="gray">{rawRows.length} dòng</Badge>
            </span>
          )}
        </div>

        <ErrorBanner message={parseError} />

        {!hasFile && !parseError && (
          <div className="rounded-xl border border-dashed border-surface-border bg-surface-muted px-4 py-8 text-center text-sm text-ink-muted">
            <FileSpreadsheet size={28} className="mx-auto mb-2 text-ink-faint" />
            Chọn file để bắt đầu. Chưa có file? Tải <button type="button" onClick={downloadSample} className="link">file mẫu</button> rồi điền dữ liệu.
          </div>
        )}

        {/* Bước 2: ghép cột */}
        {hasFile && !result && (
          <>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-ink">Ghép cột dữ liệu</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {fields.map((f) => {
                  const missing = f.required && !mapping[f.key];
                  return (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className={`w-36 shrink-0 text-[13px] ${missing ? 'text-danger-600 font-medium' : 'text-ink-soft'}`}>
                        {f.label}{f.required && <span className="text-danger-500"> *</span>}
                      </span>
                      <div className="flex-1 min-w-0">
                        <Select size="sm" value={mapping[f.key] || ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })} className={missing ? 'input-error' : ''}>
                          <option value="">— bỏ qua —</option>
                          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
              {unmappedRequired.length > 0 && (
                <p className="mt-2 flex items-center gap-1 text-xs text-danger-600">
                  <AlertTriangle size={13} /> Chưa ghép cột bắt buộc: {unmappedRequired.map((f) => f.label).join(', ')}.
                </p>
              )}
            </div>

            {/* Preview 5 dòng đầu */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-ink">Xem trước</h4>
                <span className="text-xs text-ink-faint">5 / {mappedRows.length} dòng</span>
              </div>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max text-[13px]">
                    <thead>
                      <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                        <th className={`${TH} w-10 text-ink-faint`}>#</th>
                        {fields.map((f) => <th key={f.key} className={TH}>{f.label}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {mappedRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="hover:bg-surface-muted">
                          <td className="px-3 py-1.5 text-ink-faint tabular">{i + 1}</td>
                          {fields.map((f) => {
                            const val = fmt(row[f.key]);
                            const bad = f.required && val.trim() === '';
                            return (
                              <td key={f.key} className={`px-3 py-1.5 whitespace-nowrap max-w-[220px] truncate ${bad ? 'text-danger-600 italic' : ''}`} title={val}>
                                {bad ? 'thiếu' : val}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {clientErrors > 0 && (
                <p className="mt-2 flex items-center gap-1 text-sm text-warning-600">
                  <AlertTriangle size={15} /> {clientErrors} dòng thiếu trường bắt buộc — sẽ bị bỏ qua khi import.
                </p>
              )}
            </div>
          </>
        )}

        {/* Kết quả */}
        {result && (
          <div className="space-y-3">
            <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 ${result.inserted > 0 ? 'border-success-100 bg-success-50 text-success-700' : 'border-danger-100 bg-danger-50 text-danger-700'}`}>
              {result.inserted > 0 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <span className="font-semibold">{result.inserted > 0 ? 'Import xong' : 'Import thất bại'}</span>
              <span className="ml-auto flex flex-wrap gap-1.5">
                <Badge tone="success">Thêm {result.inserted}</Badge>
                {result.skipped ? <Badge tone="gray">Trùng {result.skipped}</Badge> : null}
                {result.failed ? <Badge tone="danger">Lỗi {result.failed}</Badge> : null}
              </span>
            </div>
            {result.errors?.length > 0 && (
              <div className="card overflow-hidden">
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0">
                      <tr className="bg-surface-muted text-[12px] uppercase tracking-wide text-ink-muted">
                        <th className={`${TH} w-20`}>Dòng</th>
                        <th className={TH}>Lỗi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {result.errors.map((e, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 tabular text-ink-muted">{e.row}</td>
                          <td className="px-3 py-1.5 text-danger-600">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
