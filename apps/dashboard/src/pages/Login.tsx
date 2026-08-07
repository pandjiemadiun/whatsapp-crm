import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Store, Loader2 } from 'lucide-react';
import api from '../services/api';

export default function Login() {
  const [storeId, setStoreId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // If user typed a storeId, try to login with it (auto-creates if new)
      const payload = storeId.trim()
        ? { storeId: storeId.trim() }
        : { storeName: `Toko ${Date.now()}` };

      const res = await api.post('/auth/login', payload);
      const storeIdFromServer = res.data.data.storeId;

      localStorage.setItem('garuda_store_id', storeIdFromServer);
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal login';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <Store className="w-8 h-8 text-indigo-600" />
          <h1 className="text-2xl font-bold text-gray-800">Garuda Dashboard</h1>
        </div>
        <p className="text-gray-500 mb-6">AI WhatsApp Commerce Engine</p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium bg-red-100 text-red-800 border border-red-200">
            ✕ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Store ID</label>
            <input
              type="text"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              placeholder="Kosongkan untuk buka toko baru"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-gray-100"
              disabled={loading}
            />
            <p className="text-xs text-gray-400 mt-1">Biarkan kosong untuk membuat toko baru secara otomatis</p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-400 transition flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loading ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
