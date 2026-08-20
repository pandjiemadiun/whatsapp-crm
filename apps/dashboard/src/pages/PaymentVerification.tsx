import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, X, AlertCircle, CheckCircle2, Ban,
  CircleDollarSign, ExternalLink, ImageOff,
} from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Local UI-only label maps (backend is the authority for transitions) ──
const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Baru Dipilih',
  pending: 'Menunggu Konfirmasi',
  waiting_address: 'Tunggu Alamat',
  waiting_payment: 'Tunggu Bayar',
  paid: 'Dibayar',
  packing: 'Dikemas',
  shipped: 'Dikirim',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
  refunded: 'Refund',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Belum Bayar',
  pending_verification: 'Menunggu Verifikasi',
  paid: 'Lunas',
  rejected: 'Ditolak',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  transfer: 'Transfer Bank',
  qris: 'QRIS',
  cod: 'COD',
  unpaid: 'Belum dipilih',
};

interface PaymentOrder {
  id: string;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentProofUrl: string | null;
  paymentReportedAt: string | null;
  totalPrice: number | null;
  currency: string;
  customerId: string;
  customerPhone?: string | null;
}

function statusBadge(label: string, tone: 'brand' | 'amber' | 'green' | 'red' | 'blue' | 'muted') {
  const tones: Record<string, string> = {
    brand: 'bg-brand-soft text-brand-deep border-brand/30 dark:bg-brand/10 dark:text-brand',
    amber: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400',
    green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400',
    red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400',
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400',
    muted: 'bg-surface text-muted border-line dark:bg-dsurface dark:text-gray-500',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${tones[tone]}`}>
      {label}
    </span>
  );
}

function paymentTone(p: string): 'amber' | 'green' | 'red' | 'muted' {
  if (p === 'pending_verification') return 'amber';
  if (p === 'paid') return 'green';
  if (p === 'rejected') return 'red';
  return 'muted';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatRupiah(v: number | null | undefined): string {
  if (v == null) return '—';
  return `Rp ${Number(v).toLocaleString('id-ID')}`;
}

function isImageUrl(url: string | null): boolean {
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|avif|bmp)(\?.*)?$/i.test(url) || /cloudinary\.com|r2\.cloudflarestorage\.com/i.test(url);
}

export default function PaymentVerification() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4500);
  };

  // Approve modal state
  const [approveOrder, setApproveOrder] = useState<PaymentOrder | null>(null);
  const [nextStates, setNextStates] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError] = useState('');

  // Reject confirm state
  const [rejectOrder, setRejectOrder] = useState<PaymentOrder | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/orders?paymentStatus=pending_verification');
      const list: PaymentOrder[] = res.data.data || [];
      // Enrich with customerPhone via detail endpoint (tenant-scoped).
      const enriched = await Promise.all(
        list.map(async (o) => {
          try {
            const d = await api.get(`/orders/${o.id}`);
            return { ...o, customerPhone: d.data.data?.customerPhone ?? null } as PaymentOrder;
          } catch {
            return o;
          }
        }),
      );
      setOrders(enriched);
    } catch {
      setError('Gagal memuat daftar verifikasi pembayaran');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const openApprove = async (order: PaymentOrder) => {
    setApproveOrder(order);
    setApproveError('');
    setSelectedTarget('');
    setApproveLoading(true);
    try {
      const res = await api.get(`/orders/${order.id}/valid-next-states`);
      const states: string[] = res.data.data || [];
      setNextStates(states);
    } catch {
      setNextStates([]);
      setApproveError('Gagal memuat pilihan status tujuan');
    } finally {
      setApproveLoading(false);
    }
  };

  const closeApprove = () => {
    setApproveOrder(null);
    setNextStates([]);
    setSelectedTarget('');
    setApproveError('');
  };

  const confirmApprove = async () => {
    if (!approveOrder) return;
    if (!selectedTarget) {
      setApproveError('Pilih status tujuan pesanan setelah pembayaran dikonfirmasi');
      return;
    }
    setApproveLoading(true);
    setApproveError('');
    try {
      const res = await api.post(`/orders/${approveOrder.id}/payment-verify`, {
        decision: 'approve',
        targetOrderStatus: selectedTarget,
      });
      if (res.data.success) {
        setOrders((prev) => prev.filter((o) => o.id !== approveOrder.id));
        showFeedback('success', `Pembayaran dikonfirmasi — pesanan → ${ORDER_STATUS_LABELS[selectedTarget] || selectedTarget}`);
        closeApprove();
      }
    } catch (err: any) {
      // Tampilkan pesan jelas dari backend. JANGAN auto-retry / tebak ulang.
      const msg = err?.response?.data?.error || 'Gagal mengonfirmasi pembayaran';
      setApproveError(msg);
    } finally {
      setApproveLoading(false);
    }
  };

  const confirmReject = async () => {
    if (!rejectOrder) return;
    setRejectLoading(true);
    try {
      const res = await api.post(`/orders/${rejectOrder.id}/payment-verify`, { decision: 'reject' });
      if (res.data.success) {
        setOrders((prev) => prev.filter((o) => o.id !== rejectOrder.id));
        showFeedback('success', 'Pembayaran ditolak');
        setRejectOrder(null);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Gagal menolak pembayaran';
      showFeedback('error', msg);
      setRejectOrder(null);
    } finally {
      setRejectLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/dashboard/orders')}
          className="text-muted hover:text-ink transition shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-display font-bold text-navy dark:text-surface flex items-center gap-2">
            <CircleDollarSign className="w-5 h-5 text-brand" />
            Verifikasi Pembayaran
          </h1>
          <p className="text-sm text-muted">Konfirmasi bukti transfer / QRIS pelanggan</p>
        </div>
      </div>

      {feedback && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:border-green-800'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:border-red-800'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.msg}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:border-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          <button onClick={loadOrders} className="ml-3 text-xs font-semibold text-red-700 underline hover:text-red-800">
            Coba lagi
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline overflow-hidden">
          <div className="divide-y divide-line dark:divide-dline">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4">
                <div className="h-4 w-1/4 rounded bg-line animate-pulse mb-2" />
                <div className="h-3 w-1/2 rounded bg-line animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-12 sm:p-16 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-muted dark:text-gray-500 text-sm font-medium">Tidak ada pembayaran yang perlu diverifikasi 🎉</p>
          <p className="text-muted dark:text-gray-500 text-xs mt-1">Bukti transfer / QRIS yang menunggu akan muncul di sini.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-muted truncate">{order.id}</p>
                  <p className="text-sm font-medium text-ink dark:text-surface truncate">
                    {order.customerPhone || order.customerId}
                  </p>
                </div>
                {statusBadge(PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus, paymentTone(order.paymentStatus))}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink dark:text-surface">{formatRupiah(order.totalPrice)}</p>
                {statusBadge(ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus, 'muted')}
              </div>

              <div className="text-xs text-muted space-y-1">
                <p><span className="font-medium">Metode:</span> {PAYMENT_METHOD_LABELS[order.paymentMethod || 'unpaid'] || order.paymentMethod || '—'}</p>
                <p><span className="font-medium">Dilaporkan:</span> {formatDate(order.paymentReportedAt)}</p>
              </div>

              {/* Bukti transfer */}
              <div>
                <p className="text-xs font-medium text-muted mb-1">Bukti Pembayaran</p>
                {order.paymentProofUrl ? (
                  <div className="rounded-lg border border-line dark:border-dline overflow-hidden bg-surface dark:bg-dsurface">
                    {isImageUrl(order.paymentProofUrl) ? (
                      <img
                        src={order.paymentProofUrl}
                        alt="Bukti pembayaran"
                        className="w-full h-40 object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : null}
                    <a
                      href={order.paymentProofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 text-xs text-brand hover:text-brand-deep font-medium"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Buka bukti transfer
                    </a>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <ImageOff className="w-3.5 h-3.5" />
                    Tidak ada bukti
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 mt-auto">
                <button
                  onClick={() => openApprove(order)}
                  className="px-3 py-2 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Setujui
                </button>
                <button
                  onClick={() => setRejectOrder(order)}
                  className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center justify-center gap-1"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Tolak
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve modal */}
      {approveOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={!approveLoading ? closeApprove : undefined}>
          <div className="bg-surface dark:bg-dcard rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-semibold text-ink dark:text-surface flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-brand" />
                Konfirmasi Pembayaran
              </h2>
              <button onClick={closeApprove} disabled={approveLoading} className="p-1.5 text-muted hover:text-ink rounded-lg transition disabled:opacity-50">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-muted mb-4 space-y-1">
              <p className="font-mono text-xs truncate">{approveOrder.id}</p>
              <p>Status saat ini: <span className="font-medium text-ink dark:text-surface">{ORDER_STATUS_LABELS[approveOrder.orderStatus] || approveOrder.orderStatus}</span></p>
              <p>Metode: <span className="font-medium text-ink dark:text-surface">{PAYMENT_METHOD_LABELS[approveOrder.paymentMethod || 'unpaid'] || approveOrder.paymentMethod}</span></p>
            </div>

            <label className="block text-xs font-medium text-muted mb-1.5">
              Setelah dibayar, pindahkan pesanan ke status:
            </label>
            {approveLoading && nextStates.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Memuat pilihan status…
              </div>
            ) : (
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
                disabled={approveLoading}
                className="w-full border border-line dark:border-dline rounded-lg px-3 py-2 text-sm text-ink dark:text-surface bg-surface dark:bg-dsurface focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              >
                <option value="">Pilih status tujuan…</option>
                {nextStates.map((s) => (
                  <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
                ))}
              </select>
            )}

            {approveError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {approveError}
              </p>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={closeApprove}
                disabled={approveLoading}
                className="px-4 py-2 bg-gray-100 dark:bg-dline text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={confirmApprove}
                disabled={approveLoading || !selectedTarget}
                className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-deep transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {approveLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Konfirmasi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject confirm */}
      {rejectOrder && (
        <ConfirmDialog
          title="Tolak Pembayaran"
          message={`Tolak bukti pembayaran untuk pesanan ${rejectOrder.id.slice(0, 8)}…?`}
          consequence="Pesanan akan ditandai dibayar = DITOLAK. Keputusan ini final melalui sistem."
          confirmLabel="Tolak Pembayaran"
          cancelLabel="Batal"
          confirmClass="bg-red-600 hover:bg-red-700"
          onConfirm={confirmReject}
          onCancel={() => !rejectLoading && setRejectOrder(null)}
        />
      )}
    </div>
  );
}
