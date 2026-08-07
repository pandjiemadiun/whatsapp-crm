import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token from localStorage to every request
api.interceptors.request.use((config) => {
  try {
    const stored = localStorage.getItem('garuda_user');
    if (stored) {
      const user = JSON.parse(stored);
      if (user.token) {
        config.headers.Authorization = `Bearer ${user.token}`;
      }
    }
  } catch {}
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    // Jangan redirect pada endpoint auth (login/register) — biarkan komponen
    // menampilkan pesan error (mis. "Invalid email or password").
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
    if (err.response?.status === 401 && !isAuthEndpoint) {
      // Token invalid/expired — redirect to login
      localStorage.removeItem('garuda_user');
      window.location.href = '/';
    }
    console.error('API Error:', err.response?.data || err.message);
    return Promise.reject(err);
  }
);

export default api;
