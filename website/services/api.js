import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Tạo axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor để tự động thêm token vào mọi request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor để xử lý lỗi 401 (unauthorized)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token hết hạn hoặc không hợp lệ
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// ==================== AUTH APIs ====================
export const authAPI = {
  login: async (username, password) => {
    const response = await api.post('/auth/login', { username, password });
    return response.data;
  },
  
  register: async (username, password, fullName) => {
    const response = await api.post('/auth/register', { username, password, fullName });
    return response.data;
  },
  
  getProfile: async () => {
    const response = await api.get('/auth/profile');
    return response.data;
  },
};

// ==================== DEBTS APIs ====================
export const debtsAPI = {
  getAll: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.month && filters.month !== 'all') params.append('month', filters.month);
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.search) params.append('search', filters.search);
    
    const response = await api.get(`/debts?${params.toString()}`);
    return response.data;
  },
  
  create: async (debt) => {
    const response = await api.post('/debts', debt);
    return response.data;
  },
  
  update: async (id, debt) => {
    const response = await api.put(`/debts/${id}`, debt);
    return response.data;
  },
  
  delete: async (id) => {
    const response = await api.delete(`/debts/${id}`);
    return response.data;
  },
  
  bulkCreate: async (debts) => {
    const response = await api.post('/debts/bulk', { debts });
    return response.data;
  },
};

// ==================== COMPANIES APIs ====================
export const companiesAPI = {
  getAll: async () => {
    const response = await api.get('/companies');
    return response.data;
  },
  
  create: async (company) => {
    const response = await api.post('/companies', company);
    return response.data;
  },
  
  update: async (id, company) => {
    const response = await api.put(`/companies/${id}`, company);
    return response.data;
  },
  
  delete: async (id) => {
    const response = await api.delete(`/companies/${id}`);
    return response.data;
  },
  
  getDebts: async (id) => {
    const response = await api.get(`/companies/${id}/debts`);
    return response.data;
  },
};

// ==================== ROUTES APIs ====================
export const routesAPI = {
  getAll: async () => {
    const response = await api.get('/routes');
    return response.data;
  },
  
  create: async (code) => {
    const response = await api.post('/routes', { code });
    return response.data;
  },
  
  delete: async (id) => {
    const response = await api.delete(`/routes/${id}`);
    return response.data;
  },
};

export default api;