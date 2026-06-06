import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Edit2, Trash2, Upload, X, Users } from 'lucide-react';
import ImportModal from './components/ImportModal';
import AgencyFilter from './components/AgencyFilter';
import { apiGet, apiSend } from './services/client';
import { formatCurrency } from './utils/format';
import VnDatePicker from './components/VnDatePicker';
import { useAuth } from './auth/AuthContext';
import { useSort } from './hooks/useSort';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import { useToast, useConfirm } from './hooks/useFeedback';

const CUSTOMER_IMPORT_FIELDS = [
  { key: 'name', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên'] },
  { key: 'phone', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone', 'điện thoại'] },
  { key: 'email', label: 'Email', aliases: ['mail'] },
  { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'address'] },
  { key: 'idNumber', label: 'CCCD/CMND', aliases: ['cccd', 'cmnd', 'can cuoc', 'id'] },
  { key: 'type', label: 'Loại', aliases: ['type', 'phan loai'] },
];
const CUSTOMER_IMPORT_SAMPLE = {
  name: 'Nguyễn Văn A', phone: '0901234567', email: 'a@gmail.com',
  address: 'Hà Nội', idNumber: '0010xxxxxxxx', type: 'individual',
};

const EMPTY = { name: '', phone: '', email: '', address: '', idNumber: '', type: 'individual', creditLimit: '', notes: '', birthday: '', companyId: '' };

export default function CustomerApp() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [customers, setCustomers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);
  const sorter = useSort();
  const { toast, showToast } = useToast();
  const { confirmState, askConfirm, closeConfirm } = useConfirm();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setCustomers(await apiGet(`/customers${agencyId ? `?agencyId=${agencyId}` : ''}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [agencyId]);

  // Danh sách công ty (để gắn cho khách loại "Công ty").
  useEffect(() => { apiGet('/companies').then(setCompanies).catch(() => {}); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      const matchText = !q || c.name?.toLowerCase().includes(q) || c.phone?.includes(q);
      const matchCompany = !companyFilter || String(c.company_id) === companyFilter;
      return matchText && matchCompany;
    });
  }, [customers, search, companyFilter]);

  const sorted = sorter.sort(filtered, (c, k) =>
    k === 'name' ? (c.name || '').toLowerCase() : k === 'outstanding' ? Number(c.outstanding) || 0 : '');

  const selectableIds = sorted.filter(c => !currentUserId || c.user_id === currentUserId).map(c => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : selectableIds);

  // Phân trang phía client.
  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pagedCustomers = sorted.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, companyFilter, agencyId]);

  const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); };
  const openEdit = (c) => {
    setForm({
      name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
      idNumber: c.id_number || '', type: c.type || 'individual',
      creditLimit: c.credit_limit || '', notes: c.notes || '',
      birthday: (c.birthday || '').slice(0, 10),
      companyId: c.company_id || '',
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const save = async () => {
    if (form.type === 'company' && !form.companyId) { showToast('Vui lòng chọn công ty', 'error'); return; }
    if (!form.name.trim()) { showToast('Nhập tên khách hàng', 'error'); return; }
    try {
      if (editingId) await apiSend('PUT', `/customers/${editingId}`, form);
      else await apiSend('POST', '/customers', form);
      setShowForm(false);
      showToast(editingId ? 'Cập nhật khách hàng thành công' : 'Đã thêm khách hàng');
      load();
    } catch (err) {
      showToast('Lỗi: ' + err.message, 'error');
    }
  };

  const remove = (c) => {
    askConfirm(`Xóa khách hàng "${c.name}"?`, async () => {
      try {
        await apiSend('DELETE', `/customers/${c.id}`);
        setSelectedIds(prev => prev.filter(x => x !== c.id));
        showToast('Đã xóa khách hàng');
        load();
      } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    });
  };

  const toggleSelect = (id) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    askConfirm(`Xóa ${selectedIds.length} khách hàng đã chọn? Hành động này không thể hoàn tác.`, async () => {
      try {
        const data = await apiSend('POST', '/customers/bulk-delete', { ids: selectedIds });
        setSelectedIds([]);
        showToast(`Đã xóa ${data.deleted} khách hàng`);
        load();
      } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    }, { confirmText: `Xóa ${selectedIds.length} mục` });
  };

  const importCustomers = async (rows) => {
    const data = await apiSend('POST', '/customers/import', { rows }).catch((e) => e.response?.data || { error: e.message });
    return {
      inserted: data.inserted || 0,
      skipped: data.skipped || 0,
      failed: data.failed ?? (data.errors?.length || 0),
      errors: data.errors || (data.error ? [{ row: '-', message: data.error }] : []),
    };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Users /> Khách hàng
          </h2>
          <div className="flex gap-2">
            <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm">
              <Plus size={18} /> Thêm
            </button>
            <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-semibold text-sm">
              <Upload size={18} /> Import
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên hoặc SĐT…"
              className="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-sm bg-white"
          >
            <option value="">Tất cả công ty</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <AgencyFilter value={agencyId} onChange={setAgencyId} />
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
            <span className="text-sm font-medium text-red-700">Đã chọn {selectedIds.length} khách hàng</span>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 rounded-lg bg-white border text-gray-600 hover:bg-gray-50 text-sm font-semibold">Bỏ chọn</button>
              <button onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm font-semibold">
                <Trash2 size={15} /> Xóa đã chọn ({selectedIds.length})
              </button>
            </div>
          </div>
        )}

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          <div className="bg-white rounded-2xl shadow overflow-auto max-h-[70vh]">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10 [&_th]:bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 sticky left-0 z-20">
                    <span className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} title="Chọn tất cả" className="w-4 h-4 rounded cursor-pointer" />
                      <span onClick={() => sorter.toggle('name')} className="cursor-pointer select-none hover:text-gray-900">Tên{sorter.arrow('name')}</span>
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">SĐT</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">Đại lý</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Loại</th>
                  <th onClick={() => sorter.toggle('outstanding')} className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer select-none hover:bg-gray-100">Còn nợ{sorter.arrow('outstanding')}</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chưa có khách hàng.</td></tr>
                ) : pagedCustomers.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-gray-50 group">
                    <td className="px-4 py-3 font-medium text-gray-800 sticky left-0 z-10 bg-white group-hover:bg-gray-50">
                      <span className="inline-flex items-center gap-2">
                        {(!currentUserId || c.user_id === currentUserId) && (
                          <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} className="w-4 h-4 rounded cursor-pointer shrink-0" />
                        )}
                        {(!currentUserId || c.user_id === currentUserId) ? (
                          <span onClick={() => openEdit(c)} title="Bấm để sửa" className="cursor-pointer hover:underline">{c.name}</span>
                        ) : c.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{c.owner_name || c.owner_username || ''}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.type === 'company'
                        ? (companies.find((co) => String(co.id) === String(c.company_id))?.name || 'Công ty')
                        : 'Cá nhân'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatCurrency(c.outstanding)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {(!currentUserId || c.user_id === currentUserId) ? (
                        <>
                          <button onClick={() => openEdit(c)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
                          <button onClick={() => remove(c)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Chỉ xem</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-gray-50 text-xs sm:text-sm">
                <span className="text-gray-500">
                  {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, sorted.length)} / {sorted.length} khách
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1} className="px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100 font-semibold">Trước</button>
                  <span className="px-2 text-gray-600">Trang {curPage}/{totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages} className="px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100 font-semibold">Sau</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-bold">{editingId ? 'Sửa khách hàng' : 'Thêm khách hàng'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700"><X size={22} /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Loại</label>
                <select
                  value={form.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    // Khách lẻ thì bỏ liên kết công ty; "thuộc công ty" thì chờ chọn ở dropdown.
                    setForm(type === 'individual' ? { ...form, type, companyId: '' } : { ...form, type });
                  }}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="individual">Cá nhân (khách lẻ)</option>
                  <option value="company">Thuộc công ty</option>
                </select>
              </div>

              {form.type === 'company' && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Công ty *</label>
                  <select
                    value={form.companyId}
                    onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">— Chọn công ty —</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {companies.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">Chưa có công ty. Tạo ở mục Công nợ vé → nút “Công ty”.</p>
                  )}
                </div>
              )}

              {/* Thông tin từng khách bay — luôn là một cá nhân, luôn nhập được. */}
              {[
                ['name', 'Tên khách hàng *'], ['phone', 'Số điện thoại'],
                ['email', 'Email'], ['address', 'Địa chỉ'], ['idNumber', 'CCCD/CMND'],
              ].map(([k, label]) => (
                <div key={k}>
                  <label className="block text-sm text-gray-600 mb-1">{label}</label>
                  <input
                    value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ngày sinh</label>
                <VnDatePicker value={form.birthday} onChange={(v) => setForm({ ...form, birthday: v })} />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-200 rounded-lg font-semibold text-sm">Huỷ</button>
              <button onClick={save} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm">Lưu</button>
            </div>
          </div>
        </div>
      )}

      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import khách hàng từ Excel/CSV"
        templateName="mau-import-khach-hang.xlsx"
        fields={CUSTOMER_IMPORT_FIELDS}
        sampleRow={CUSTOMER_IMPORT_SAMPLE}
        onImport={importCustomers}
        onSuccess={load}
      />

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText}
        onCancel={closeConfirm}
        onConfirm={() => { confirmState?.onConfirm?.(); closeConfirm(); }}
      />
      <Toast toast={toast} />
    </div>
  );
}
