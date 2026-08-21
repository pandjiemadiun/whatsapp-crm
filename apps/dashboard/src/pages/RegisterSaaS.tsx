import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import EntryLayout from '../components/EntryLayout';

interface OriginState {
  provinceId: string;
  provinceName: string;
  cityId: string;
  cityName: string;
  subdistrictId: string;
  subdistrictName: string;
}

const EMPTY_ORIGIN: OriginState = {
  provinceId: '',
  provinceName: '',
  cityId: '',
  cityName: '',
  subdistrictId: '',
  subdistrictName: '',
};

export default function RegisterSaaS() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Wajib diisi saat daftar toko
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [origin, setOrigin] = useState<OriginState>(EMPTY_ORIGIN);

  const [provinces, setProvinces] = useState<{ id: string; name: string }[]>([]);
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);
  const [subdistricts, setSubdistricts] = useState<{ id: string; name: string }[]>([]);

  const loadProvinces = useCallback(async () => {
    try {
      const res = await api.get('/pwa-locations/provinces');
      setProvinces(res.data.data || []);
    } catch {
      /* reference data optional — ignore on failure */
    }
  }, []);

  const loadCities = useCallback(async (provinceId: string) => {
    if (!provinceId) {
      setCities([]);
      setSubdistricts([]);
      return;
    }
    try {
      const res = await api.get(`/pwa-locations/cities?provinceId=${encodeURIComponent(provinceId)}`);
      setCities(res.data.data || []);
    } catch {
      setCities([]);
    }
  }, []);

  const loadSubdistricts = useCallback(async (cityId: string) => {
    if (!cityId) {
      setSubdistricts([]);
      return;
    }
    try {
      const res = await api.get(`/pwa-locations/subdistricts?cityId=${encodeURIComponent(cityId)}`);
      setSubdistricts(res.data.data || []);
    } catch {
      setSubdistricts([]);
    }
  }, []);

  useEffect(() => {
    loadProvinces();
  }, [loadProvinces]);

  const onProvinceChange = (id: string) => {
    const opt = provinces.find((p) => p.id === id);
    setOrigin({ provinceId: id, provinceName: opt?.name || '', cityId: '', cityName: '', subdistrictId: '', subdistrictName: '' });
    setCities([]);
    setSubdistricts([]);
    loadCities(id);
  };

  const onCityChange = (id: string) => {
    const opt = cities.find((c) => c.id === id);
    setOrigin((o) => ({ ...o, cityId: id, cityName: opt?.name || '', subdistrictId: '', subdistrictName: '' }));
    setSubdistricts([]);
    loadSubdistricts(id);
  };

  const onSubdistrictChange = (id: string) => {
    const opt = subdistricts.find((s) => s.id === id);
    setOrigin((o) => ({ ...o, subdistrictId: id, subdistrictName: opt?.name || '' }));
  };

  const validPhone = /^[+\d][\d\s-]{6,19}$/.test(phoneNumber.trim());
  const validAddress = address.trim().length > 0;
  const validLocation =
    origin.provinceId && origin.cityId && origin.subdistrictId && origin.provinceName && origin.cityName && origin.subdistrictName;
  const validForm =
    password === confirm &&
    password.length >= 6 &&
    validPhone &&
    validAddress &&
    !!validLocation;

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
    if (!validPhone) {
      setError('Nomor HP tidak valid');
      return;
    }
    if (!validAddress) {
      setError('Alamat wajib diisi');
      return;
    }
    if (!validLocation) {
      setError('Lengkapi provinsi, kota, dan kecamatan');
      return;
    }

    setLoading(true);
    try {
      await register(email, password, {
        phoneNumber: phoneNumber.trim(),
        address: address.trim(),
        originProvinceId: origin.provinceId,
        originProvinceName: origin.provinceName,
        originCityId: origin.cityId,
        originCityName: origin.cityName,
        originSubdistrictId: origin.subdistrictId,
        originSubdistrictName: origin.subdistrictName,
      });
      navigate('/onboarding');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Pendaftaran gagal');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink dark:text-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50';
  const labelClass = 'text-sm font-medium text-ink dark:text-surface';

  return (
    <EntryLayout title="Daftar" subtitle="Buat akun tokomu">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@toko.com"
            required
            disabled={loading}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Kata sandi</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 karakter"
              required
              disabled={loading}
              className={inputClass + ' pr-9'}
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Konfirmasi Kata Sandi</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Ulangi kata sandi"
            required
            disabled={loading}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>No. HP</label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="0812xxxxxxx"
            required
            disabled={loading}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Alamat Lengkap</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Nama jalan, nomor rumah, patokan"
            rows={3}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Provinsi</label>
          <select
            value={origin.provinceId}
            onChange={(e) => onProvinceChange(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          >
            <option value="">Pilih provinsi</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Kota / Kabupaten</label>
          <select
            value={origin.cityId}
            onChange={(e) => onCityChange(e.target.value)}
            required
            disabled={loading || !origin.provinceId}
            className={inputClass}
          >
            <option value="">Pilih kota</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className={labelClass}>Kecamatan</label>
          <select
            value={origin.subdistrictId}
            onChange={(e) => onSubdistrictChange(e.target.value)}
            required
            disabled={loading || !origin.cityId}
            className={inputClass}
          >
            <option value="">Pilih kecamatan</option>
            {subdistricts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={loading || !validForm}
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
