import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import api from '../services/api';

export interface StoreFormData {
  name: string;
  timezone?: string;
  phoneNumber?: string;
  email?: string;
  isActive?: boolean;
}

interface User {
  email: string;
  storeId: string;
  storeName: string;
  profilePhotoUrl?: string | null;
  token: string;
  hasProfile: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  completeProfile: (data: StoreFormData) => Promise<void>;
  updateUserProfile: (updates: Partial<Pick<User, 'storeName' | 'profilePhotoUrl'>>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('garuda_user');
    return stored ? JSON.parse(stored) : null;
  });

  const saveUser = (u: User) => {
    setUser(u);
    localStorage.setItem('garuda_user', JSON.stringify(u));
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const data = res.data.data;
    saveUser({
      email,
      storeId: data.storeId,
      storeName: data.storeName || email.split('@')[0],
      profilePhotoUrl: null,
      token: data.token || 'session-token',
      hasProfile: data.hasProfile ?? false,
    });
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/register', { email, password });
    const data = res.data.data;
    saveUser({
      email,
      storeId: data.storeId,
      storeName: data.storeName || email.split('@')[0],
      profilePhotoUrl: null,
      token: data.token || 'session-token',
      hasProfile: false,
    });
  }, []);

  const completeProfile = useCallback(async (formData: StoreFormData) => {
    if (!user) return;
    await api.put('/auth/profile', {
      storeId: user.storeId,
      name: formData.name,
      timezone: formData.timezone || 'Asia/Jakarta',
      phoneNumber: formData.phoneNumber || null,
    });
    saveUser({
      ...user,
      hasProfile: true,
      storeName: formData.name || user.storeName,
    });
  }, [user]);

  const updateUserProfile = useCallback((updates: Partial<Pick<User, 'storeName' | 'profilePhotoUrl'>>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem('garuda_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('garuda_user');
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, register, completeProfile, updateUserProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
