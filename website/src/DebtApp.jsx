import React, { useState, useEffect } from 'react';
import { Plus, LogOut, Lock, Calendar, Edit2, Trash2, Check, X, Search, Download, Upload, Users, TrendingUp, TrendingDown, DollarSign, Users2, Landmark } from 'lucide-react';
import ImportModal from './components/ImportModal';
import PaymentModal from './components/PaymentModal';
import AgencyFilter from './components/AgencyFilter';
import VnDatePicker from './components/VnDatePicker';
import { useAuth } from './auth/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Cấu hình cột để import nợ vé từ Excel/CSV (khớp key với backend /debts/import).
const DEBT_IMPORT_FIELDS = [
  { key: 'customerName', label: 'Tên khách hàng', required: true, aliases: ['khách hàng', 'ho ten', 'họ tên', 'customer'] },
  { key: 'phoneNumber', label: 'Số điện thoại', aliases: ['sđt', 'sdt', 'phone', 'điện thoại'] },
  { key: 'ticketCode', label: 'Mã vé', aliases: ['ma ve', 'code', 'ticket'] },
  { key: 'airline', label: 'Hãng', aliases: ['hang', 'hãng bay', 'hãng hàng không', 'airline'] },
  { key: 'route', label: 'Hành trình', aliases: ['chặng', 'tuyến', 'route', 'chang'] },
  { key: 'flightDate', label: 'Ngày bay', aliases: ['ngay bay', 'flight date', 'ngày khởi hành'] },
  { key: 'issueDate', label: 'Ngày xuất vé', aliases: ['ngay xuat', 'issue date', 'ngày xuất', 'ngày'] },
  { key: 'ticketAmount', label: 'Tiền vé', required: true, aliases: ['so tien', 'số tiền', 'amount', 'giá vé', 'tổng tiền'] },
  { key: 'paid', label: 'Đã trả', aliases: ['da tra', 'đã thanh toán', 'paid', 'thanh toán'] },
  { key: 'notes', label: 'Ghi chú', aliases: ['ghi chu', 'note', 'notes', 'diễn giải'] },
];

const DEBT_IMPORT_SAMPLE = {
  customerName: 'Nguyễn Văn A', phoneNumber: '0901234567', ticketCode: 'VN123', airline: 'Vietnam Airlines',
  route: 'HAN-SGN', flightDate: '25/12/2025', issueDate: '01/12/2025',
  ticketAmount: 1500000, paid: 500000, notes: 'Vé khứ hồi',
};

// Tuyến phổ biến gợi ý sẵn (dùng cho mọi user kể cả chưa tự thêm hành trình)
const DEFAULT_ROUTES = [
  'HAN-SGN', 'SGN-HAN', 'HAN-DAD', 'DAD-HAN', 'SGN-DAD', 'DAD-SGN',
  'HAN-CXR', 'CXR-HAN', 'SGN-CXR', 'CXR-SGN', 'HAN-PQC', 'PQC-HAN',
  'SGN-PQC', 'PQC-SGN', 'HAN-VII', 'VII-HAN', 'SGN-VII', 'VII-SGN',
  'HAN-HPH', 'HPH-HAN', 'SGN-UIH', 'UIH-SGN',
];

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

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
};

const calculateRemaining = (ticketAmount, paid) => {
  return (parseFloat(ticketAmount) || 0) - (parseFloat(paid) || 0);
};

const StatCard = ({ icon: Icon, label, value, color, trend }) => (
  <div className={`bg-gradient-to-br ${color} rounded-xl sm:rounded-2xl p-4 sm:p-6 text-white shadow-lg hover:shadow-xl transition-all`}>
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs sm:text-sm opacity-90 font-medium">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold mt-1 sm:mt-2 truncate">{value}</p>
      </div>
      <div className="p-2 sm:p-3 bg-white/20 rounded-lg sm:rounded-xl flex-shrink-0">
        <Icon size={20} className="sm:w-6 sm:h-6" />
      </div>
    </div>
    {trend && (
      <div className="flex items-center gap-1 mt-2 sm:mt-3 text-xs">
        {trend > 0 ? <TrendingUp size={12} className="sm:w-4 sm:h-4" /> : <TrendingDown size={12} className="sm:w-4 sm:h-4" />}
        <span>{Math.abs(trend)}%</span>
      </div>
    )}
  </div>
);

