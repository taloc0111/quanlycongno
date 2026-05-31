import React, { useState, useEffect } from 'react';
import { Plus, LogOut, Edit2, Trash2, Check, X, Search, Filter, TrendingUp, Users, DollarSign, AlertCircle, FileText, Upload } from 'lucide-react';
import ImportModal from './components/ImportModal';
import AgencyFilter from './components/AgencyFilter';
import { useAuth } from './auth/AuthContext';

// Cấu hình cột import hộ chiếu (khớp key với backend /passports/import).
const PASSPORT_IMPORT_FIELDS = [
  { key: 'customerName', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên'] },
  { key: 'passportNumber', label: 'Số hộ chiếu', aliases: ['so ho chieu', 'passport', 'số HC'] },
  { key: 'phoneNumber', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone', 'điện thoại'] },
  { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'address'] },
  { key: 'serviceDate', label: 'Ngày làm', required: true, aliases: ['ngay lam', 'ngày dịch vụ', 'service date', 'ngày'] },
  { key: 'totalAmount', label: 'Tổng tiền', required: true, aliases: ['tong tien', 'so tien', 'số tiền', 'amount'] },
  { key: 'paidAmount', label: 'Đã trả', aliases: ['da tra', 'đã thanh toán', 'paid'] },
  { key: 'notes', label: 'Ghi chú', aliases: ['ghi chu', 'note', 'notes'] },
];

const PASSPORT_IMPORT_SAMPLE = {
  customerName: 'Trần Thị B', passportNumber: 'C1234567', phoneNumber: '0912345678',
  address: 'Hà Nội', serviceDate: '15/12/2025', totalAmount: 1200000, paidAmount: 0, notes: 'Làm mới',
};

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const API_URL = `${API_BASE}/passports`;

const formatDateDisplay = (dateString) => {
  if (!dateString) return '';
  if (dateString.includes('T')) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  }
  return dateString;
};

const formatCurrency = (value) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value || 0);
};

