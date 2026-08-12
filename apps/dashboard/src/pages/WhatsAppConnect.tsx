import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Eye, EyeOff, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Save, Trash2, Smartphone, RefreshCw, Copy, KeyRound,
  ExternalLink, Check,
} from 'lucide-react';
import useFonnteSettings, { formatTime } from '../components/FonnteSettings';

export default function WhatsAppConnect() {
  const navigate = useNavigate();
  const s = useFonnteSettings();

  const steps = [
    { num: 1, label: 'Ambil token dari Fonnte' },
    { num: 2, label: 'Tempel token' },
    { num: 3, label: 'Selesai' },
  ];

  const isDisconnected = s.viewState === 'disconnected' || s.viewState === 'error';
  const isConnected = s.viewState === 'connected';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-muted hover:text-ink transition shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-display font-bold text-navy dark:text-surface">WhatsApp Gateway</h1>
          <p className="text-sm text-muted">Hubungkan WhatsApp bisnis Anda melalui Fonnte</p>
        </div>
      </div>

      {/* ── Persistent status banner ── */}
      {s.viewState === 'loading' ? (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface dark:bg-dsurface border border-line dark:border-dline text-sm text-muted">
          <Loader2 className="w-4 h-4 animate-spin text-brand" />
          <span>Memeriksa status koneksi…</span>
        </div>
      ) : isConnected ? (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
          <span>
            Terhubung • {s.connectedNumber || '—'}
            {s.lastChecked && <span className="ml-2 opacity-70">· Dicek {formatTime(s.lastChecked)}</span>}
          </span>
        </div>
      ) : s.viewState === 'error' ? (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Status tidak dapat dimuat — cek koneksi dan coba refresh.</span>
          <button
            onClick={s.fetchStatus}
            className="ml-auto text-xs font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
          <XCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>WhatsApp belum terhubung. Ikuti 3 langkah di bawah untuk mengaktifkan bot.</span>
        </div>
      )}

      {/* ── Step progress ── */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((st) => {
          const isActive = s.step === st.num;
          const isComplete = s.step > st.num;
          const isAvailable = s.step >= st.num;
          return st.num === 2 && isDisconnected ? (
            <div key={st.num} className="flex items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  isComplete
                    ? 'bg-green-500 text-white'
                    : 'bg-line dark:bg-dline text-gray-500'
                }`}
              >
                {isComplete ? <Check className="w-4 h-4" /> : st.num}
              </div>
              <span className="ml-2 text-xs font-medium text-muted">
                {st.label}
              </span>
            </div>
          ) : (
            <div key={st.num} className="flex items-center">
              <button
                onClick={() => isAvailable && s.setStep(st.num)}
                disabled={!isAvailable || st.num === 3}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors disabled:opacity-50 ${
                  isActive
                    ? 'bg-brand text-white'
                    : isComplete
                      ? 'bg-green-500 text-white'
                      : 'bg-line dark:bg-dline text-muted hover:bg-line dark:hover:bg-dline'
                }`}
              >
                {isComplete ? <Check className="w-4 h-4" /> : st.num}
              </button>
              <span className="ml-2 text-xs font-medium text-muted">
                {st.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Feedback ── */}
      {s.feedback && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
          s.feedback.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:border-green-800'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:border-red-800'
        }`}>
          {s.feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {s.feedback.msg}
        </div>
      )}

      {/* ── Steps ── */}
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-6">
          {s.viewState === 'error' ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-4 h-4" />
                Status tidak dapat dimuat
              </div>
              <div className="px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
                Gagal memeriksa status koneksi Fonnte. Ini bukan berarti WhatsApp Anda terputus —
                kami hanya belum bisa memastikan statusnya saat ini.
              </div>
              <button
                onClick={s.fetchStatus}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium text-ink border border-line hover:bg-surface dark:hover:bg-dline dark:text-surface transition"
              >
                <RefreshCw className="w-4 h-4" />
                Coba periksa lagi
              </button>
            </div>
          ) : s.step === 1 ? (
            /* ── STEP 1: Ambil token ── */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-soft dark:bg-brand/15 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-navy dark:text-surface">Langkah 1: Dapatkan token Fonnte</h2>
                  <p className="text-sm text-muted">Token adalah kunci rahasia yang menghubungkan bot ke akun WhatsApp Anda.</p>
                </div>
              </div>

              <div className="bg-surface dark:bg-dsurface rounded-lg border border-line dark:border-dline p-4 space-y-3">
                <p className="text-sm text-ink dark:text-surface">
                  Fonnte adalah penyedia jembatan (gateway) WhatsApp yang kami pakai untuk membaca pesan masuk
                  dan mengirim balasan atas nama toko Anda. Agar bot bisa bekerja, kami butuh <strong className="font-semibold">API token</strong>{' '}
                  yang Anda dapatkan dari akun Fonnte Anda.
                </p>
                <p className="text-sm text-ink dark:text-surface">
                  Token ini <strong className="font-semibold">unik per akun Fonnte</strong> dan <strong className="font-semibold">tersimpan aman</strong>{' '}
                  (kami enkripsi sebelum menyimpan). Anda bisa merevokannya kapan saja dari dashboard Fonnte.
                </p>
              </div>

              <button
                onClick={() => window.open('https://fonnte.com', '_blank', 'noopener,noreferrer')}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold bg-brand text-white hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition"
              >
                <ExternalLink className="w-4 h-4" />
                Buka dashboard Fonnte
              </button>

              <button
                onClick={() => s.setStep(2)}
                className="w-full py-2 rounded-lg text-sm font-medium text-brand hover:bg-brand-soft dark:hover:bg-brand/15 transition"
              >
                Saya sudah punya token → Lanjutkan
              </button>
            </div>
          ) : s.step === 2 ? (
            /* ── STEP 2: Tempel token ── */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-soft dark:bg-brand/15 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-navy dark:text-surface">Langkah 2: Tempel token & nomor</h2>
                  <p className="text-sm text-muted">Masukkan API token dan nomor WhatsApp gateway Anda.</p>
                </div>
              </div>

              {/* WhatsApp Number */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-ink dark:text-surface">
                  Nomor WhatsApp Gateway
                </label>
                <div className="relative">
                  <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                  <input
                    type="tel"
                    value={s.fonnteNumber}
                    onChange={(e) => s.setFonnteNumber(e.target.value)}
                    placeholder="628123456789"
                    disabled={s.saving}
                    className="w-full pl-10 pr-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                  />
                </div>
                <p className="text-xs text-muted">
                  Format: 62812xxx (wajib diisi agar bot mengenali nomor toko Anda).
                </p>
              </div>

              {/* API Token */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-ink dark:text-surface">
                  Fonnte API Token
                </label>
                <div className="relative">
                  <input
                    type={s.showToken ? 'text' : 'password'}
                    value={s.token}
                    onChange={(e) => s.setToken(e.target.value)}
                    placeholder="Enter your Fonnte API token"
                    disabled={s.saving}
                    className="w-full pl-3 pr-10 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => s.setShowToken(!s.showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink dark:hover:text-surface"
                  >
                    {s.showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Webhook URL preview (during setup) */}
              {s.webhookUrl && (
                <div className="bg-brand-soft dark:bg-brand/15 rounded-lg border border-line dark:border-dline p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-brand dark:text-brand/80 flex items-center gap-1.5">
                      <KeyRound className="w-3 h-3" />
                      Webhook URL (tempel di dashboard Fonnte)
                    </span>
                    <button
                      onClick={s.handleRotateWebhook}
                      disabled={s.webhookLoading}
                      className="text-xs text-brand dark:text-brand/80 hover:text-brand-deep disabled:opacity-50"
                    >
                      {s.webhookLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Rotate
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs break-all bg-surface dark:bg-dsurface border border-line dark:border-dline px-2 py-1.5 rounded text-navy dark:text-surface">
                      {s.webhookUrl}
                    </code>
                    <button
                      onClick={s.handleCopyWebhook}
                      className="text-brand dark:text-brand/80 hover:text-brand-deep shrink-0"
                      title="Copy URL"
                    >
                      {s.webhookCopied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted">
                    Tempel URL ini di pengaturan webhook dashboard Fonnte Anda.
                  </p>
                </div>
              )}

              <button
                onClick={() => s.setStep(1)}
                className="w-full py-2 rounded-lg text-sm font-medium text-muted dark:text-gray-500 hover:bg-surface dark:hover:bg-dline transition"
              >
                ← Kembali
              </button>

              <button
                onClick={s.handleSave}
                disabled={!s.token.trim() || !s.fonnteNumber.trim() || s.saving}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-brand text-white hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition"
              >
                {s.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {s.saving ? 'Menyambungkan…' : 'Simpan & Hubungkan'}
              </button>
            </div>
          ) : (
            /* ── STEP 3: Selesai (Connected) ── */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-navy dark:text-surface">Selesai! Bot siap menjawab.</h2>
                  <p className="text-sm text-muted">WhatsApp gateway terhubung dan aktif.</p>
                </div>
              </div>

              <div className="bg-surface dark:bg-dsurface rounded-lg border border-line dark:border-dline divide-y divide-line dark:divide-dline">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted">API Token</span>
                  <span className="text-sm font-mono text-ink dark:text-surface">{s.maskedToken}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted">Gateway Number</span>
                  <span className="text-sm font-medium text-ink dark:text-surface">{s.connectedNumber || '—'}</span>
                </div>
                {s.lastChecked && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-muted">Terakhir dicek</span>
                    <span className="text-xs text-muted dark:text-gray-500">{formatTime(s.lastChecked)}</span>
                  </div>
                )}
              </div>

              {/* Webhook URL */}
              {s.webhookUrl ? (
                <div className="bg-brand-soft dark:bg-brand/10 rounded-lg border border-brand/30 dark:border-brand/20 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-brand flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4" />
                      Webhook URL
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={s.handleRotateWebhook}
                        disabled={s.webhookLoading}
                        className="text-xs text-brand hover:text-brand-deep disabled:opacity-50"
                      >
                        {s.webhookLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Rotate
                      </button>
                      <button
                        onClick={s.handleCopyWebhook}
                        className="text-xs text-brand hover:text-brand-deep"
                        title="Copy URL"
                      >
                        {s.webhookCopied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <code className="block text-xs break-all bg-surface dark:bg-dcard border border-brand/20 dark:border-dline px-3 py-2 rounded text-brand">
                    {s.webhookUrl}
                  </code>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-surface dark:bg-dsurface border border-line dark:border-dline">
                  <p className="text-xs text-muted">
                    Belum ada webhook URL. Klik <span className="font-medium text-brand">Rotate</span> untuk membuatkan.
                  </p>
                </div>
              )}

              <button
                onClick={() => s.setStep(1)}
                className="w-full py-2 rounded-lg text-sm font-medium text-muted dark:text-gray-500 hover:bg-surface dark:hover:bg-dline transition"
              >
                ← Kembali ke pengaturan
              </button>

              <button
                onClick={s.handleDisconnect}
                disabled={s.disconnecting}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition"
              >
                {s.disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {s.disconnecting ? 'Menghapus…' : 'Disconnect / Remove'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