const App = () => {
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id;
  const [agencyId, setAgencyId] = useState('');
  // Đăng nhập được xử lý tập trung ở AuthProvider; ở đây chỉ đọc token đã lưu.
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem('currentUser') || '');
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  const [debts, setDebts] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [showRouteManager, setShowRouteManager] = useState(false);
  const [showCompanyManager, setShowCompanyManager] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState(null);
  const [editingCompanyId, setEditingCompanyId] = useState(null);

  const [newDebt, setNewDebt] = useState({
    customerName: '',
    phoneNumber: '',
    ticketCode: '',
    airline: '',
    route: '',
    flightDate: '',
    issueDate: '',
    dueDate: '',
    ticketAmount: '',
    paid: '',
    notes: '',
    companyId: '',
    paymentTarget: 'self'
  });
  const [newRoute, setNewRoute] = useState('');
  const [payingDebt, setPayingDebt] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [sortBy, setSortBy] = useState('');      // cột đang sort
  const [sortDir, setSortDir] = useState('asc'); // asc | desc
  const [newCompany, setNewCompany] = useState({
    name: '',
    taxCode: '',
    address: '',
    email: '',
    contactPerson: '',
    phone: '',
    creditLimit: ''
  });

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('currentUser');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setCurrentUser(savedUser);
      setIsLoggedIn(true);
      loadAllData(savedToken);
    }
  }, []);

  // Tải lại danh sách nợ khi đổi bộ lọc đại lý.
  useEffect(() => {
    if (token) loadAllData(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  const getHeaders = () => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  const loadAllData = async (authToken) => {
    try {
      const [debtsRes, routesRes, companiesRes, customersRes] = await Promise.all([
        fetch(`${API_URL}/debts${agencyId ? `?agencyId=${agencyId}` : ''}`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_URL}/routes`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_URL}/companies`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_URL}/customers`, { headers: { 'Authorization': `Bearer ${authToken}` } })
      ]);

      if (debtsRes.ok) setDebts(await debtsRes.json());
      if (routesRes.ok) setRoutes(await routesRes.json());
      if (companiesRes.ok) setCompanies(await companiesRes.json());
      if (customersRes.ok) setCustomers(await customersRes.json());
    } catch (error) {
      console.error('Load data error:', error);
    }
  };

  // Gọi API import nợ vé; chuẩn hoá kết quả cho ImportModal hiển thị.
  const importDebtsFromRows = async (rows) => {
    const res = await fetch(`${API_URL}/debts/import`, {
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

  const handleLogin = (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);

    fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(res => {
        if (res.ok) {
          return res.json().then(data => {
            setToken(data.token);
            setCurrentUser(data.username);
            setIsLoggedIn(true);
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', data.username);
            setUsername('');
            setPassword('');
            loadAllData(data.token);
          });
        } else {
          setLoginError('Tên đăng nhập hoặc mật khẩu không đúng!');
        }
      })
      .catch(() => setLoginError('Lỗi kết nối máy chủ'))
      .finally(() => setLoading(false));
  };

  const handleLogout = () => {
    if (confirm('Bạn có chắc muốn đăng xuất?')) {
      setIsLoggedIn(false);
      setCurrentUser('');
      setToken('');
      setDebts([]);
      setRoutes([]);
      setCompanies([]);
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
    }
  };

  const handleAddDebt = () => {
    if (!newDebt.customerName || !newDebt.ticketAmount) {
      alert('⚠️ Vui lòng nhập tên khách hàng và tiền vé');
      return;
    }

    const url = editingDebtId ? `${API_URL}/debts/${editingDebtId}` : `${API_URL}/debts`;
    const method = editingDebtId ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: getHeaders(),
      body: JSON.stringify({
        customerName: newDebt.customerName,
        phoneNumber: newDebt.phoneNumber,
        ticketCode: newDebt.ticketCode,
        airline: newDebt.airline,
        route: newDebt.route,
        flightDate: newDebt.flightDate,
        issueDate: newDebt.issueDate || new Date().toISOString().split('T')[0],
        dueDate: newDebt.dueDate || null,
        ticketAmount: parseFloat(newDebt.ticketAmount),
        paid: parseFloat(newDebt.paid) || 0,
        notes: newDebt.notes,
        companyId: newDebt.companyId,
        paymentTarget: newDebt.paymentTarget
      })
    })
      .then(res => res.json())
      .then(debt => {
        if (editingDebtId) {
          setDebts(debts.map(d => d.id === editingDebtId ? debt : d));
          alert('✅ Cập nhật công nợ thành công');
        } else {
          setDebts([...debts, debt]);
          alert('✅ Đã thêm công nợ mới');
        }
        setNewDebt({
          customerName: '',
          phoneNumber: '',
          ticketCode: '',
          airline: '',
          route: '',
          flightDate: '',
          issueDate: '',
          dueDate: '',
          ticketAmount: '',
          paid: '',
          notes: '',
          companyId: '',
          paymentTarget: 'self'
        });
        setEditingDebtId(null);
        setShowAddForm(false);
      })
      .catch(() => alert('❌ Lỗi khi lưu công nợ'));
  };

  const handleEditDebt = (debt) => {
    setNewDebt({
      customerName: debt.customer_name,
      phoneNumber: debt.phone_number,
      ticketCode: debt.ticket_code,
      airline: debt.airline || '',
      route: debt.route,
      flightDate: (debt.flight_date || '').slice(0, 10),
      issueDate: (debt.issue_date || '').slice(0, 10),
      dueDate: (debt.due_date || '').slice(0, 10),
      ticketAmount: debt.ticket_amount,
      paid: debt.paid,
      notes: debt.notes,
      companyId: debt.company_id || '',
      paymentTarget: Number(debt.agency_paid) > 0 ? 'agency' : 'self'
    });
    setEditingDebtId(debt.id);
    setShowAddForm(true);
  };

  const handleDeleteDebt = (id) => {
    if (confirm('Xóa bản ghi này?')) {
      fetch(`${API_URL}/debts/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      }).then(() => setDebts(debts.filter(d => d.id !== id)));
    }
  };

  const handleAddRoute = () => {
    const trimmedRoute = newRoute.trim().toUpperCase();
    if (!trimmedRoute) {
      alert('⚠️ Vui lòng nhập hành trình');
      return;
    }

    fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ routeName: trimmedRoute })
    })
      .then(res => res.json())
      .then(data => {
        setRoutes([...routes, data.route].sort());
        setNewRoute('');
        alert('✅ Đã thêm hành trình');
      })
      .catch(() => alert('❌ Lỗi khi thêm hành trình'));
  };

  const handleDeleteRoute = (route) => {
    if (confirm(`Xóa ${route}?`)) {
      fetch(`${API_URL}/routes/${encodeURIComponent(route)}`, {
        method: 'DELETE',
        headers: getHeaders()
      }).then(() => setRoutes(routes.filter(r => r !== route)));
    }
  };

  const getCompanyById = (companyId) => {
    if (!companyId) return null;
    return companies.find(c => String(c.id) === String(companyId));
  };

  const exportToCSV = () => {
    const headers = [
      'Tên khách hàng',
      'Công ty',
      'Số điện thoại',
      'Mã vé',
      'Hãng',
      'Hành trình',
      'Ngày bay',
      'Ngày xuất vé',
      'Tiền vé',
      'Đã thanh toán',
      'Còn nợ',
      'Ghi chú'
    ];

    const rows = filteredDebts.map(debt => [
      debt.customer_name,
      getCompanyById(debt.company_id)?.name || 'Khách lẻ',
      debt.phone_number,
      debt.ticket_code,
      debt.airline,
      debt.route,
      formatDateDisplay(debt.flight_date),
      formatDateDisplay(debt.issue_date),
      debt.ticket_amount,
      debt.paid,
      debt.ticket_amount - debt.paid,
      debt.notes
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cong-no-ve-may-bay-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const filteredDebts = debts.filter(debt => {
    const matchesSearch =
      debt.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (debt.phone_number && debt.phone_number.includes(searchTerm)) ||
      (debt.ticket_code && debt.ticket_code.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'paid' && calculateRemaining(debt.ticket_amount, debt.paid) <= 0) ||
      (filterStatus === 'unpaid' && calculateRemaining(debt.ticket_amount, debt.paid) > 0);

    const matchesMonth =
      filterMonth === 'all' || !debt.issue_date
        ? true
        : debt.issue_date.substring(0, 7) === filterMonth;

    return matchesSearch && matchesStatus && matchesMonth;
  });

  // Sắp xếp theo cột đang chọn (bấm tiêu đề để đổi tăng/giảm)
  const sortValue = (d) => {
    switch (sortBy) {
      case 'customer_name': return (d.customer_name || '').toLowerCase();
      case 'flight_date': return d.flight_date || '';
      case 'issue_date': return d.issue_date || '';
      case 'ticket_amount': return parseFloat(d.ticket_amount) || 0;
      case 'paid': return parseFloat(d.paid) || 0;
      case 'remaining': return calculateRemaining(d.ticket_amount, d.paid);
      default: return '';
    }
  };
  const sortedDebts = sortBy
    ? [...filteredDebts].sort((a, b) => {
        const va = sortValue(a);
        const vb = sortValue(b);
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDir === 'desc' ? -cmp : cmp;
      })
    : filteredDebts;

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };
  const sortArrow = (key) => (sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const totalAmount = filteredDebts.reduce((sum, d) => sum + (parseFloat(d.ticket_amount) || 0), 0);
  const totalPaid = filteredDebts.reduce((sum, d) => sum + (parseFloat(d.paid) || 0), 0);
  const totalDebt = totalAmount - totalPaid;
  const paidPercentage = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;

  const getAvailableMonths = () => {
    const months = new Set();
    debts.forEach(debt => {
      if (debt.issue_date) {
        const month = debt.issue_date.substring(0, 7);
        months.add(month);
      }
    });
    return Array.from(months).sort().reverse();
  };

  const availableMonths = getAvailableMonths();

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 flex items-center justify-center p-3 sm:p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 sm:p-8 text-white text-center">
              <Lock size={40} className="sm:w-12 sm:h-12 mx-auto mb-3 sm:mb-4 opacity-80" />
              <h1 className="text-2xl sm:text-3xl font-bold">Quản Lý Công Nợ</h1>
              <p className="text-sm sm:text-base text-blue-100 mt-1 sm:mt-2">Vé Máy Bay Thùy Dương</p>
            </div>

            <div className="p-6 sm:p-8">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">Tên đăng nhập</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Nhập tên đăng nhập"
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-sm"
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin(e)}
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">Mật khẩu</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-sm"
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin(e)}
                  />
                </div>
                {loginError && (
                  <div className="p-3 sm:p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded text-xs sm:text-sm">
                    {loginError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-2 sm:py-3 rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50 text-sm sm:text-base"
                >
                  {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
                </button>
              </form>

              <div className="mt-6 p-3 sm:p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs font-semibold text-blue-900 mb-2">📝 Demo:</p>
                <div className="space-y-0.5 text-xs text-blue-800 font-mono">
                  <p>admin / admin123</p>
                  <p>thuyduong / thuyduong2024</p>
                  <p>user / 123456</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-2 sm:px-4 md:px-6 py-6 sm:py-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8 gap-4 sm:gap-0">
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900">Quản Lý Công Nợ</h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-1">Vé Máy Bay Thùy Dương</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
            <StatCard
              icon={Users2}
              label="Tổng Khách Hàng"
              value={filteredDebts.length}
              color="from-blue-500 to-blue-600"
            />
            <StatCard
              icon={DollarSign}
              label="Tổng Doanh Thu"
              value={formatCurrency(totalAmount).split(',')[0]}
              color="from-green-500 to-green-600"
            />
            <StatCard
              icon={TrendingUp}
              label="Đã Thu"
              value={formatCurrency(totalPaid).split(',')[0]}
              color="from-purple-500 to-purple-600"
              trend={paidPercentage}
            />
            <StatCard
              icon={TrendingDown}
              label="Còn Nợ"
              value={formatCurrency(totalDebt).split(',')[0]}
              color="from-red-500 to-red-600"
            />
          </div>

          {/* Toolbar */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-6 sm:mb-8">
            <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 sm:mb-6">
              <button
                onClick={() => {
                  setEditingDebtId(null);
                  setNewDebt({
                    customerName: '',
                    phoneNumber: '',
                    ticketCode: '',
                    airline: '',
                    route: '',
                    flightDate: '',
                    issueDate: '',
                    dueDate: '',
                    ticketAmount: '',
                    paid: '',
                    notes: '',
                    companyId: '',
                    paymentTarget: 'self'
                  });
                  setShowAddForm(!showAddForm);
                }}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold text-xs sm:text-sm"
              >
                <Plus size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Thêm mới</span>
              </button>
              <button
                onClick={() => setShowRouteManager(!showRouteManager)}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-semibold text-xs sm:text-sm"
              >
                <Calendar size={16} className="sm:w-5 sm:h-5" /> <span className="hidden md:inline">Hành trình</span>
              </button>
              <button
                onClick={() => setShowCompanyManager(!showCompanyManager)}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold text-xs sm:text-sm"
              >
                <Users size={16} className="sm:w-5 sm:h-5" /> <span className="hidden md:inline">Công ty</span>
              </button>
              <button
                onClick={() => setShowBulkImport(!showBulkImport)}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-semibold text-xs sm:text-sm"
              >
                <Upload size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Import</span>
              </button>
              <button
                onClick={exportToCSV}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold text-xs sm:text-sm"
              >
                <Download size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Export</span>
              </button>
            </div>

            {/* Search & Filter */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 sm:gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-2 sm:top-2.5 text-gray-400" size={16} className="sm:w-5 sm:h-5" />
                <input
                  type="text"
                  placeholder="Tìm kiếm..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                />
              </div>
              <AgencyFilter value={agencyId} onChange={setAgencyId} />
              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
              >
                <option value="all">Tất cả tháng</option>
                {availableMonths.map(month => (
                  <option key={month} value={month}>
                    Tháng {month.substring(5)}/{month.substring(0, 4)}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="unpaid">Còn nợ</option>
                <option value="paid">Đã thanh toán</option>
              </select>
            </div>
          </div>

          {/* Add Form */}
          {showAddForm && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8">
              <h3 className="text-lg sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
                {editingDebtId ? '✏️ Chỉnh sửa công nợ' : '➕ Thêm công nợ mới'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Tên khách hàng *</label>
                  <input
                    type="text"
                    list="customer-name-options"
                    placeholder="Chọn khách cũ hoặc nhập tên mới"
                    value={newDebt.customerName}
                    onChange={(e) => {
                      const name = e.target.value;
                      const match = customers.find((c) => c.name === name);
                      setNewDebt({
                        ...newDebt,
                        customerName: name,
                        phoneNumber: match ? (match.phone || '') : newDebt.phoneNumber,
                      });
                    }}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                  <datalist id="customer-name-options">
                    {[...new Map(customers.map((c) => [c.name, c])).values()].map((c) => (
                      <option key={c.id} value={c.name}>{c.phone || ''}</option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    placeholder="Nhập số điện thoại"
                    value={newDebt.phoneNumber}
                    onChange={(e) => setNewDebt({ ...newDebt, phoneNumber: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Mã vé</label>
                  <input
                    type="text"
                    placeholder="Nhập mã vé"
                    value={newDebt.ticketCode}
                    onChange={(e) => setNewDebt({ ...newDebt, ticketCode: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Hãng vé</label>
                  <input
                    type="text"
                    list="airline-options"
                    placeholder="VD: Vietnam Airlines"
                    value={newDebt.airline}
                    onChange={(e) => setNewDebt({ ...newDebt, airline: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                  <datalist id="airline-options">
                    <option value="Vietnam Airlines" />
                    <option value="Vietjet Air" />
                    <option value="Bamboo Airways" />
                    <option value="Vietravel Airlines" />
                    <option value="Pacific Airlines" />
                    <option value="Sun PhuQuoc Airways" />
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Công ty</label>
                  <select
                    value={newDebt.companyId}
                    onChange={(e) => setNewDebt({ ...newDebt, companyId: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  >
                    <option value="">Khách lẻ</option>
                    {companies.length === 0 && (
                      <option value="" disabled>— Chưa có công ty, bấm nút &quot;Công ty&quot; để thêm —</option>
                    )}
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Hành trình</label>
                  <input
                    type="text"
                    list="route-options"
                    placeholder="Chọn hoặc nhập, VD: HAN-SGN"
                    value={newDebt.route}
                    onChange={(e) => setNewDebt({ ...newDebt, route: e.target.value.toUpperCase() })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                  <datalist id="route-options">
                    {[...new Set([...routes, ...DEFAULT_ROUTES])].map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Ngày bay</label>
                  <VnDatePicker
                    value={newDebt.flightDate}
                    onChange={(v) => setNewDebt({ ...newDebt, flightDate: v })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Ngày xuất vé</label>
                  <VnDatePicker
                    value={newDebt.issueDate}
                    onChange={(v) => setNewDebt({ ...newDebt, issueDate: v })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Hạn thanh toán</label>
                  <VnDatePicker
                    value={newDebt.dueDate}
                    onChange={(v) => setNewDebt({ ...newDebt, dueDate: v })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Tiền vé (VNĐ) *</label>
                  <input
                    type="number"
                    placeholder="Nhập số tiền vé"
                    value={newDebt.ticketAmount}
                    onChange={(e) => setNewDebt({ ...newDebt, ticketAmount: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">
                    {editingDebtId ? 'Đã trả (tổng — chỉ đọc)' : 'Trả trước (VNĐ)'}
                  </label>
                  <input
                    type="number"
                    placeholder={editingDebtId ? '' : 'Số tiền khách trả trước (nếu có)'}
                    value={newDebt.paid}
                    onChange={(e) => setNewDebt({ ...newDebt, paid: e.target.value })}
                    disabled={!!editingDebtId}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  />
                  {editingDebtId && (
                    <p className="text-xs text-gray-400 mt-1">Dùng nút 💵 Thanh toán để ghi nhận thêm các lần trả.</p>
                  )}
                </div>
                {!editingDebtId && (
                  <div>
                    <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Trả trước vào TK</label>
                    <select
                      value={newDebt.paymentTarget}
                      onChange={(e) => setNewDebt({ ...newDebt, paymentTarget: e.target.value })}
                      className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                    >
                      <option value="self">TK cá nhân</option>
                      <option value="agency">TK cấp trên (nộp quỹ)</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Ghi chú</label>
                  <input
                    type="text"
                    placeholder="Nhập ghi chú"
                    value={newDebt.notes}
                    onChange={(e) => setNewDebt({ ...newDebt, notes: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2 sm:gap-3">
                <button
                  onClick={handleAddDebt}
                  className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold text-xs sm:text-sm"
                >
                  <Check size={16} className="sm:w-5 sm:h-5" /> Lưu
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold text-xs sm:text-sm"
                >
                  <X size={16} className="sm:w-5 sm:h-5" /> Hủy
                </button>
              </div>
            </div>
          )}

          {/* Data Table */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg overflow-hidden mb-6 sm:mb-8">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full min-w-max lg:min-w-0">
                <thead className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white sticky top-0 z-10 [&_th]:bg-blue-600">
                  <tr className="text-xs sm:text-sm font-semibold">
                    <th onClick={() => toggleSort('customer_name')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap sticky left-0 z-20 cursor-pointer select-none hover:bg-blue-700">Khách hàng{sortArrow('customer_name')}</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden md:table-cell">Đại lý</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden sm:table-cell">Công ty</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden md:table-cell">SĐT</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Mã vé</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden lg:table-cell">Hãng</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden lg:table-cell">Hành trình</th>
                    <th onClick={() => toggleSort('flight_date')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden xl:table-cell cursor-pointer select-none hover:bg-blue-700">Ngày bay{sortArrow('flight_date')}</th>
                    <th onClick={() => toggleSort('issue_date')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap hidden lg:table-cell cursor-pointer select-none hover:bg-blue-700">Ngày xuất vé{sortArrow('issue_date')}</th>
                    <th onClick={() => toggleSort('ticket_amount')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Tiền vé{sortArrow('ticket_amount')}</th>
                    <th onClick={() => toggleSort('paid')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap hidden sm:table-cell cursor-pointer select-none hover:bg-blue-700">Đã trả{sortArrow('paid')}</th>
                    <th onClick={() => toggleSort('remaining')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Còn nợ{sortArrow('remaining')}</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-center whitespace-nowrap">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedDebts.length === 0 ? (
                    <tr>
                      <td colSpan="13" className="px-4 py-8 sm:py-12 text-center text-gray-500 font-medium text-xs sm:text-base">
                        📊 Chưa có dữ liệu
                      </td>
                    </tr>
                  ) : (
                    sortedDebts.map((debt, idx) => {
                      const remaining = calculateRemaining(debt.ticket_amount, debt.paid);
                      const isPaid = remaining <= 0;
                      // Trạng thái thanh toán: đã đủ (xanh) / trả một phần (cam) / chưa trả (đỏ)
                      const payStatus = isPaid ? 'paid' : ((parseFloat(debt.paid) || 0) > 0 ? 'partial' : 'unpaid');
                      // Quá hạn = còn nợ + đã qua hạn thanh toán
                      const isOverdue = !isPaid && debt.due_date && debt.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
                      const dotColor = isOverdue ? 'bg-red-600' : payStatus === 'paid' ? 'bg-green-500' : payStatus === 'partial' ? 'bg-amber-500' : 'bg-red-500';
                      const dotTitle = isOverdue ? 'Quá hạn thanh toán' : payStatus === 'paid' ? 'Đã trả đủ' : payStatus === 'partial' ? 'Trả một phần' : 'Chưa trả';
                      const owned = !currentUserId || debt.user_id === currentUserId;
                      return (
                        <tr key={debt.id} className={`hover:bg-gray-50 transition ${idx % 2 === 0 ? 'bg-gray-50' : ''}`}>
                          <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 font-semibold text-xs sm:text-sm whitespace-nowrap sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                            <span className="inline-flex items-center gap-2">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} title={dotTitle}></span>
                              <span
                                onClick={owned ? () => handleEditDebt(debt) : undefined}
                                title={owned ? 'Bấm để sửa' : undefined}
                                className={`${isOverdue || payStatus === 'unpaid' ? 'text-red-600' : 'text-gray-900'} ${owned ? 'cursor-pointer hover:underline' : ''}`}
                              >{debt.customer_name}</span>
                              {isOverdue && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">⚠ Quá hạn</span>}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 hidden md:table-cell text-xs text-gray-600 whitespace-nowrap">
                            {debt.owner_name || debt.owner_username || ''}
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 hidden sm:table-cell">
                            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-medium whitespace-nowrap">
                              {getCompanyById(debt.company_id)?.name || 'Khách lẻ'}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 hidden md:table-cell text-xs sm:text-sm text-gray-600 whitespace-nowrap">{debt.phone_number}</td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4">
                            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 text-blue-800 rounded-lg text-xs font-mono whitespace-nowrap">
                              {debt.ticket_code}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap hidden lg:table-cell">{debt.airline}</td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 hidden lg:table-cell">
                            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-teal-100 text-teal-800 rounded-full text-xs font-medium whitespace-nowrap">
                              {debt.route}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm font-medium text-gray-900 hidden xl:table-cell whitespace-nowrap">{formatDateDisplay(debt.flight_date)}</td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm font-medium text-gray-600 hidden lg:table-cell">
                            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-green-100 text-green-800 rounded-lg whitespace-nowrap">
                              {formatDateDisplay(debt.issue_date)}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-semibold text-gray-900 text-xs sm:text-sm whitespace-nowrap">{formatCurrency(debt.ticket_amount)}</td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-semibold text-green-600 hidden sm:table-cell text-xs sm:text-sm whitespace-nowrap">
                            {formatCurrency(debt.paid)}
                            {Number(debt.agency_paid) > 0 && (
                              <span className="block text-[10px] text-orange-600 font-normal" title="Đã chuyển vào TK cấp trên">
                                <Landmark size={10} className="inline mr-0.5" />{formatCurrency(debt.agency_paid)}
                              </span>
                            )}
                          </td>
                          <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-bold text-xs sm:text-sm whitespace-nowrap ${isPaid ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(remaining)}
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-center">
                            {(!currentUserId || debt.user_id === currentUserId) ? (
                              <div className="flex gap-1 sm:gap-2 justify-center flex-shrink-0">
                                <button
                                  onClick={() => setPayingDebt(debt)}
                                  className="p-1.5 sm:p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-xs"
                                  title="Thanh toán"
                                >
                                  <DollarSign size={14} className="sm:w-4 sm:h-4" />
                                </button>
                                <button
                                  onClick={() => handleEditDebt(debt)}
                                  className="p-1.5 sm:p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-xs"
                                  title="Sửa"
                                >
                                  <Edit2 size={14} className="sm:w-4 sm:h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteDebt(debt.id)}
                                  className="p-1.5 sm:p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-xs"
                                  title="Xóa"
                                >
                                  <Trash2 size={14} className="sm:w-4 sm:h-4" />
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

          {/* Route Manager */}
          {showRouteManager && (
            <div className="bg-teal-50 border-2 border-teal-300 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8">
              <h3 className="text-lg sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">✈️ Quản Lý Hành Trình Bay</h3>
              <div className="flex gap-2 sm:gap-3 mb-4 sm:mb-6">
                <input
                  type="text"
                  value={newRoute}
                  onChange={(e) => setNewRoute(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddRoute()}
                  placeholder="VD: HAN-SGN"
                  className="flex-1 px-3 sm:px-4 py-2 sm:py-3 border-2 border-teal-300 rounded-lg uppercase focus:border-teal-500 focus:outline-none transition text-xs sm:text-sm"
                />
                <button
                  onClick={handleAddRoute}
                  className="px-3 sm:px-6 py-2 sm:py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-semibold"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-6">
                {routes.map((route, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-white px-2 sm:px-4 py-2 sm:py-3 rounded-lg border-2 border-teal-200 group hover:bg-teal-50 transition text-xs sm:text-sm"
                  >
                    <span className="font-bold text-teal-900">{route}</span>
                    <button
                      onClick={() => handleDeleteRoute(route)}
                      className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 size={14} className="sm:w-4 sm:h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowRouteManager(false)}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold text-xs sm:text-sm"
              >
                Đóng
              </button>
            </div>
          )}

          {/* Company Manager */}
          {showCompanyManager && (
            <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8">
              <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
                <h3 className="text-lg sm:text-2xl font-bold text-gray-900">🏢 Quản Lý Công Ty</h3>
                <button
                  onClick={() => {
                    setShowCompanyForm(!showCompanyForm);
                    setEditingCompanyId(null);
                    setNewCompany({
                      name: '',
                      taxCode: '',
                      address: '',
                      email: '',
                      contactPerson: '',
                      phone: '',
                      creditLimit: ''
                    });
                  }}
                  className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold text-xs sm:text-sm flex-shrink-0"
                >
                  <Plus size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Thêm công ty</span>
                </button>
              </div>

              {showCompanyForm && (
                <div className="mb-4 sm:mb-6 bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 border-2 border-indigo-200">
                  <h4 className="font-bold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-lg">
                    {editingCompanyId ? 'Chỉnh sửa công ty' : 'Thêm công ty mới'}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4 mb-3 sm:mb-4">
                    <input
                      type="text"
                      placeholder="Tên công ty"
                      value={newCompany.name}
                      onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                      className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none transition text-xs sm:text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Mã số thuế"
                      value={newCompany.taxCode}
                      onChange={(e) => setNewCompany({ ...newCompany, taxCode: e.target.value })}
                      className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none transition text-xs sm:text-sm"
                    />
                  </div>
                  <div className="flex gap-2 sm:gap-3">
                    <button
                      onClick={() => setShowCompanyManager(false)}
                      className="flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-1.5 sm:py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold text-xs sm:text-sm"
                    >
                      <X size={16} className="sm:w-5 sm:h-5" /> Đóng
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowCompanyManager(false)}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold text-xs sm:text-sm"
              >
                Đóng
              </button>
            </div>
          )}

          {/* Import từ Excel/CSV */}
          <ImportModal
            open={showBulkImport}
            onClose={() => setShowBulkImport(false)}
            title="Import nợ vé từ Excel/CSV"
            templateName="mau-import-no-ve.xlsx"
            fields={DEBT_IMPORT_FIELDS}
            sampleRow={DEBT_IMPORT_SAMPLE}
            onImport={importDebtsFromRows}
            onSuccess={() => loadAllData(token)}
          />

          {/* Lịch sử thanh toán */}
          {payingDebt && (
            <PaymentModal
              target={{
                type: 'debt',
                id: payingDebt.id,
                name: payingDebt.customer_name,
                total: payingDebt.ticket_amount,
                paid: payingDebt.paid,
              }}
              onClose={() => setPayingDebt(null)}
              onChanged={() => loadAllData(token)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;