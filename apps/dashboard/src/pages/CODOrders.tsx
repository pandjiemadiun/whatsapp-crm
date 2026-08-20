import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, X, AlertCircle, CheckCircle2, Banknote,
} from 'lucide-react';
import api from '../services/api';

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
  unpaid: 'Belum Lunas',
  pending_verification: 'Menunggu Verifikasi',
  paid: 'Lunas',
  rejected: 'Ditolak',
};

interface CodOrder {
  id: string;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string | null;
  totalPrice: number | null;
  currency: string;
  customerId: string;
  customerPhone?: string | null;
  paymentVerifiedAt?: string | null;
  verifiedByAdminId?: string | null;
  createdAt: string;
}

type CodTab = 'unpaid' | 'paid';

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
  if (p === 'unpaid') return 'red';
  if (p === 'paid') return 'green';
  if (p === 'pending_verification') return 'amber';
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

export default function CODOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<CodOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<CodTab>('unpaid');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4500);
  };

  const [settleOrder, setSettleOrder] = useState<CodOrder | null>(null);
  const [settleLoading, setSettleLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Ambil semua order COD milik store (tenant-scoped lewat backend),
      // lalu bagi jadi tab Belum Lunas / Sudah Lunas di client.
      const res = await api.get('/orders?paymentMethod=cod');
      const list: CodOrder[] = res.data.data || [];
      const enriched = await Promise.all(
        list.map(async (o) => {
          try {
            const d = await api.get(`/orders/${o.id}`);
            return { ...o, customerPhone: d.data.data?.customerPhone ?? null } as CodOrder;
          } catch {
            return o;
          }
        }),
      );
      setOrders(enriched);
    } catch {
      setError('Gagal memuat daftar pesanan COD');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const openSettle = (order: CodOrder) => {
    setSettleOrder(order);
  };

  const closeSettle = () => {
    if (settleLoading) return;
    setSettleOrder(null);
  };

  const confirmSettle = async () => {
    if (!settleOrder) return;
    setSettleLoading(true);
    try {
      const res = await api.post(`/orders/${settleOrder.id}/cod-settle`, {});
      if (res.data.success) {
        setOrders((prev) => prev.filter((o) => o.id !== settleOrder.id));
        showFeedback('success', 'Pesanan COD ditandai LUNAS');
        setSettleOrder(null);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Gagal menandai COD lunas';
      showFeedback('error', msg);
      setSettleOrder(null);
    } finally {
      setSettleLoading(false);
    }
  };

  const unpaidCount = orders.filter((o) => o.paymentStatus === 'unpaid').length;
  const paidCount = orders.filter((o) => o.paymentStatus === 'paid').length;
  const visible = orders.filter((o) => o.paymentStatus === tab);

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
            <Banknote className="w-5 h-5 text-brand" />
            Pesanan COD
          </h1>
          <p className="text-sm text-muted">Bayar di tempat — tandai lunas setelah diterima kurir</p>
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

      {/* Tabs: Belum Lunas vs Sudah Lunas */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('unpaid')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
            tab === 'unpaid'
              ? 'bg-red-600 text-white'
              : 'bg-surface dark:bg-dcard text-muted border border-line dark:border-dline hover:text-ink'
          }`}
        >
          Belum Lunas {unpaidCount > 0 && <span className="ml-1 opacity-80">({unpaidCount})</span>}
        </button>
        <button
          onClick={() => setTab('paid')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
            tab === 'paid'
              ? 'bg-green-600 text-white'
              : 'bg-surface dark:bg-dcard text-muted border border-line dark:border-dline hover:text-ink'
          }`}
        >
          Sudah Lunas {paidCount > 0 && <span className="ml-1 opacity-80">({paidCount})</span>}
        </button>
      </div>

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
      ) : visible.length === 0 ? (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-12 sm:p-16 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-muted dark:text-gray-500 text-sm font-medium">
            {tab === 'unpaid' ? 'Tidak ada pesanan COD yang belum lunas 🎉' : 'Belum ada pesanan COD yang lunas'}
          </p>
          <p className="text-muted dark:text-gray-500 text-xs mt-1">Pesanan COD dengan status ini akan muncul di sini.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {visible.map((order) => (
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
                <p><span className="font-medium">Metode:</span> COD (Bayar di Tempat)</p>
                <p><span className="font-medium">Dibuat:</span> {formatDate(order.createdAt)}</p>
                {order.paymentStatus === 'paid' && (
                  <p><span className="font-medium">Lunas:</span> {formatDate(order.paymentVerifiedAt ?? null)}</p>
                )}
              </div>

              {/* Actions */}
              {order.paymentStatus === 'unpaid' ? (
                <div className="grid grid-cols-1 gap-2 mt-auto">
                  <button
                    onClick={() => openSettle(order)}
                    className="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 focus-visible:ring-2 focus:ring-green-500 transition flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Tandai Lunas
                  </button>
                </div>
              ) : (
                <div className="mt-auto text-xs text-green-700 dark:text-green-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Sudah ditandai lunas
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Settle confirm dialog */}
      {settleOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={!settleLoading ? closeSettle : undefined}>
          <div className="bg-surface dark:bg-dcard rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-base font-semibold text-ink dark:text-surface flex items-center gap-2">
                <Banknote className="w-5 h-5 text-green-600" />
                Tandai COD Lunas
              </h2>
              <button onClick={closeSettle} disabled={settleLoading} className="p-1.5 text-muted hover:text-ink rounded-lg transition disabled:opacity-50">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-muted mb-2 break-words">
              Tandai pesanan COD{' '}
              <span className="font-mono text-xs">{settleOrder.id.slice(0, 8)}…</span> sebagai <span className="font-semibold text-ink dark:text-surface">LUNAS</span>?
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 italic">
              Hanya menandai pembayaran lunas. Status pesanan (orderStatus) tidak diubah — lanjutkan secara terpisah lewat halaman Orders kalau perlu.
            </p>

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={closeSettle}
                disabled={settleLoading}
                className="px-4 py-2 bg-gray-100 dark:bg-dline text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={confirmSettle}
                disabled={settleLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {settleLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Tandai Lunas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
