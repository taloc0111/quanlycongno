import React, { useState, useEffect } from 'react';
import { Plus, LogOut, Lock, Calendar, Edit2, Trash2, Check, X, Search, Download, Upload, Users } from 'lucide-react';

const API_URL = 'http://localhost:5000/api';

// Format date functions
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

const formatDateForDB = (dateString) => {
  if (!dateString) return '';
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) return dateString;
  if (dateString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const [day, month, year] = dateString.split('/');
    return `${year}-${month}-${day}`;
  }
  return dateString;
};

const App = () => {
  // Auth states
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  const [token, setToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  // Data states
  const [debts, setDebts] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [companies, setCompanies] = useState([]);

  // UI states
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRouteManager, setShowRouteManager] = useState(false);
  const [showCompanyManager, setShowCompanyManager] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState(null);
  const [editingCompanyId, setEditingCompanyId] = useState(null);

  // Form states
  const [newDebt, setNewDebt] = useState({
    customerName: '',
    phoneNumber: '',
    ticketCode: '',
    route: '',
    flightDate: '',
    issueDate: '',
    ticketAmount: '',
    paid: '',
    notes: '',
    companyId: ''
  });
  const [newRoute, setNewRoute] = useState('');
  const [bulkImportText, setBulkImportText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [newCompany, setNewCompany] = useState({
    name: '',
    taxCode: '',
    address: '',
    email: '',
    contactPerson: '',
    phone: '',
    creditLimit: ''
  });

  // Check login on mount
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

  const getHeaders = () => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  const loadAllData = async (authToken) => {
    try {
      const [debtsRes, routesRes, companiesRes] = await Promise.all([
        fetch(`${API_URL}/debts`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_URL}/routes`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_URL}/companies`, { headers: { 'Authorization': `Bearer ${authToken}` } })
      ]);

      if (debtsRes.ok) setDebts(await debtsRes.json());
      if (routesRes.ok) setRoutes(await routesRes.json());
      if (companiesRes.ok) setCompanies(await companiesRes.json());
    } catch (error) {
      console.error('Load data error:', error);
    }
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
        route: newDebt.route,
        flightDate: newDebt.flightDate,
        issueDate: newDebt.issueDate || new Date().toISOString().split('T')[0],
        ticketAmount: parseFloat(newDebt.ticketAmount),
        paid: parseFloat(newDebt.paid) || 0,
        notes: newDebt.notes,
        companyId: newDebt.companyId
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
          route: '',
          flightDate: '',
          issueDate: '',
          ticketAmount: '',
          paid: '',
          notes: '',
          companyId: ''
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
      route: debt.route,
      flightDate: debt.flight_date,
      issueDate: debt.issue_date,
      ticketAmount: debt.ticket_amount,
      paid: debt.paid,
      notes: debt.notes,
      companyId: debt.company_id || ''
    });
    setEditingDebtId(debt.id);
    setShowAddForm(true);
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

  const handleDeleteDebt = (id) => {
    if (confirm('Xóa bản ghi này?')) {
      fetch(`${API_URL}/debts/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      }).then(() => setDebts(debts.filter(d => d.id !== id)));
    }
  };

  const handleBulkImport = () => {
    if (!bulkImportText.trim()) {
      alert('⚠️ Vui lòng paste dữ liệu');
      return;
    }

    const rows = bulkImportText.split('\n').filter(row => row.trim());
    const newDebts = [];

    for (let i = 0; i < rows.length; i++) {
      const values = rows[i].split('\t').length > 1 ? rows[i].split('\t') : rows[i].split(',');

      if (values.length < 6 || !values[0].trim()) continue;

      const parseAmount = (str) => {
        if (!str) return 0;
        const cleaned = str.toString().replace(/[,\.]/g, '').trim();
        return parseFloat(cleaned) || 0;
      };

      newDebts.push({
        customerName: values[0]?.trim() || '',
        phoneNumber: values[1]?.trim() || '',
        ticketCode: values[2]?.trim() || '',
        route: values[3]?.trim() || '',
        flightDate: values[4]?.trim() || '',
        issueDate: new Date().toISOString().split('T')[0],
        ticketAmount: parseAmount(values[5]),
        paid: parseAmount(values[6] || 0),
        notes: values[7]?.trim() || '',
        companyId: ''
      });
    }

    if (newDebts.length === 0) {
      alert('❌ Không tìm thấy dữ liệu hợp lệ');
      return;
    }

    fetch(`${API_URL}/debts/bulk`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ debts: newDebts })
    })
      .then(res => res.json())
      .then(data => {
        setDebts([...debts, ...data.debts]);
        setBulkImportText('');
        setShowBulkImport(false);
        alert(`✅ Đã import ${data.count} bản ghi`);
      })
      .catch(() => alert('❌ Lỗi khi import'));
  };

  const handleAddCompany = () => {
    if (!newCompany.name.trim()) {
      alert('⚠️ Vui lòng nhập tên công ty');
      return;
    }

    const url = editingCompanyId ? `${API_URL}/companies/${editingCompanyId}` : `${API_URL}/companies`;
    const method = editingCompanyId ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: getHeaders(),
      body: JSON.stringify({
        name: newCompany.name,
        taxCode: newCompany.taxCode,
        address: newCompany.address,
        email: newCompany.email,
        contactPerson: newCompany.contactPerson,
        phone: newCompany.phone,
        creditLimit: parseFloat(newCompany.creditLimit) || 0
      })
    })
      .then(res => res.json())
      .then(company => {
        if (editingCompanyId) {
          setCompanies(companies.map(c => c.id === editingCompanyId ? company : c));
        } else {
          setCompanies([...companies, company]);
        }
        setNewCompany({
          name: '',
          taxCode: '',
          address: '',
          email: '',
          contactPerson: '',
          phone: '',
          creditLimit: ''
        });
        setEditingCompanyId(null);
        setShowCompanyForm(false);
      })
      .catch(() => alert('❌ Lỗi khi lưu công ty'));
  };

  const handleEditCompany = (company) => {
    setNewCompany({
      name: company.name,
      taxCode: company.tax_code || '',
      address: company.address || '',
      email: company.email || '',
      contactPerson: company.contact_person || '',
      phone: company.phone || '',
      creditLimit: company.credit_limit || 0
    });
    setEditingCompanyId(company.id);
    setShowCompanyForm(true);
  };

  const handleDeleteCompany = (companyId) => {
    if (confirm('Xóa công ty này?')) {
      fetch(`${API_URL}/companies/${companyId}`, {
        method: 'DELETE',
        headers: getHeaders()
      }).then(() => setCompanies(companies.filter(c => c.id !== companyId)));
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

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(
      amount || 0
    );
  };

  const calculateRemaining = (ticketAmount, paid) => {
    return (parseFloat(ticketAmount) || 0) - (parseFloat(paid) || 0);
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

  const totalAmount = filteredDebts.reduce((sum, d) => sum + (parseFloat(d.ticket_amount) || 0), 0);
  const totalPaid = filteredDebts.reduce((sum, d) => sum + (parseFloat(d.paid) || 0), 0);
  const totalDebt = totalAmount - totalPaid;

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
      <div className="min-h-screen bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white">
            <div className="flex justify-center mb-4">
              <Lock size={48} className="bg-white/20 p-3 rounded-full" />
            </div>
            <h1 className="text-3xl font-bold text-center">Đại Lý Vé Máy Bay</h1>
            <p className="text-blue-100 text-center mt-2">Hệ thống quản lý công nợ</p>
          </div>

          <div className="p-8">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Tên đăng nhập"
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg mb-4"
              onKeyPress={(e) => e.key === 'Enter' && handleLogin(e)}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mật khẩu"
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg mb-4"
              onKeyPress={(e) => e.key === 'Enter' && handleLogin(e)}
            />
            {loginError && (
              <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg mb-4">
                {loginError}
              </div>
            )}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200 text-sm">
              <p className="font-semibold mb-2">📝 Demo:</p>
              <p>admin / admin123</p>
              <p>thuyduong / thuyduong2024</p>
              <p>user / 123456</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-lg sticky top-0 z-50">
        <div className="w-full px-2 sm:px-3 md:px-4 lg:px-6 py-4 sm:py-6 flex justify-between items-center">
          <div className="flex items-center gap-2 sm:gap-3">
            <Calendar className="w-6 sm:w-8 h-6 sm:h-8" />
            <div>
              <h1 className="text-lg sm:text-2xl md:text-3xl font-bold">Đại Lý Vé Máy Bay Thùy Dương</h1>
              <p className="text-xs sm:text-sm text-blue-100">Quản Lý Công Nợ</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="text-right text-xs sm:text-sm">
              <p className="text-blue-100">Xin chào,</p>
              <p className="font-bold capitalize">{currentUser}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-white/20 hover:bg-white/30 rounded-lg text-xs sm:text-sm"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </div>

      <div className="w-full px-2 sm:px-3 md:px-4 lg:px-6 py-4 sm:py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-6">
          <div className="bg-blue-500 text-white rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6">
            <p className="text-blue-100 text-xs sm:text-sm">Tổng khách hàng</p>
            <p className="text-2xl sm:text-3xl font-bold mt-1">{filteredDebts.length}</p>
          </div>
          <div className="bg-green-500 text-white rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6">
            <p className="text-green-100 text-xs sm:text-sm">Tổng doanh thu</p>
            <p className="text-lg sm:text-2xl font-bold mt-1 break-words">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="bg-purple-500 text-white rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6">
            <p className="text-purple-100 text-xs sm:text-sm">Đã thu</p>
            <p className="text-lg sm:text-2xl font-bold mt-1 break-words">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="bg-red-500 text-white rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6">
            <p className="text-red-100 text-xs sm:text-sm">Còn nợ</p>
            <p className="text-lg sm:text-2xl font-bold mt-1 break-words">{formatCurrency(totalDebt)}</p>
          </div>
        </div>

        {/* Buttons */}
        <div className="bg-white rounded-lg sm:rounded-xl shadow-lg p-3 sm:p-4 md:p-6 mb-4 sm:mb-6">
          <div className="flex flex-wrap gap-2 sm:gap-3 mb-3 sm:mb-4">
            <button
              onClick={() => {
                setEditingDebtId(null);
                setNewDebt({
                  customerName: '',
                  phoneNumber: '',
                  ticketCode: '',
                  route: '',
                  flightDate: '',
                  issueDate: '',
                  ticketAmount: '',
                  paid: '',
                  notes: '',
                  companyId: ''
                });
                setShowAddForm(!showAddForm);
              }}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold text-xs sm:text-sm"
            >
              <Plus size={16} /> <span className="hidden sm:inline">Thêm mới</span>
            </button>
            <button
              onClick={() => setShowRouteManager(!showRouteManager)}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 font-semibold text-xs sm:text-sm"
            >
              <Calendar size={16} /> <span className="hidden md:inline">Quản lý hành trình</span>
            </button>
            <button
              onClick={() => setShowCompanyManager(!showCompanyManager)}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 font-semibold text-xs sm:text-sm"
            >
              <Users size={16} /> <span className="hidden md:inline">Quản lý công ty</span>
            </button>
            <button
              onClick={() => setShowBulkImport(!showBulkImport)}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-semibold text-xs sm:text-sm"
            >
              <Plus size={16} /> <span className="hidden sm:inline">Paste từ Excel</span>
            </button>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-semibold text-xs sm:text-sm"
            >
              <Download size={16} /> <span className="hidden sm:inline">Xuất CSV</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Tìm kiếm..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border-2 border-gray-300 rounded-lg text-sm"
              />
            </div>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="px-3 py-2 border-2 border-gray-300 rounded-lg text-sm"
            >
              <option value="all">Tất cả các tháng</option>
              {availableMonths.map(month => (
                <option key={month} value={month}>
                  Tháng {month.substring(5)}/{month.substring(0, 4)}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border-2 border-gray-300 rounded-lg text-sm"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="unpaid">Còn nợ</option>
              <option value="paid">Đã thanh toán</option>
            </select>
          </div>
        </div>

        {/* Add/Edit Form */}
        {showAddForm && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 mb-4 sm:mb-6">
            <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4">
              {editingDebtId ? 'Chỉnh sửa công nợ' : 'Thêm công nợ mới'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 md:gap-4">
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Tên khách hàng
                </label>
                <input
                  type="text"
                  placeholder="Nhập tên khách hàng"
                  value={newDebt.customerName}
                  onChange={(e) => setNewDebt({ ...newDebt, customerName: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Số điện thoại
                </label>
                <input
                  type="text"
                  placeholder="Nhập số điện thoại"
                  value={newDebt.phoneNumber}
                  onChange={(e) => setNewDebt({ ...newDebt, phoneNumber: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">Mã vé</label>
                <input
                  type="text"
                  placeholder="Nhập mã vé"
                  value={newDebt.ticketCode}
                  onChange={(e) => setNewDebt({ ...newDebt, ticketCode: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Chọn công ty
                </label>
                <select
                  value={newDebt.companyId}
                  onChange={(e) => setNewDebt({ ...newDebt, companyId: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                >
                  <option value="">-- Khách lẻ --</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Chọn hành trình
                </label>
                <select
                  value={newDebt.route}
                  onChange={(e) => setNewDebt({ ...newDebt, route: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                >
                  <option value="">-- Chọn hành trình --</option>
                  {routes.map((r, i) => (
                    <option key={i} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Ngày bay
                </label>
                <input
                  type="date"
                  value={newDebt.flightDate}
                  onChange={(e) => setNewDebt({ ...newDebt, flightDate: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Ngày xuất vé
                </label>
                <input
                  type="date"
                  value={newDebt.issueDate}
                  onChange={(e) => setNewDebt({ ...newDebt, issueDate: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Tiền vé (VNĐ)
                </label>
                <input
                  type="number"
                  placeholder="Nhập số tiền vé"
                  value={newDebt.ticketAmount}
                  onChange={(e) => setNewDebt({ ...newDebt, ticketAmount: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Đã trả (VNĐ)
                </label>
                <input
                  type="number"
                  placeholder="Nhập số tiền đã trả"
                  value={newDebt.paid}
                  onChange={(e) => setNewDebt({ ...newDebt, paid: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                  Ghi chú
                </label>
                <input
                  type="text"
                  placeholder="Nhập ghi chú"
                  value={newDebt.notes}
                  onChange={(e) => setNewDebt({ ...newDebt, notes: e.target.value })}
                  className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg text-xs sm:text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3 mt-3 sm:mt-4">
              <button
                onClick={handleAddDebt}
                className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold text-xs sm:text-sm"
              >
                <Check size={16} /> Lưu
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="flex items-center gap-1 sm:gap-2 px-4 sm:px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold text-xs sm:text-sm"
              >
                <X size={16} /> Hủy
              </button>
            </div>
          </div>
        )}

        {/* Route Manager */}
        {showRouteManager && (
          <div className="bg-teal-50 border-2 border-teal-300 rounded-xl p-6 mb-6">
            <h3 className="text-xl font-bold mb-4">Quản lý Hành trình Bay</h3>
            <div className="flex gap-3 mb-4">
              <input
                type="text"
                value={newRoute}
                onChange={(e) => setNewRoute(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddRoute()}
                placeholder="Nhập hành trình"
                className="flex-1 px-4 py-2 border-2 border-teal-300 rounded-lg uppercase"
              />
              <button
                onClick={handleAddRoute}
                className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {routes.map((route, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-teal-50 px-3 py-2 rounded-lg border border-teal-200 group hover:bg-teal-100"
                >
                  <span className="font-semibold text-teal-800 text-sm">{route}</span>
                  <button
                    onClick={() => handleDeleteRoute(route)}
                    className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowRouteManager(false)}
              className="mt-4 px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Company Manager */}
        {showCompanyManager && (
          <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Quản lý Công ty</h3>
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
                className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 font-semibold"
              >
                <Plus size={18} /> Thêm công ty
              </button>
            </div>

            {showCompanyForm && (
              <div className="mb-6 bg-white rounded-lg p-6 border-2 border-indigo-200">
                <h4 className="font-bold text-gray-800 mb-4">
                  {editingCompanyId ? 'Chỉnh sửa công ty' : 'Thêm công ty mới'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Tên công ty"
                    value={newCompany.name}
                    onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Mã số thuế"
                    value={newCompany.taxCode}
                    onChange={(e) => setNewCompany({ ...newCompany, taxCode: e.target.value })}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Địa chỉ"
                    value={newCompany.address}
                    onChange={(e) => setNewCompany({ ...newCompany, address: e.target.value })}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg md:col-span-2"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={newCompany.email}
                    onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Số điện thoại"
                    value={newCompany.phone}
                    onChange={(e) => setNewCompany({ ...newCompany, phone: e.target.value })}
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Người liên hệ"
                    value={newCompany.contactPerson}
                    onChange={(e) =>
                      setNewCompany({ ...newCompany, contactPerson: e.target.value })
                    }
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleAddCompany}
                    className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold"
                  >
                    <Check size={18} /> Lưu
                  </button>
                  <button
                    onClick={() => setShowCompanyForm(false)}
                    className="flex items-center gap-2 px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold"
                  >
                    <X size={18} /> Hủy
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg p-4 border-2 border-indigo-200 max-h-96 overflow-y-auto">
              {companies.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Chưa có công ty</p>
              ) : (
                <div className="space-y-3">
                  {companies.map(company => {
                    const companyDebts = debts.filter(d => String(d.company_id) === String(company.id));
                    const totalRevenue = companyDebts.reduce(
                      (sum, d) => sum + parseFloat(d.ticket_amount),
                      0
                    );
                    const totalPaidCompany = companyDebts.reduce(
                      (sum, d) => sum + parseFloat(d.paid),
                      0
                    );
                    const remaining = totalRevenue - totalPaidCompany;

                    return (
                      <div key={company.id} className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-bold text-indigo-900">{company.name}</h4>
                            <p className="text-xs text-gray-600">
                              SĐT: {company.phone} | MST: {company.tax_code}
                            </p>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                              <div className="bg-white p-1.5 rounded border border-indigo-200">
                                <p className="text-gray-600">Số vé: {companyDebts.length}</p>
                              </div>
                              <div className="bg-white p-1.5 rounded border border-indigo-200">
                                <p className="text-green-700">Thu: {formatCurrency(totalRevenue)}</p>
                              </div>
                              <div className="bg-white p-1.5 rounded border border-indigo-200">
                                <p className="text-red-700">Nợ: {formatCurrency(remaining)}</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-2">
                            <button
                              onClick={() => handleEditCompany(company)}
                              className="p-1 text-white bg-blue-500 rounded hover:bg-blue-600"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteCompany(company.id)}
                              className="p-1 text-white bg-red-500 rounded hover:bg-red-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowCompanyManager(false)}
              className="mt-4 px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Bulk Import */}
        {showBulkImport && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-6 mb-6">
            <h3 className="text-xl font-bold mb-4">Import từ Excel</h3>
            <textarea
              value={bulkImportText}
              onChange={(e) => setBulkImportText(e.target.value)}
              placeholder="Paste dữ liệu từ Excel..."
              rows="8"
              className="w-full px-4 py-3 border-2 border-orange-300 rounded-lg font-mono text-sm"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleBulkImport}
                className="flex items-center gap-2 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-semibold"
              >
                <Check size={18} /> Import
              </button>
              <button
                onClick={() => {
                  setShowBulkImport(false);
                  setBulkImportText('');
                }}
                className="flex items-center gap-2 px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold"
              >
                <X size={18} /> Hủy
              </button>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-lg sm:rounded-xl shadow-lg overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white sticky top-0">
                <tr>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold">Khách hàng</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold hidden sm:table-cell">Công ty</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold hidden md:table-cell">SĐT</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold">Mã vé</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold hidden lg:table-cell">Hành trình</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold">Ngày bay</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-bold hidden md:table-cell">Ngày xuất vé</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-bold">Tiền vé</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-bold hidden sm:table-cell">Đã trả</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-right font-bold">Còn nợ</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredDebts.length === 0 ? (
                  <tr>
                    <td colSpan="11" className="px-4 py-8 text-center text-gray-500">
                      Chưa có dữ liệu
                    </td>
                  </tr>
                ) : (
                  filteredDebts.map((debt, idx) => (
                    <tr key={debt.id} className={`hover:bg-blue-50 transition ${idx % 2 === 0 ? 'bg-gray-50' : ''}`}>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-900">
                        {debt.customer_name.length > 15 ? debt.customer_name.substring(0, 15) + '...' : debt.customer_name}
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 hidden sm:table-cell">
                        <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded text-xs">
                          {getCompanyById(debt.company_id)?.name?.substring(0, 10) || 'Khách lẻ'}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 hidden md:table-cell">{debt.phone_number}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3">
                        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                          {debt.ticket_code.substring(0, 8)}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 hidden lg:table-cell">
                        <span className="bg-teal-100 text-teal-800 px-2 py-1 rounded text-xs">
                          {debt.route}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 font-medium">{formatDateDisplay(debt.flight_date)}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 hidden md:table-cell">
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                          {formatDateDisplay(debt.issue_date)}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-gray-900">
                        {formatCurrency(debt.ticket_amount).substring(0, 12)}
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-green-600 hidden sm:table-cell">
                        {formatCurrency(debt.paid).substring(0, 10)}
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-bold">
                        <span
                          className={
                            calculateRemaining(debt.ticket_amount, debt.paid) > 0
                              ? 'text-red-600'
                              : 'text-green-600'
                          }
                        >
                          {formatCurrency(calculateRemaining(debt.ticket_amount, debt.paid)).substring(0, 12)}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => handleEditDebt(debt)}
                            className="p-1 text-white bg-blue-500 rounded hover:bg-blue-600 text-xs"
                            title="Sửa"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteDebt(debt.id)}
                            className="p-1 text-white bg-red-500 rounded hover:bg-red-600 text-xs"
                            title="Xóa"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Help Section */}
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6">
          <h4 className="font-bold text-yellow-800 mb-3 text-lg">💡 Hướng dẫn Import CSV/Excel:</h4>
          <p className="text-sm text-yellow-700 mb-3">File CSV cần có các cột theo thứ tự sau:</p>
          <div className="bg-white rounded-lg p-4 border-2 border-yellow-200 mb-3">
            <code className="text-sm text-gray-800 font-mono block">
              Tên khách hàng, Số điện thoại, Mã vé, Hành trình, Ngày bay, Ngày xuất vé, Tiền vé, Đã
              thanh toán, Ghi chú
            </code>
          </div>
          <p className="text-sm text-yellow-700">
            ✅ Ví dụ:{' '}
            <span className="font-mono bg-white px-2 py-1 rounded">
              Nguyễn Văn A, 0912345678, VN123, HAN-SGN, 2024-01-15, 2024-01-10, 5000000, 3000000,
              Đã đặt cọc
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;