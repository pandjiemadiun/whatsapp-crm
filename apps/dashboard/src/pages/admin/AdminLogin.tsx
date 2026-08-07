import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, LogIn, Loader2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useAdminAuth } from '../../contexts/AdminAuthContext';

export default function AdminLogin() {
  const { login } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Force dark mode ON
  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/admin');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        setError('Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.');
      } else {
        setError(err?.response?.data?.error || err?.message || 'Login gagal');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-navy flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand mb-4">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-display font-semibold text-surface">MISSION CONTROL</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to access admin panel</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-dcard rounded-xl shadow-xl border border-dline p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg text-sm bg-red-500/10 text-red-400 border border-red-500/20 flex items-start gap-2">
              {error.includes('15 menit') && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="admin-email" className="text-sm font-medium text-slate-300">Email</label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              disabled={loading}
              className="w-full px-3 py-2 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-password" className="text-sm font-medium text-slate-300">Password</label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
                disabled={loading}
                className="w-full px-3 py-2 pr-9 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-surface"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full bg-brand text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-deep disabled:opacity-50 transition flex items-center justify-center gap-2 font-mono">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
