import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import adminApi from '../services/adminApi';

interface AdminUser {
  adminId: string;
  email: string;
  role: 'super_admin' | 'support_admin';
  token: string;
}

interface AdminAuthContextType {
  admin: AdminUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(() => {
    const stored = localStorage.getItem('garuda_admin');
    return stored ? JSON.parse(stored) : null;
  });

  const saveAdmin = (a: AdminUser) => {
    setAdmin(a);
    localStorage.setItem('garuda_admin', JSON.stringify(a));
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await adminApi.post('/auth/login', { email, password });
    const d = res.data.data;
    saveAdmin({
      adminId: d.adminId,
      email: d.email,
      role: d.role,
      token: d.token,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.post('/auth/logout');
    } catch {
      // Ignore — token might already be invalid
    }
    setAdmin(null);
    localStorage.removeItem('garuda_admin');
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, isAuthenticated: !!admin, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
