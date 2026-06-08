import React, { useState, useEffect } from 'react';
import { Plus, LogOut, Lock, Calendar, Edit2, Trash2, Check, X, Search, Download, Upload, Users, TrendingUp, TrendingDown, DollarSign, Users2, Landmark, Eye, EyeOff } from 'lucide-react';
import ImportModal from './components/ImportModal';
import PaymentModal from './components/PaymentModal';
import AgencyFilter from './components/AgencyFilter';
import VnDatePicker from './components/VnDatePicker';
import MoneyInput from './components/MoneyInput';
import ConfirmDialog from './components/ConfirmDialog';
import { exportWorkbook } from './utils/excel';
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
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs sm:text-sm opacity-90 font-medium">{label}</p>
        <p className="text-lg sm:text-2xl font-bold mt-1 sm:mt-2 truncate">{value}</p>
      </div>
      <div className="p-2 sm:p-3 bg-white/20 rounded-lg sm:rounded-xl flex-shrink-0">
        <Icon size={18} className="sm:w-6 sm:h-6" />
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

// Các cột có thể ẩn/hiện (5 cột lõi không nằm ở đây vì luôn hiện).
const TOGGLE_COLS = [
  { key: 'ticket_source', label: 'Nguồn vé' },
  { key: 'issue_date', label: 'Ngày xuất vé' },
  { key: 'ticket_amount', label: 'Tiền vé' },
  { key: 'cost_amount', label: 'Giá gốc' },
  { key: 'profit', label: 'Lợi nhuận' },
  { key: 'paid', label: 'Đã trả' },
  { key: 'remaining', label: 'Còn nợ' },
  { key: 'phone', label: 'SĐT' },
  { key: 'company', label: 'Công ty' },
  { key: 'agency', label: 'Đại lý' },
];
const DEFAULT_VISIBLE = {
  ticket_source: true, issue_date: true, ticket_amount: true, cost_amount: true, profit: true,
  paid: true, remaining: true, phone: true, company: true, agency: false,
};

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
    ticketSource: '',
    ticketAmount: '',
    costAmount: '',
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
  // Hộp thoại xác nhận + toast (thay confirm()/alert() gốc) + chọn nhiều để xóa.
  const [confirmState, setConfirmState] = useState(null); // { message, title?, confirmText?, onConfirm }
  const [toast, setToast] = useState(null);               // { message, type }
  const [selectedIds, setSelectedIds] = useState([]);
  // Ẩn/hiện cột (trừ 5 cột lõi luôn hiện: Khách hàng, Mã vé, Hành trình, Ngày bay, Hãng).
  // Nhớ lựa chọn qua localStorage; gộp với mặc định để cột mới (nếu có) vẫn đúng.
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('debtVisibleCols') || 'null');
      return saved ? { ...DEFAULT_VISIBLE, ...saved } : DEFAULT_VISIBLE;
    } catch { return DEFAULT_VISIBLE; }
  });
  const [showColMenu, setShowColMenu] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    localStorage.setItem('debtVisibleCols', JSON.stringify(visibleCols));
  }, [visibleCols]);
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

  // Toast nhỏ góc màn hình, tự ẩn sau 2.5s.
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };
  // Mở hộp thoại xác nhận; chạy action khi người dùng bấm đồng ý.
  const askConfirm = (message, onConfirm, opts = {}) => setConfirmState({ message, onConfirm, ...opts });

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
    askConfirm('Bạn có chắc muốn đăng xuất?', () => {
      setIsLoggedIn(false);
      setCurrentUser('');
      setToken('');
      setDebts([]);
      setRoutes([]);
      setCompanies([]);
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
    }, { title: 'Đăng xuất', confirmText: 'Đăng xuất', danger: false });
  };

  const handleAddDebt = () => {
    if (!newDebt.customerName || !newDebt.ticketAmount) {
      showToast('Vui lòng nhập tên khách hàng và tiền vé', 'error');
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
        ticketSource: newDebt.ticketSource,
        ticketAmount: parseFloat(newDebt.ticketAmount),
        costAmount: parseFloat(newDebt.costAmount) || 0,
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
          showToast('Cập nhật công nợ thành công');
        } else {
          setDebts([...debts, debt]);
          showToast('Đã thêm công nợ mới');
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
          ticketSource: '',
          ticketAmount: '',
          costAmount: '',
          paid: '',
          notes: '',
          companyId: '',
          paymentTarget: 'self'
        });
        setEditingDebtId(null);
        setShowAddForm(false);
      })
      .catch(() => showToast('Lỗi khi lưu công nợ', 'error'));
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
      ticketSource: debt.ticket_source || '',
      ticketAmount: debt.ticket_amount,
      costAmount: debt.cost_amount,
      paid: debt.paid,
      notes: debt.notes,
      companyId: debt.company_id || '',
      paymentTarget: Number(debt.agency_paid) > 0 ? 'agency' : 'self'
    });
    setEditingDebtId(debt.id);
    setShowAddForm(true);
  };

  const handleDeleteDebt = (debt) => {
    askConfirm(`Xóa công nợ của "${debt.customer_name}"?`, () => {
      fetch(`${API_URL}/debts/${debt.id}`, {
        method: 'DELETE',
        headers: getHeaders()
      })
        .then(() => {
          setDebts(debts.filter(d => d.id !== debt.id));
          setSelectedIds(prev => prev.filter(x => x !== debt.id));
          showToast('Đã xóa công nợ');
        })
        .catch(() => showToast('Lỗi khi xóa', 'error'));
    });
  };

  // ----- Chọn nhiều & xóa hàng loạt -----
  const toggleSelect = (id) =>
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    askConfirm(`Xóa ${selectedIds.length} công nợ đã chọn? Hành động này không thể hoàn tác.`, () => {
      fetch(`${API_URL}/debts/bulk-delete`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ids: selectedIds }),
      })
        .then(res => { if (!res.ok) throw new Error(); return res.json(); })
        .then(data => {
          const removed = new Set(selectedIds);
          setDebts(debts.filter(d => !removed.has(d.id)));
          setSelectedIds([]);
          showToast(`Đã xóa ${data.deleted} công nợ`);
        })
        .catch(() => showToast('Lỗi khi xóa hàng loạt', 'error'));
    }, { confirmText: `Xóa ${selectedIds.length} mục` });
  };

  const handleAddRoute = () => {
    const trimmedRoute = newRoute.trim().toUpperCase();
    if (!trimmedRoute) {
      showToast('Vui lòng nhập hành trình', 'error');
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
        showToast('Đã thêm hành trình');
      })
      .catch(() => showToast('Lỗi khi thêm hành trình', 'error'));
  };

  const handleDeleteRoute = (route) => {
    askConfirm(`Xóa hành trình "${route}"?`, () => {
      fetch(`${API_URL}/routes/${encodeURIComponent(route)}`, {
        method: 'DELETE',
        headers: getHeaders()
      })
        .then(() => { setRoutes(routes.filter(r => r !== route)); showToast('Đã xóa hành trình'); })
        .catch(() => showToast('Lỗi khi xóa hành trình', 'error'));
    });
  };

  const getCompanyById = (companyId) => {
    if (!companyId) return null;
    return companies.find(c => String(c.id) === String(companyId));
  };

  const resetCompanyForm = () => setNewCompany({
    name: '', taxCode: '', address: '', email: '', contactPerson: '', phone: '', creditLimit: ''
  });

  const handleSaveCompany = () => {
    if (!newCompany.name.trim()) {
      showToast('Vui lòng nhập tên công ty', 'error');
      return;
    }
    const url = editingCompanyId ? `${API_URL}/companies/${editingCompanyId}` : `${API_URL}/companies`;
    const method = editingCompanyId ? 'PUT' : 'POST';
    fetch(url, {
      method,
      headers: getHeaders(),
      body: JSON.stringify({
        name: newCompany.name.trim(),
        taxCode: newCompany.taxCode,
        address: newCompany.address,
        email: newCompany.email,
        contactPerson: newCompany.contactPerson,
        phone: newCompany.phone,
        creditLimit: parseFloat(newCompany.creditLimit) || 0,
      }),
    })
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(saved => {
        setCompanies(editingCompanyId
          ? companies.map(c => (c.id === editingCompanyId ? saved : c))
          : [...companies, saved]);
        resetCompanyForm();
        setEditingCompanyId(null);
        setShowCompanyForm(false);
        showToast(editingCompanyId ? 'Cập nhật công ty thành công' : 'Đã thêm công ty mới');
      })
      .catch(() => showToast('Lỗi khi lưu công ty', 'error'));
  };

  const handleEditCompany = (c) => {
    setNewCompany({
      name: c.name || '',
      taxCode: c.tax_code || '',
      address: c.address || '',
      email: c.email || '',
      contactPerson: c.contact_person || '',
      phone: c.phone || '',
      creditLimit: c.credit_limit || '',
    });
    setEditingCompanyId(c.id);
    setShowCompanyForm(true);
  };

  const handleDeleteCompany = (company) => {
    askConfirm(`Xóa công ty "${company.name}"?`, () => {
      fetch(`${API_URL}/companies/${company.id}`, { method: 'DELETE', headers: getHeaders() })
        .then(() => { setCompanies(companies.filter(c => c.id !== company.id)); showToast('Đã xóa công ty'); })
        .catch(() => showToast('Lỗi khi xóa công ty', 'error'));
    });
  };

  // Nhãn "Thanh toán vào": phân biệt tiền khách trả vào TK cá nhân hay nộp quỹ cấp trên.
  const paymentTargetLabel = (debt) => {
    const paid = Number(debt.paid) || 0;
    const agency = Number(debt.agency_paid) || 0;
    if (paid <= 0) return '';
    if (agency <= 0) return 'Cá nhân';
    if (agency >= paid) return 'Nộp quỹ (cấp trên)';
    return 'Hỗn hợp';
  };

  const exportToCSV = () => {
    const headers = [
      'Tên khách hàng',
      'Công ty',
      'Số điện thoại',
      'Mã vé',
      'Hãng',
      'Nguồn vé',
      'Hành trình',
      'Ngày bay',
      'Ngày xuất vé',
      'Tiền vé',
      'Giá gốc',
      'Lợi nhuận',
      'Đã thanh toán',
      'Thanh toán vào',
      'Còn nợ',
      'Ghi chú'
    ];

    const rows = filteredDebts.map(debt => {
      const ticket = Number(debt.ticket_amount) || 0;
      const cost = Number(debt.cost_amount) || 0;
      const paid = Number(debt.paid) || 0;
      return [
        debt.customer_name,
        getCompanyById(debt.company_id)?.name || 'Khách lẻ',
        debt.phone_number,
        debt.ticket_code,
        debt.airline,
        debt.ticket_source || '',
        debt.route,
        formatDateDisplay(debt.flight_date),
        formatDateDisplay(debt.issue_date),
        ticket,
        cost,
        ticket - cost,
        paid,
        paymentTargetLabel(debt),
        ticket - paid,
        debt.notes,
      ];
    });

    const esc = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(row => row.map(esc).join(',')).join('\r\n');
    // ﻿ = BOM UTF-8 để Excel nhận đúng tiếng Việt thay vì đọc theo ANSI.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cong-no-ve-may-bay-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Xuất file Excel (.xlsx) — số tiền có định dạng ngăn cách nghìn, Excel tính/sum được.
  // Gồm 2 sheet: chi tiết công nợ + tổng kết lợi nhuận theo tháng.
  const exportToXLSX = async () => {
    // --- Sheet 1: chi tiết ---
    const headers = [
      'Khách hàng', 'Công ty', 'SĐT', 'Mã vé', 'Hãng', 'Nguồn vé', 'Hành trình', 'Ngày bay', 'Ngày xuất vé',
      'Tiền vé', 'Giá gốc', 'Lợi nhuận', 'Đã thanh toán', 'Thanh toán vào', 'Còn nợ', 'Ghi chú',
    ];
    const rows = filteredDebts.map((debt) => {
      const ticket = Number(debt.ticket_amount) || 0;
      const cost = Number(debt.cost_amount) || 0;
      const paid = Number(debt.paid) || 0;
      return [
        debt.customer_name,
        getCompanyById(debt.company_id)?.name || 'Khách lẻ',
        debt.phone_number || '',
        debt.ticket_code || '',
        debt.airline || '',
        debt.ticket_source || '',
        debt.route || '',
        formatDateDisplay(debt.flight_date),
        formatDateDisplay(debt.issue_date),
        ticket, cost, ticket - cost, paid, paymentTargetLabel(debt), ticket - paid,
        debt.notes || '',
      ];
    });

    // --- Sheet 2: tổng kết theo tháng (nhóm theo tháng xuất vé) ---
    const byMonth = {};
    filteredDebts.forEach((d) => {
      const m = (d.issue_date || '').slice(0, 7) || 'Không rõ';
      if (!byMonth[m]) byMonth[m] = { count: 0, ticket: 0, cost: 0, paid: 0 };
      byMonth[m].count += 1;
      byMonth[m].ticket += Number(d.ticket_amount) || 0;
      byMonth[m].cost += Number(d.cost_amount) || 0;
      byMonth[m].paid += Number(d.paid) || 0;
    });
    const months = Object.keys(byMonth).sort();
    const sumHeaders = ['Tháng', 'Số vé', 'Doanh số', 'Giá gốc', 'Lợi nhuận', 'Đã thu', 'Còn nợ'];
    const sumRows = months.map((m) => {
      const x = byMonth[m];
      return [m, x.count, x.ticket, x.cost, x.ticket - x.cost, x.paid, x.ticket - x.paid];
    });
    const tot = months.reduce((a, m) => {
      const x = byMonth[m];
      a.count += x.count; a.ticket += x.ticket; a.cost += x.cost; a.paid += x.paid;
      return a;
    }, { count: 0, ticket: 0, cost: 0, paid: 0 });
    sumRows.push(['TỔNG CỘNG', tot.count, tot.ticket, tot.cost, tot.ticket - tot.cost, tot.paid, tot.ticket - tot.paid]);

    try {
      await exportWorkbook(`cong-no-ve-may-bay-${new Date().toISOString().split('T')[0]}.xlsx`, [
        {
          name: 'Công nợ vé',
          aoa: [headers, ...rows],
          colWidths: [22, 18, 13, 12, 14, 16, 14, 12, 12, 13, 13, 13, 14, 16, 13, 22],
          moneyCols: [9, 10, 11, 12, 14], // Tiền vé, Giá gốc, Lợi nhuận, Đã thanh toán, Còn nợ
        },
        {
          name: 'Tổng kết tháng',
          aoa: [sumHeaders, ...sumRows],
          colWidths: [12, 8, 16, 16, 16, 16, 16],
          moneyCols: [2, 3, 4, 5, 6], // Doanh số, Giá gốc, Lợi nhuận, Đã thu, Còn nợ
        },
      ]);
    } catch {
      showToast('Lỗi khi xuất Excel', 'error');
    }
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
      case 'cost_amount': return parseFloat(d.cost_amount) || 0;
      case 'profit': return (parseFloat(d.ticket_amount) || 0) - (parseFloat(d.cost_amount) || 0);
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

  // Các dòng được phép chọn để xóa (chỉ của chính mình).
  const selectableIds = sortedDebts
    .filter(d => !currentUserId || d.user_id === currentUserId)
    .map(d => d.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? [] : selectableIds);

  // Phân trang phía client (chỉ render 1 trang cho nhẹ; export/chọn-tất-cả vẫn trên toàn bộ danh sách lọc).
  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(sortedDebts.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pagedDebts = sortedDebts.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  // Về trang 1 khi đổi bộ lọc.
  useEffect(() => { setPage(1); }, [searchTerm, filterStatus, filterMonth, agencyId]);

  // Gợi ý nguồn xuất vé: các giá trị đã từng nhập (không trùng).
  const ticketSources = [...new Set(debts.map(d => d.ticket_source).filter(Boolean))].sort();

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };
  const sortArrow = (key) => (sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const totalAmount = filteredDebts.reduce((sum, d) => sum + (parseFloat(d.ticket_amount) || 0), 0);
  const totalPaid = filteredDebts.reduce((sum, d) => sum + (parseFloat(d.paid) || 0), 0);
  const totalDebt = totalAmount - totalPaid;
  // Lợi nhuận vé máy bay theo đúng bộ lọc đang chọn (tháng/trạng thái/tìm kiếm).
  const totalProfit = filteredDebts.reduce((sum, d) => sum + ((parseFloat(d.ticket_amount) || 0) - (parseFloat(d.cost_amount) || 0)), 0);
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-6 mb-6 sm:mb-8">
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
            <StatCard
              icon={TrendingUp}
              label="Lợi nhuận"
              value={formatCurrency(totalProfit).split(',')[0]}
              color="from-amber-500 to-orange-600"
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
                    ticketSource: '',
                    ticketAmount: '',
                    costAmount: '',
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
                onClick={exportToXLSX}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold text-xs sm:text-sm"
              >
                <Download size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Excel</span>
              </button>
              <button
                onClick={exportToCSV}
                className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold text-xs sm:text-sm"
              >
                <Download size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">CSV</span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowColMenu((v) => !v)}
                  className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold text-xs sm:text-sm"
                  title="Tùy chọn cột hiển thị"
                >
                  <Eye size={16} className="sm:w-5 sm:h-5" /> <span className="hidden sm:inline">Cột</span>
                </button>
                {showColMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                    <div className="absolute right-0 mt-1 w-56 bg-white border rounded-lg shadow-xl z-20 p-2">
                      <p className="text-xs text-gray-400 px-2 py-1">Hiện/ẩn cột (5 cột chính luôn hiện)</p>
                      {TOGGLE_COLS.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={!!visibleCols[c.key]}
                            onChange={() => setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))}
                            className="w-4 h-4 rounded"
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
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
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Nguồn xuất vé</label>
                  <input
                    type="text"
                    list="ticket-source-options"
                    placeholder="VD: Ngọc Mai, website, Bảo Gia Trần"
                    value={newDebt.ticketSource}
                    onChange={(e) => setNewDebt({ ...newDebt, ticketSource: e.target.value })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                  <datalist id="ticket-source-options">
                    {ticketSources.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
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
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Tiền vé / giá bán (VNĐ) *</label>
                  <MoneyInput
                    placeholder="Giá bán cho khách"
                    value={newDebt.ticketAmount}
                    onChange={(v) => setNewDebt({ ...newDebt, ticketAmount: v })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">Giá gốc / giá vốn (VNĐ)</label>
                  <MoneyInput
                    placeholder="Giá nhập vé"
                    value={newDebt.costAmount}
                    onChange={(v) => setNewDebt({ ...newDebt, costAmount: v })}
                    className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition text-xs sm:text-sm"
                  />
                  {newDebt.ticketAmount && newDebt.costAmount && (
                    <p className="text-xs mt-1 text-gray-500">
                      Lợi nhuận: <span className={(parseFloat(newDebt.ticketAmount) - parseFloat(newDebt.costAmount)) >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                        {formatCurrency(parseFloat(newDebt.ticketAmount) - parseFloat(newDebt.costAmount))}
                      </span>
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1">
                    {editingDebtId ? 'Đã trả (tổng — chỉ đọc)' : 'Trả trước (VNĐ)'}
                  </label>
                  <MoneyInput
                    placeholder={editingDebtId ? '' : 'Số tiền khách trả trước (nếu có)'}
                    value={newDebt.paid}
                    onChange={(v) => setNewDebt({ ...newDebt, paid: v })}
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

          {/* Thanh xóa hàng loạt — hiện khi có dòng được chọn */}
          {selectedIds.length > 0 && (
            <div className="flex items-center justify-between gap-3 mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
              <span className="text-sm font-medium text-red-700">Đã chọn {selectedIds.length} công nợ</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedIds([])}
                  className="px-3 py-1.5 rounded-lg bg-white border text-gray-600 hover:bg-gray-50 text-xs sm:text-sm font-semibold"
                >
                  Bỏ chọn
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 text-xs sm:text-sm font-semibold"
                >
                  <Trash2 size={15} /> Xóa đã chọn ({selectedIds.length})
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
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap sticky left-0 z-20 hover:bg-blue-700">
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          title="Chọn tất cả"
                          className="w-4 h-4 rounded cursor-pointer accent-white"
                        />
                        <span onClick={() => toggleSort('customer_name')} className="cursor-pointer select-none">Khách hàng{sortArrow('customer_name')}</span>
                      </span>
                    </th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Mã vé</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Hành trình</th>
                    <th onClick={() => toggleSort('flight_date')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Ngày bay{sortArrow('flight_date')}</th>
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Hãng</th>
                    {visibleCols.ticket_source && <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Nguồn vé</th>}
                    {visibleCols.issue_date && <th onClick={() => toggleSort('issue_date')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Ngày xuất vé{sortArrow('issue_date')}</th>}
                    {visibleCols.ticket_amount && <th onClick={() => toggleSort('ticket_amount')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Tiền vé{sortArrow('ticket_amount')}</th>}
                    {visibleCols.cost_amount && <th onClick={() => toggleSort('cost_amount')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Giá gốc{sortArrow('cost_amount')}</th>}
                    {visibleCols.profit && <th onClick={() => toggleSort('profit')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Lợi nhuận{sortArrow('profit')}</th>}
                    {visibleCols.paid && <th onClick={() => toggleSort('paid')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Đã trả{sortArrow('paid')}</th>}
                    {visibleCols.remaining && <th onClick={() => toggleSort('remaining')} className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right whitespace-nowrap cursor-pointer select-none hover:bg-blue-700">Còn nợ{sortArrow('remaining')}</th>}
                    {visibleCols.phone && <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">SĐT</th>}
                    {visibleCols.company && <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Công ty</th>}
                    {visibleCols.agency && <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-left whitespace-nowrap">Đại lý</th>}
                    <th className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-center whitespace-nowrap">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedDebts.length === 0 ? (
                    <tr>
                      <td colSpan={6 + TOGGLE_COLS.filter((c) => visibleCols[c.key]).length} className="px-4 py-8 sm:py-12 text-center text-gray-500 font-medium text-xs sm:text-base">
                        📊 Chưa có dữ liệu
                      </td>
                    </tr>
                  ) : (
                    pagedDebts.map((debt, idx) => {
                      const remaining = calculateRemaining(debt.ticket_amount, debt.paid);
                      const isPaid = remaining <= 0;
                      // Trạng thái thanh toán: đã đủ (xanh) / trả một phần (cam) / chưa trả (đỏ)
                      const payStatus = isPaid ? 'paid' : ((parseFloat(debt.paid) || 0) > 0 ? 'partial' : 'unpaid');
                      // Quá hạn = còn nợ + đã qua hạn thanh toán
                      const isOverdue = !isPaid && debt.due_date && debt.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
                      const dotColor = isOverdue ? 'bg-red-600' : payStatus === 'paid' ? 'bg-green-500' : payStatus === 'partial' ? 'bg-amber-500' : 'bg-red-500';
                      const dotTitle = isOverdue ? 'Quá hạn thanh toán' : payStatus === 'paid' ? 'Đã trả đủ' : payStatus === 'partial' ? 'Trả một phần' : 'Chưa trả';
                      const owned = !currentUserId || debt.user_id === currentUserId;
                      const profit = (Number(debt.ticket_amount) || 0) - (Number(debt.cost_amount) || 0);
                      return (
                        <tr key={debt.id} className={`hover:bg-gray-50 transition ${idx % 2 === 0 ? 'bg-gray-50' : ''}`}>
                          <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 font-semibold text-xs sm:text-sm whitespace-nowrap sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                            <span className="inline-flex items-center gap-2">
                              {owned && (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(debt.id)}
                                  onChange={() => toggleSelect(debt.id)}
                                  className="w-4 h-4 rounded cursor-pointer shrink-0"
                                />
                              )}
                              <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} title={dotTitle}></span>
                              <span
                                onClick={owned ? () => handleEditDebt(debt) : undefined}
                                title={owned ? 'Bấm để sửa' : undefined}
                                className={`${isOverdue || payStatus === 'unpaid' ? 'text-red-600' : 'text-gray-900'} ${owned ? 'cursor-pointer hover:underline' : ''}`}
                              >{debt.customer_name}</span>
                              {isOverdue && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">⚠ Quá hạn</span>}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4">
                            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-blue-100 text-blue-800 rounded-lg text-xs font-mono whitespace-nowrap">
                              {debt.ticket_code}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4">
                            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-teal-100 text-teal-800 rounded-full text-xs font-medium whitespace-nowrap">
                              {debt.route}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm font-medium text-gray-900 whitespace-nowrap">{formatDateDisplay(debt.flight_date)}</td>
                          <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">{debt.airline}</td>
                          {visibleCols.ticket_source && <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">{debt.ticket_source || '—'}</td>}
                          {visibleCols.issue_date && (
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm font-medium text-gray-600">
                              <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-green-100 text-green-800 rounded-lg whitespace-nowrap">
                                {formatDateDisplay(debt.issue_date)}
                              </span>
                            </td>
                          )}
                          {visibleCols.ticket_amount && <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-semibold text-gray-900 text-xs sm:text-sm whitespace-nowrap">{formatCurrency(debt.ticket_amount)}</td>}
                          {visibleCols.cost_amount && <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right text-gray-500 text-xs sm:text-sm whitespace-nowrap">{formatCurrency(debt.cost_amount)}</td>}
                          {visibleCols.profit && <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-semibold text-xs sm:text-sm whitespace-nowrap ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(profit)}</td>}
                          {visibleCols.paid && (
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-semibold text-green-600 text-xs sm:text-sm whitespace-nowrap">
                              {formatCurrency(debt.paid)}
                              {Number(debt.agency_paid) > 0 && (
                                <span className="block text-[10px] text-orange-600 font-normal" title="Đã chuyển vào TK cấp trên">
                                  <Landmark size={10} className="inline mr-0.5" />{formatCurrency(debt.agency_paid)}
                                </span>
                              )}
                            </td>
                          )}
                          {visibleCols.remaining && (
                            <td className={`px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-right font-bold text-xs sm:text-sm whitespace-nowrap ${isPaid ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(remaining)}
                            </td>
                          )}
                          {visibleCols.phone && <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">{debt.phone_number}</td>}
                          {visibleCols.company && (
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4">
                              <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-medium whitespace-nowrap">
                                {getCompanyById(debt.company_id)?.name || 'Khách lẻ'}
                              </span>
                            </td>
                          )}
                          {visibleCols.agency && (
                            <td className="px-2 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 text-xs text-gray-600 whitespace-nowrap">
                              {debt.owner_name || debt.owner_username || ''}
                            </td>
                          )}
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
                                  onClick={() => handleDeleteDebt(debt)}
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
            {sortedDebts.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t bg-gray-50 text-xs sm:text-sm">
                <span className="text-gray-500">
                  {(curPage - 1) * PAGE_SIZE + 1}–{Math.min(curPage * PAGE_SIZE, sortedDebts.length)} / {sortedDebts.length} dòng
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1} className="px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100 font-semibold">Trước</button>
                  <span className="px-2 text-gray-600">Trang {curPage}/{totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages} className="px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40 hover:bg-gray-100 font-semibold">Sau</button>
                </div>
              </div>
            )}
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
                      placeholder="Tên công ty *"
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
                    <input
                      type="text"
                      placeholder="Địa chỉ"
                      value={newCompany.address}
                      onChange={(e) => setNewCompany({ ...newCompany, address: e.target.value })}
                      className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none transition text-xs sm:text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Số điện thoại"
                      value={newCompany.phone}
                      onChange={(e) => setNewCompany({ ...newCompany, phone: e.target.value })}
                      className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none transition text-xs sm:text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Người liên hệ"
                      value={newCompany.contactPerson}
                      onChange={(e) => setNewCompany({ ...newCompany, contactPerson: e.target.value })}
                      className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none transition text-xs sm:text-sm"
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={newCompany.email}
                      onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })}
                      className="px-3 sm:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none transition text-xs sm:text-sm"
                    />
                  </div>
                  <div className="flex gap-2 sm:gap-3">
                    <button
                      onClick={handleSaveCompany}
                      className="flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-1.5 sm:py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold text-xs sm:text-sm"
                    >
                      <Plus size={16} className="sm:w-5 sm:h-5" /> {editingCompanyId ? 'Cập nhật' : 'Lưu công ty'}
                    </button>
                    <button
                      onClick={() => { setShowCompanyForm(false); setEditingCompanyId(null); resetCompanyForm(); }}
                      className="flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-1.5 sm:py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold text-xs sm:text-sm"
                    >
                      <X size={16} className="sm:w-5 sm:h-5" /> Hủy
                    </button>
                  </div>
                </div>
              )}

              {companies.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {companies.map((c) => (
                    <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 sm:px-4 py-2 border border-indigo-100">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {[c.tax_code && `MST: ${c.tax_code}`, c.phone, c.contact_person, c.address, c.email]
                            .filter(Boolean).join(' • ') || '—'}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0 ml-2">
                        <button
                          onClick={() => handleEditCompany(c)}
                          className="p-1.5 sm:p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
                          title="Sửa"
                        >
                          <Edit2 size={14} className="sm:w-4 sm:h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(c)}
                          className="p-1.5 sm:p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
                          title="Xóa"
                        >
                          <Trash2 size={14} className="sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-4">Chưa có công ty nào.</p>
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

          {/* Hộp thoại xác nhận (thay window.confirm) */}
          <ConfirmDialog
            open={!!confirmState}
            message={confirmState?.message}
            confirmText={confirmState?.confirmText}
            title={confirmState?.title}
            danger={confirmState?.danger ?? true}
            onCancel={() => setConfirmState(null)}
            onConfirm={() => { confirmState?.onConfirm?.(); setConfirmState(null); }}
          />
        </div>
      </div>

      {/* Toast thông báo (thay alert) */}
      {toast && (
        <div
          className={`fixed bottom-24 right-5 z-[70] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
        >
          {toast.type === 'error' ? '❌ ' : '✅ '}{toast.message}
        </div>
      )}
    </div>
  );
};

export default App;