import axios from 'axios';

const adminApi = axios.create({
  baseURL: '/api/admin',
  headers: { 'Content-Type': 'application/json' },
});

adminApi.interceptors.request.use((config) => {
  try {
    const stored = localStorage.getItem('garuda_admin');
    if (stored) {
      const admin = JSON.parse(stored);
      if (admin.token) {
        config.headers.Authorization = `Bearer ${admin.token}`;
      }
    }
  } catch {}
  return config;
});

adminApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('garuda_admin');
      window.location.href = '/admin/login';
    }
    return Promise.reject(err);
  }
);

export default adminApi;
