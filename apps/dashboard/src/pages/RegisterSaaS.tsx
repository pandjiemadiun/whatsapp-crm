import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import EntryLayout from '../components/EntryLayout';

export default function RegisterSaaS() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Kata sandi tidak sama');
      return;
    }
    if (password.length < 6) {
      setError('Kata sandi minimal 6 karakter');
      return;
    }

    setLoading(true);
    try {
      await register(email, password);
      navigate('/onboarding');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Pendaftaran gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <EntryLayout title="Daftar" subtitle="Buat akun tokomu">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
            {error}
          </div>
        )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink dark:text-surface">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nama@toko.com"
          required
          disabled={loading}
          className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink dark:text-surface">Kata sandi</label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 6 karakter"
            required
            disabled={loading}
            className="w-full px-3 py-2 pr-9 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          />
          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink dark:text-surface">Konfirmasi Kata Sandi</label>
        <input
          type={showPw ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Ulangi kata sandi"
          required
          disabled={loading}
          className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
        />
      </div>

      <button type="submit" disabled={loading}
        className="w-full bg-brand text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        {loading ? 'Mendaftar...' : 'Daftar'}
      </button>

      <p className="text-center text-sm text-muted">
        Sudah punya akun?{' '}
        <Link to="/" className="text-brand hover:text-brand-deep font-medium">Masuk</Link>
      </p>
      </form>
    </EntryLayout>
  );
}
