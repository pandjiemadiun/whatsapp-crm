import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Smartphone, QrCode, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Trash2 } from 'lucide-react';
import adminApi from '../../services/adminApi';

interface GOWAStatus {
  deviceId: string;
  status: string;
  qrcode: string | null;
  ownerJid: string | null;
}

interface StoreSelect {
  id: string;
  name: string;
  phoneNumber: string | null;
}

export default function AdminGOWA() {
  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreSelect[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [phoneInput, setPhoneInput] = useState('');
  const [status, setStatus] = useState<GOWAStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [resetting] = useState(false);
  const [, setShowResetConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  useEffect(() => {
    adminApi.get('/stores', { params: { page: 1, pageSize: 100 } })
      .then((res) => {
        const list = (res.data.data.stores || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          phoneNumber: s.phoneNumber,
        }));
        setStores(list);
      })
      .catch(() => showFeedback('error', 'Gagal memuat daftar toko'));
  }, []);

  const checkStatus = useCallback(async (storeId: string) => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await adminApi.get(`/stores/${storeId}/gowa-status`).catch(() => null);
      if (res?.data?.data) {
        setStatus(res.data.data);
      } else {
        setStatus({ deviceId: '', status: 'disconnected', qrcode: null, ownerJid: null });
      }
    } catch {
      setStatus({ deviceId: '', status: 'disconnected', qrcode: null, ownerJid: null });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStoreSelect = (storeId: string) => {
    setSelectedStore(storeId);
    const store = stores.find(s => s.id === storeId);
    setPhoneInput(store?.phoneNumber || '');
    setStatus(null);
    if (storeId) checkStatus(storeId);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setPhoneInput(raw);
  };

  const handleConnect = async () => {
    if (!selectedStore) return;
    setConnecting(true);
    try {
      const res = await adminApi.post(`/stores/${selectedStore}/gowa-connect`, {
        phoneNumber: phoneInput,
      });
      if (res.data.success) {
        if (res.data.data?.deviceId) setStatus(res.data.data);
        showFeedback('success', res.data.data?.message || 'QR generated. Scan to connect.');
      }
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal connect GOWA');
    } finally {
      setConnecting(false);
    }
  };

  const handleReset = () => {
    setShowResetConfirm(true);
  };

  return (
    <div className="p-6 text-surface">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-xl text-surface">GOWA WhatsApp Gateway</h1>
          <p className="text-sm text-slate-400">Manage GOWA self-hosted WhatsApp connections</p>
        </div>
      </div>

      {feedback && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-cyan/10 text-cyan border border-cyan/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
        </div>
      )}

      <div className="max-w-xl">
        {/* Store Select */}
        <div className="bg-dcard rounded-lg border border-dline p-6 mb-4">
          <label className="text-sm font-medium text-slate-300 mb-2 block">Select Store</label>
          <select
            value={selectedStore}
            onChange={(e) => handleStoreSelect(e.target.value)}
            className="w-full px-3 py-2 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
          >
            <option value="">-- Choose store --</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} {s.phoneNumber ? `(${s.phoneNumber})` : ''}</option>
            ))}
          </select>
        </div>

        {/* GOWA Management */}
        {selectedStore && (
          <div className="bg-dcard rounded-lg border border-dline p-6">
            {loading ? (
              <div className="space-y-3">
                <div className="h-4 w-36 rounded bg-dline animate-pulse" />
                <div className="h-48 rounded-lg bg-dline/50 animate-pulse" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Status badge */}
                <div className="flex items-center justify-between">
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                    status?.status === 'connected'
                      ? 'bg-cyan/10 text-cyan border border-cyan/20'
                      : status?.status === 'connecting'
                      ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                      : 'bg-dline/20 text-slate-400 border border-dline'
                  }`}>
                    {status?.status === 'connected' ? <CheckCircle2 className="w-4 h-4" /> :
                     status?.status === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     <XCircle className="w-4 h-4" />}
                    {status?.status === 'connected' ? 'Connected' :
                     status?.status === 'connecting' ? 'Connecting...' : 'Disconnected'}
                  </div>
                  <button
                    onClick={() => checkStatus(selectedStore)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-surface"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>

                {/* Owner JID / Nomor */}
                {status?.ownerJid && (
                  <div className="bg-dline/20 rounded-lg px-4 py-3">
                    <p className="text-xs text-slate-400 mb-1">WhatsApp Number (terhubung)</p>
                    <p className="text-sm font-mono text-surface">{status.ownerJid}</p>
                  </div>
                )}

                {/* Phone number input */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Nomor WhatsApp Bisnis</label>
                  <div className="relative">
                    <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={handlePhoneChange}
                      placeholder="082147128277"
                      className="w-full pl-10 pr-3 py-2 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
                    />
                  </div>
                  <p className="text-xs text-slate-400">
                    Masukkan nomor HP: <strong>0821xxx</strong>, <strong>62821xxx</strong>, atau <strong>+62821xxx</strong>. 
                    Akan otomatis dikonversi ke <strong>62821xxx</strong>.
                  </p>
                </div>

                {/* QR Code */}
                {status?.qrcode && (
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-cyan">
                      <QrCode className="w-4 h-4" />
                      Scan QR dengan WhatsApp
                    </div>
                    <img
                      src={`data:image/png;base64,${status.qrcode}`}
                      alt="QR Code"
                      className="mx-auto rounded-lg border border-dline"
                      style={{ width: 256, height: 256 }}
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  {status?.status !== 'connected' ? (
                    <button
                      onClick={handleConnect}
                      disabled={connecting}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-deep disabled:opacity-50 transition w-full sm:w-auto"
                    >
                      {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                      {connecting ? 'Connecting...' : 'Generate QR'}
                    </button>
                  ) : null}
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className={`${status?.status === 'connected' ? 'flex-1' : ''} flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-red-400 border border-red-500/20 hover:bg-red-500/10 disabled:opacity-50 transition w-full sm:w-auto`}
                  >
                    {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {resetting ? 'Resetting...' : 'Reset'}
                  </button>
                </div>
              </div>
            )}

            {/* No status — first load */}
            {!loading && !status && (
              <div className="text-center py-8">
                <AlertTriangle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Select store and click Refresh to check status</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