export default function PassportApp() {
  const [passports, setPassports] = useState([]);
  const [token, setToken] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id;
  const [agencyId, setAgencyId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMonth, setFilterMonth] = useState('');

  const [formData, setFormData] = useState({
    passportNumber: '',
    customerName: '',
    phoneNumber: '',
    address: '',
    serviceDate: '',
    totalAmount: '',
    paidAmount: '',
    notes: ''
  });

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('currentUser');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setCurrentUser(savedUser);
      loadData(savedToken);
    }
  }, []);

  // Tải lại khi đổi bộ lọc đại lý.
  useEffect(() => {
    if (token) loadData(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  const getHeaders = () => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  const loadData = async (authToken) => {
    try {
      const res = await fetch(`${API_URL}${agencyId ? `?agencyId=${agencyId}` : ''}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        setPassports(await res.json());
      }
    } catch (error) {
      console.error('Load data error:', error);
    }
  };

  // Gọi API import hộ chiếu; chuẩn hoá kết quả cho ImportModal.
  const importPassportsFromRows = async (rows) => {
    const res = await fetch(`${API_URL}/import`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ rows }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.inserted === undefined && !data.errors) {
      throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
    }
    return {
      inserted: data.inserted || 0,
      failed: data.failed ?? (data.errors?.length || 0),
      errors: data.errors || (data.error ? [{ row: '-', message: data.error }] : []),
    };
  };

  const handleSubmit = async () => {
    if (!formData.customerName || !formData.serviceDate || !formData.totalAmount) {
      alert('⚠️ Vui lòng nhập đầy đủ thông tin bắt buộc');
      return;
    }

    const url = editingId ? `${API_URL}/${editingId}` : API_URL;
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: getHeaders(),
        body: JSON.stringify({
          passportNumber: formData.passportNumber,
          customerName: formData.customerName,
          phoneNumber: formData.phoneNumber,
          address: formData.address,
          serviceDate: formData.serviceDate,
          totalAmount: parseFloat(formData.totalAmount),
          paidAmount: parseFloat(formData.paidAmount) || 0,
          notes: formData.notes
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (editingId) {
          setPassports(passports.map(p => p.id === editingId ? data : p));
        } else {
          setPassports([...passports, data]);
        }
        resetForm();
        alert('✅ Thành công!');
      }
    } catch (error) {
      alert('❌ Lỗi: ' + error.message);
    }
  };

  const handleEdit = (passport) => {
    setFormData({
      passportNumber: passport.passport_number || '',
      customerName: passport.customer_name,
      phoneNumber: passport.phone_number,
      address: passport.address || '',
      serviceDate: passport.service_date,
      totalAmount: passport.total_amount,
      paidAmount: passport.paid_amount,
      notes: passport.notes
    });
    setEditingId(passport.id);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (confirm('Xóa bản ghi này?')) {
      fetch(`${API_URL}/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      }).then(() => {
        setPassports(passports.filter(p => p.id !== id));
        alert('✅ Xóa thành công');
      });
    }
  };

  const resetForm = () => {
    setFormData({
      passportNumber: '',
      customerName: '',
      phoneNumber: '',
      address: '',
      serviceDate: '',
      totalAmount: '',
      paidAmount: '',
      notes: ''
    });
    setEditingId(null);
    setShowForm(false);
  };

  const getDebtStatus = (debt) => {
    if (debt <= 0) return 'paid';
    if (debt > 0) return 'pending';
    return 'overpaid';
  };

  const filteredData = passports.filter(p => {
    const matchesSearch = p.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.phone_number && p.phone_number.includes(searchTerm)) ||
      (p.passport_number && p.passport_number.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const debt = p.total_amount - p.paid_amount;
    const status = getDebtStatus(debt);
    const matchesStatus = filterStatus === 'all' || status === filterStatus;

    let matchesMonth = true;
    if (filterMonth) {
      const pDate = new Date(p.service_date);
      const [year, month] = filterMonth.split('-');
      matchesMonth = pDate.getMonth() + 1 === parseInt(month) && pDate.getFullYear() === parseInt(year);
    }

    return matchesSearch && matchesStatus && matchesMonth;
  });

  const stats = {
    customers: new Set(filteredData.map(p => p.customer_name)).size,
    revenue: filteredData.reduce((sum, p) => sum + p.total_amount, 0),
    paid: filteredData.reduce((sum, p) => sum + p.paid_amount, 0),
  };
  stats.debt = stats.revenue - stats.paid;

  const paidCount = filteredData.filter(p => (p.total_amount - p.paid_amount) <= 0).length;
  const pendingCount = filteredData.filter(p => (p.total_amount - p.paid_amount) > 0).length;

  const StatCard = ({ icon: Icon, label, value, color, subtext }) => (
    <div className={`bg-gradient-to-br ${color} rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1`}>
      <div className="flex items-start justify-between mb-4">
        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
          <Icon size={24} />
        </div>
        {subtext && <span className="text-xs bg-white/20 px-2 py-1 rounded-full">{subtext}</span>}
      </div>
      <p className="text-sm font-medium text-white/80 mb-1">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );

  const StatusBadge = ({ status }) => {
    const styles = {
      paid: 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border border-green-200',
      pending: 'bg-gradient-to-r from-red-50 to-rose-50 text-red-700 border border-red-200',
      overpaid: 'bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-700 border border-blue-200'
    };
    
    const labels = {
      paid: '✓ Đã trả',
      pending: '! Còn nợ',
      overpaid: 'ℹ Trả dư'
    };

    return (
      <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Quản Lý Công Nợ Hộ Chiếu</h1>
          <p className="text-gray-600 mt-2">Tracking và quản lý thanh toán hộ chiếu</p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            icon={Users}
            label="Tổng Khách Hàng"
            value={stats.customers}
            color="from-blue-500 to-blue-600"
          />
          <StatCard
            icon={TrendingUp}
            label="Tổng Doanh Thu"
            value={formatCurrency(stats.revenue).split(',')[0]}
            color="from-emerald-500 to-teal-600"
          />
          <StatCard
            icon={Check}
            label="Đã Thanh Toán"
            value={formatCurrency(stats.paid).split(',')[0]}
            color="from-green-500 to-emerald-600"
          />
          <StatCard
            icon={AlertCircle}
            label="Còn Nợ"
            value={formatCurrency(stats.debt).split(',')[0]}
            color="from-orange-500 to-red-600"
          />
        </div>

        {/* Controls */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <button
              onClick={() => {
                setFormData({
                  passportNumber: '',
                  customerName: '',
                  phoneNumber: '',
                  address: '',
                  serviceDate: '',
                  totalAmount: '',
                  paidAmount: '',
                  notes: ''
                });
                setEditingId(null);
                setShowForm(true);
              }}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:shadow-lg transition-all font-semibold"
            >
              <Plus size={20} /> Thêm Bản Ghi
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all font-semibold"
            >
              <Upload size={20} /> Import Excel
            </button>
            <AgencyFilter value={agencyId} onChange={setAgencyId} />
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-3.5 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Tìm kiếm khách hàng, số điện thoại, số hồ sơ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="paid">Đã thanh toán</option>
              <option value="pending">Còn nợ</option>
            </select>
          </div>
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex justify-between items-center">
                <h3 className="text-xl font-bold">{editingId ? '✏️ Chỉnh Sửa' : '➕ Thêm Bản Ghi Mới'}</h3>
                <button onClick={resetForm} className="hover:bg-white/20 p-2 rounded-lg transition">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Số Hồ Sơ</label>
                    <input 
                      type="text" 
                      placeholder="Nhập số hồ sơ" 
                      value={formData.passportNumber} 
                      onChange={(e) => setFormData({...formData, passportNumber: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Tên Khách Hàng *</label>
                    <input 
                      type="text" 
                      placeholder="Nhập tên khách hàng" 
                      value={formData.customerName} 
                      onChange={(e) => setFormData({...formData, customerName: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Số Điện Thoại</label>
                    <input 
                      type="text" 
                      placeholder="Nhập số điện thoại" 
                      value={formData.phoneNumber} 
                      onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Địa Chỉ</label>
                    <input 
                      type="text" 
                      placeholder="Nhập địa chỉ" 
                      value={formData.address} 
                      onChange={(e) => setFormData({...formData, address: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Ngày Làm *</label>
                    <input 
                      type="date" 
                      value={formData.serviceDate} 
                      onChange={(e) => setFormData({...formData, serviceDate: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Số Tiền *</label>
                    <input 
                      type="number" 
                      placeholder="Nhập số tiền" 
                      value={formData.totalAmount} 
                      onChange={(e) => setFormData({...formData, totalAmount: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Đã Trả</label>
                    <input 
                      type="number" 
                      placeholder="Nhập số tiền đã trả" 
                      value={formData.paidAmount} 
                      onChange={(e) => setFormData({...formData, paidAmount: e.target.value})} 
                      className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Ghi Chú</label>
                  <textarea 
                    placeholder="Nhập ghi chú" 
                    value={formData.notes} 
                    onChange={(e) => setFormData({...formData, notes: e.target.value})} 
                    rows="3" 
                    className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none transition" 
                  />
                </div>
              </div>

              <div className="flex gap-3 p-6 bg-gray-50 rounded-b-2xl">
                <button 
                  onClick={handleSubmit} 
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-lg hover:shadow-lg transition font-semibold flex items-center justify-center gap-2"
                >
                  <Check size={18} /> Lưu
                </button>
                <button 
                  onClick={resetForm} 
                  className="flex-1 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 transition font-semibold flex items-center justify-center gap-2"
                >
                  <X size={18} /> Hủy
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                  <th className="px-6 py-4 text-left font-semibold">Số Hồ Sơ</th>
                  <th className="px-6 py-4 text-left font-semibold">Khách Hàng</th>
                  <th className="px-6 py-4 text-left font-semibold hidden md:table-cell">Đại Lý</th>
                  <th className="px-6 py-4 text-left font-semibold hidden sm:table-cell">SĐT</th>
                  <th className="px-6 py-4 text-left font-semibold hidden lg:table-cell">Địa Chỉ</th>
                  <th className="px-6 py-4 text-left font-semibold">Ngày Làm</th>
                  <th className="px-6 py-4 text-right font-semibold">Số Tiền</th>
                  <th className="px-6 py-4 text-right font-semibold hidden md:table-cell">Còn Nợ</th>
                  <th className="px-6 py-4 text-center font-semibold">Trạng Thái</th>
                  <th className="px-6 py-4 text-center font-semibold">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredData.length === 0 ? (
                  <tr><td colSpan="9" className="px-6 py-12 text-center text-gray-500 font-medium">📊 Chưa có bản ghi</td></tr>
                ) : (
                  filteredData.map((p, idx) => {
                    const debt = p.total_amount - p.paid_amount;
                    const status = getDebtStatus(debt);
                    return (
                      <tr key={p.id} className={`hover:bg-blue-50 transition ${idx % 2 === 0 ? 'bg-gray-50/50' : ''}`}>
                        <td className="px-6 py-4 font-mono font-semibold text-blue-600">
                          <span className="px-3 py-1 bg-blue-100 rounded-lg">
                            {p.passport_number || 'N/A'}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-semibold text-gray-900">{p.customer_name}</td>
                        <td className="px-6 py-4 text-gray-500 text-sm hidden md:table-cell">{p.owner_name || p.owner_username || ''}</td>
                        <td className="px-6 py-4 text-gray-600 hidden sm:table-cell">{p.phone_number}</td>
                        <td className="px-6 py-4 text-gray-600 hidden lg:table-cell text-sm">{p.address || 'N/A'}</td>
                        <td className="px-6 py-4 text-gray-600">{formatDateDisplay(p.service_date)}</td>
                        <td className="px-6 py-4 text-right font-semibold text-gray-900">{formatCurrency(p.total_amount)}</td>
                        <td className="px-6 py-4 text-right hidden md:table-cell font-bold" style={{color: debt > 0 ? '#ef4444' : '#10b981'}}>
                          {formatCurrency(debt)}
                        </td>
                        <td className="px-6 py-4 text-center"><StatusBadge status={status} /></td>
                        <td className="px-6 py-4 text-center">
                          {(!currentUserId || p.user_id === currentUserId) ? (
                            <div className="flex gap-2 justify-center">
                              <button
                                onClick={() => handleEdit(p)}
                                className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                                title="Sửa"
                              >
                                <Edit2 size={18} />
                              </button>
                              <button
                                onClick={() => handleDelete(p.id)}
                                className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition"
                                title="Xóa"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Chỉ xem</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import hộ chiếu từ Excel/CSV"
        templateName="mau-import-ho-chieu.xlsx"
        fields={PASSPORT_IMPORT_FIELDS}
        sampleRow={PASSPORT_IMPORT_SAMPLE}
        onImport={importPassportsFromRows}
        onSuccess={() => loadData(token)}
      />
    </div>
  );
}