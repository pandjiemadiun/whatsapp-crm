import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Loader2 } from 'lucide-react';
import { useAuth, type StoreFormData } from '../contexts/AuthContext';
import { TIMEZONES } from '../lib/timezones';
import EntryLayout from '../components/EntryLayout';

export default function OnboardingProfile() {
  const { isAuthenticated, completeProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<StoreFormData>({
    name: '',
    timezone: 'Asia/Jakarta',
    phoneNumber: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Nama toko wajib diisi');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await completeProfile(form);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Gagal menyimpan profil');
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntryLayout title="Lengkapi profil tokomu" subtitle="Isi profil toko agar QloBot bisa mulai bekerja">
      {error && (
        <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink dark:text-surface">
            Nama Toko <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Toko Sejahtera"
            required
            disabled={saving}
            className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink dark:text-surface">Zona waktu</label>
          <select
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            disabled={saving}
            className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink dark:text-surface">Nomor WhatsApp</label>
          <input
            type="tel"
            value={form.phoneNumber}
            onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
            placeholder="e.g. 628123456789"
            disabled={saving}
            className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-brand text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Menyimpan...' : 'Simpan & mulai'}
        </button>
      </form>
    </EntryLayout>
  );
}
