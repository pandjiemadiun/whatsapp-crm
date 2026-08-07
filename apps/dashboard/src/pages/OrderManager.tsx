import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, Loader2, X, AlertCircle, CheckCircle2, Clock,
  Send, Ban, Bot, User,
} from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface OrderItem {
  product: string;
  price?: number;
  qty?: number;
  quantity?: number;
  unit?: string;
}

interface Order {
  id: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  conversationId?: string;
  items: OrderItem[];
  totalPrice: number | null;
  currency: string;
  orderStatus: string;
  shippingAddress: string | null;
  createdAt: string;
}

type FilterTab = 'needs_action' | 'processing' | 'done' | 'cancelled' | 'all';

interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  source?: string;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  history: ConversationMessage[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:              { label: 'Baru Dipilih',     color: 'bg-surface text-muted border-line dark:bg-dsurface dark:text-gray-500', icon: Clock },
  pending:            { label: 'Menunggu Konfirmasi', color: 'bg-surface text-muted border-line dark:bg-dsurface dark:border-dline dark:text-muted', icon: Clock },
  waiting_address:    { label: 'Tunggu Alamat',   color: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400', icon: AlertCircle },
  waiting_payment:    { label: 'Tunggu Bayar',    color: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400', icon: AlertCircle },
  paid:               { label: 'Dibayar',          color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400', icon: CheckCircle2 },
  packing:            { label: 'Dikemas',         color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400', icon: Package },
  shipped:            { label: 'Dikirim',          color: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-400', icon: Package },
  completed:          { label: 'Selesai',          color: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400', icon: CheckCircle2 },
  cancelled:          { label: 'Dibatalkan',       color: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400', icon: X },
  refunded:           { label: 'Refund',           color: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400', icon: X },
};

// One-tap primary action per status
const ACTION_MAP: Record<string, { label: string; nextStatus: string; icon: React.ElementType }> = {
  pending:           { label: 'Konfirmasi',          nextStatus: 'paid',          icon: CheckCircle2 },
  draft:             { label: 'Konfirmasi',          nextStatus: 'paid',          icon: CheckCircle2 },
  waiting_payment:   { label: 'Konfirmasi Bayar',    nextStatus: 'paid',          icon: CheckCircle2 },
  waiting_address:   { label: 'Isi Alamat',          nextStatus: '',              icon: AlertCircle },
  paid:              { label: 'Mulai Packing',       nextStatus: 'packing',       icon: Package },
  packing:           { label: 'Tandai Dikirim',      nextStatus: 'shipped',       icon: Package },
  shipped:           { label: 'Selesaikan',          nextStatus: 'completed',     icon: CheckCircle2 },
};

// Terminal statuses: no primary action, badge only
const TERMINAL_STATUSES = ['completed', 'cancelled', 'refunded'];

// Secondary action: follow-up (send message) — available for all non-terminal
const FOLLOW_UP_STATUSES = ['pending', 'draft', 'waiting_payment', 'waiting_address', 'paid', 'packing', 'shipped'];


const NEEDS_ACTION = ['pending', 'draft', 'waiting_address', 'waiting_payment'];
const PROCESSING = ['paid', 'packing'];
const DONE = ['shipped', 'completed'];
const CANCELLED = ['cancelled', 'refunded'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRupiah(v: number | null | undefined): string {
  if (v == null) return '—';
  return `Rp ${Number(v).toLocaleString('id-ID')}`;
}

function statusBadge(status: string) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'bg-surface text-muted border-line dark:bg-dsurface dark:text-gray-500', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export default function OrderManager() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterTab>('needs_action');

  // Detail modal state
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  // Detail modal tab state
  const [detailTab, setDetailTab] = useState<'summary' | 'conversation'>('summary');
  const [convDetail, setConvDetail] = useState<ConversationDetail | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState('');

  // Follow-up state (per order id)
  const [followUpState, setFollowUpState] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});
  const [followUpError, setFollowUpError] = useState<Record<string, string>>({});

  // Cancel confirmation
  const [cancelConfirm, setCancelConfirm] = useState<{ orderId: string; ctx: 'modal' | 'card' } | null>(null);

  // Card-level error for status changes
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadOrders = () => {
    setLoading(true);
    setError('');
    api.get('/orders')
      .then((res) => setOrders(res.data.data))
      .catch(() => setError('Gagal memuat pesanan'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
  }, []);

  // ── Filter & counts ──
  const applyFilter = (o: Order, f: FilterTab) => {
    switch (f) {
      case 'needs_action': return NEEDS_ACTION.includes(o.orderStatus);
      case 'processing':   return PROCESSING.includes(o.orderStatus);
      case 'done':         return DONE.includes(o.orderStatus);
      case 'cancelled':    return CANCELLED.includes(o.orderStatus);
      default:             return true;
    }
  };

  const filteredOrders = orders.filter((o) => applyFilter(o, filter));
  const allCount = orders.length;
  const needsActionCount = orders.filter((o) => NEEDS_ACTION.includes(o.orderStatus)).length;
  const processingCount = orders.filter((o) => PROCESSING.includes(o.orderStatus)).length;
  const doneCount = orders.filter((o) => DONE.includes(o.orderStatus)).length;
  const cancelledCount = orders.filter((o) => CANCELLED.includes(o.orderStatus)).length;

  const loadDetail = async (orderId: string) => {
    setDetailLoading(true);
    setStatusError('');
    try {
      const res = await api.get(`/orders/${orderId}`);
      setDetailOrder(res.data.data);
      setDetailTab('summary');
      setConvDetail(null);
      setConvError('');
    } catch {
      setDetailOrder(null);
      // O4: Jangan perlih koneksi detail jika gagal — biarkan card tetap klik
    } finally {
      setDetailLoading(false);
    }
  };

  const loadConversation = async (convId: string) => {
    if (!convId) {
      setConvDetail(null);
      return;
    }
    setConvLoading(true);
    setConvError('');
    try {
      const res = await api.get(`/conversations/${convId}`);
      setConvDetail(res.data.data);
    } catch {
      setConvError('Gagal memuat percakapan');
      setConvDetail(null);
    } finally {
      setConvLoading(false);
    }
  };

  const handleTabChange = (tab: 'summary' | 'conversation') => {
    setDetailTab(tab);
    if (tab === 'conversation' && detailOrder?.conversationId && !convDetail) {
      loadConversation(detailOrder.conversationId);
    }
  };

  // ── Helper to format time for chat bubbles ──
  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  const handleStatusChange = async (orderId: string, newStatus: string, ctx: 'modal' | 'card' = 'card') => {
    if (ctx === 'modal') {
      setStatusLoading(true);
      setStatusError('');
    } else {
      setActionLoading(orderId);
      setActionError(null);
    }
    try {
      const res = await api.put(`/orders/${orderId}/status`, { orderStatus: newStatus });
      if (res.data.success) {
        setDetailOrder(res.data.data);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? res.data.data : o)));
        if (ctx === 'card') {
          showFeedback('success', 'Status pesanan diperbarui');
          setTimeout(() => setActionError(null), 5000);
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Gagal mengubah status';
      if (ctx === 'modal') {
        setStatusError(msg);
      } else {
        setActionError(msg);
        setTimeout(() => setActionError(null), 5000);
      }
    } finally {
      if (ctx === 'modal') {
        setStatusLoading(false);
      } else {
        setActionLoading(null);
      }
    }
  };

  const getItemName = (item: OrderItem): string => item.product || '—';
  const getItemPrice = (item: OrderItem): string => formatRupiah(item.price);
  const getItemQty = (item: OrderItem): number => item.qty ?? item.quantity ?? 1;

  // ── Follow-up ──
  const handleFollowUp = async (order: Order) => {
    const orderId = order.id;
    setFollowUpState((prev) => ({ ...prev, [orderId]: 'sending' }));
    setFollowUpError((prev) => ({ ...prev, [orderId]: '' }));

    const items = Array.isArray(order.items) ? order.items : [];
    const firstItemName = items.length > 0 ? getItemName(items[0]) : 'pesanan';
    const extraCount = items.length > 1 ? items.length - 1 : 0;
    const name = order.customerName || '';
    const content = `Halo kak${name ? ' ' + name : ''}! Untuk pesanan ${firstItemName}${extraCount ? ` +${extraCount} lainnya` : ''} (${formatRupiah(order.totalPrice)}), apakah masih ingin dilanjutkan? Balas ya kak kalau masih mau kami proses 🙂`;

    try {
      const convId = order.conversationId;
      if (!convId) throw new Error('conversationId tidak tersedia');
      const res = await api.post(`/conversations/${convId}/reply`, { message: content });
      if (res.data.success) {
        setFollowUpState((prev) => ({ ...prev, [orderId]: 'sent' }));
        setTimeout(() => setFollowUpState((prev) => ({ ...prev, [orderId]: 'idle' })), 3000);
      } else {
        throw new Error(res.data.error || 'Gagal mengirim');
      }
    } catch {
      setFollowUpState((prev) => ({ ...prev, [orderId]: 'error' }));
      setFollowUpError((prev) => ({ ...prev, [orderId]: 'Gagal mengirim — cek koneksi WhatsApp' }));
    }
  };

  // ── Cancel order ("Tidak jadi") ──
  const handleCancel = async (orderId: string, ctx: 'modal' | 'card' = 'card') => {
    if (ctx === 'modal') {
      setStatusLoading(true);
      setStatusError('');
    } else {
      setActionLoading(orderId);
      setActionError(null);
    }
    try {
      const res = await api.put(`/orders/${orderId}/status`, { orderStatus: 'cancelled' });
      if (res.data.success) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? res.data.data : o)));
        if (detailOrder?.id === orderId) {
          setDetailOrder(res.data.data);
        }
        setCancelConfirm(null);
        showFeedback('success', 'Pesanan dibatalkan');
        loadOrders();
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Gagal membatalkan pesanan';
      if (ctx === 'modal') {
        setStatusError(msg);
      } else {
        setActionError(msg);
        setTimeout(() => setActionError(null), 6000);
      }
    } finally {
      if (ctx === 'modal') {
        setStatusLoading(false);
      } else {
        setActionLoading(null);
      }
    }
  };

  // ── Action button: handle one-tap primary action ──
  const handlePrimaryAction = (order: Order, ctx: 'modal' | 'card' = 'card') => {
    const action = ACTION_MAP[order.orderStatus];
    if (!action) return;
    if (action.label === 'Isi Alamat') {
      loadDetail(order.id);
    } else {
      handleStatusChange(order.id, action.nextStatus, ctx);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-muted hover:text-ink transition shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-display font-bold text-navy dark:text-surface">Pesanan</h1>
          <p className="text-sm text-muted">Kelola pesanan pelanggan</p>
        </div>
      </div>

      {/* Feedback banner */}
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

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:border-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          <button
            onClick={loadOrders}
            className="ml-3 text-xs font-semibold text-red-700 underline hover:text-red-800 dark:text-red-400"
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-surface dark:bg-dline rounded-lg text-sm font-medium max-w-md overflow-x-auto">
        {[
          { key: 'needs_action', label: `Butuh Aksi (${needsActionCount})` },
          { key: 'processing', label: `Diproses (${processingCount})` },
          { key: 'done', label: `Selesai (${doneCount})` },
          { key: 'cancelled', label: `Batal (${cancelledCount})` },
          { key: 'all', label: `Semua (${allCount})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as FilterTab)}
            className={`flex-1 whitespace-nowrap shrink-0 py-2 px-3 rounded-md text-sm transition ${
              filter === tab.key
                ? 'bg-surface dark:bg-dcard text-brand shadow border border-line dark:border-dline'
                : 'text-muted hover:text-ink hover:bg-surface dark:hover:bg-dline'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Card-level action error banner */}
      {actionError && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 border border-red-200 dark:border-red-800">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline overflow-hidden">
          <div className="divide-y divide-line dark:divide-dline">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4">
                <div className="h-4 w-1/4 rounded bg-line animate-pulse mb-2" />
                <div className="h-3 w-1/2 rounded bg-line animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-8 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <p className="text-sm text-red-700 dark:text-red-400 font-medium mb-2">{error}</p>
          <button
            onClick={loadOrders}
            className="text-xs font-semibold text-brand underline hover:text-brand-deep"
          >
            Coba Lagi
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-12 sm:p-16 text-center">
          <Package className="w-10 h-10 text-muted dark:text-gray-500 mx-auto mb-3" />
          <p className="text-muted dark:text-gray-500 text-sm font-medium">
            {filter === 'needs_action'
              ? 'Semua pesanan selesai 🎉'
              : filter === 'done'
              ? 'Belum ada pesanan yang selesai'
              : filter === 'cancelled'
              ? 'Belum ada pesanan dibatalkan'
              : 'Belum ada pesanan'}
          </p>
          <p className="text-muted dark:text-gray-500 text-xs mt-1">
            {filter === 'all'
              ? 'Pesanan dari WhatsApp pelanggan akan muncul di sini.'
              : 'Ganti filter untuk melihat pesanan lain.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {filteredOrders.map((order) => {
            const items = Array.isArray(order.items) ? order.items : [];
            const action = ACTION_MAP[order.orderStatus];
            const isTerminal = TERMINAL_STATUSES.includes(order.orderStatus);
            const canFollowUp = FOLLOW_UP_STATUSES.includes(order.orderStatus);
            const fuState = followUpState[order.id] || 'idle';
            return (
              <div
                key={order.id}
                className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 cursor-pointer hover:bg-surface dark:hover:bg-dline transition group"
                onClick={() => loadDetail(order.id)}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink dark:text-surface truncate">
                      {items.map((item) => getItemName(item)).filter(Boolean).slice(0, 3).join(', ') || 'Pesanan'}
                    </p>
                    <p className="text-xs text-muted dark:text-gray-500 hidden sm:block">
                      {order.customerPhone || order.customerId}
                    </p>
                  </div>
                  {statusBadge(order.orderStatus)}
                </div>

                  <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-ink dark:text-surface">
                    {order.totalPrice != null ? formatRupiah(order.totalPrice) : <span className="text-muted dark:text-gray-500">Total belum ada</span>}
                  </p>
                  <p className="text-xs text-muted dark:text-gray-500 hidden sm:block">
                    {formatDate(order.createdAt)}
                  </p>
                </div>

                {/* Primary action — own row, w-full solid brand */}
                {!isTerminal && action && (
                  <button
                    onClick={() => handlePrimaryAction(order)}
                    disabled={actionLoading === order.id}
                    className="w-full sm:w-auto mb-2 px-3 py-2 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:opacity-50 transition flex items-center justify-center gap-1 shrink-0"
                  >
                    {actionLoading === order.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <action.icon className="w-3 h-3" />
                        {action.label}
                      </>
                    )}
                  </button>
                )}

                {/* Secondary actions — grid grid-cols-3 */}
                {canFollowUp || !isTerminal ? (
                  <div className="grid grid-cols-3 gap-2">
                    {canFollowUp && (
                      <button
                        onClick={() => handleFollowUp(order)}
                        disabled={fuState === 'sending'}
                        className={`px-2 py-1.5 rounded-lg border border-line dark:border-dline text-xs font-medium text-muted hover:bg-surface dark:hover:bg-dline transition flex items-center justify-center gap-1 truncate ${
                          fuState === 'sent' ? 'text-green-600 dark:text-green-400' : ''
                        }`}
                      >
                        {fuState === 'sending' ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : fuState === 'sent' ? (
                          'Terkirim ✓'
                        ) : (
                          <>
                            <Send className="w-3 h-3" />
                            Follow-up
                          </>
                        )}
                      </button>
                    )}
                    {!isTerminal && (
                      <button
                        onClick={() => setCancelConfirm({ orderId: order.id, ctx: 'card' })}
                        className="px-2 py-1.5 rounded-lg border border-line dark:border-dline text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center justify-center gap-1 truncate"
                      >
                        <Ban className="w-3 h-3" />
                        Tidak jadi
                      </button>
                    )}
                    <button
                      onClick={() => loadDetail(order.id)}
                      className="px-2 py-1.5 rounded-lg border border-line dark:border-dline text-xs text-muted hover:bg-surface dark:hover:bg-dline transition flex items-center justify-center truncate"
                    >
                      Detail
                    </button>
                  </div>
                ) : null}

                {/* Follow-up error */}
                {followUpError[order.id] && (
                  <div className="mt-2 px-2 py-1.5 rounded-lg text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {followUpError[order.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Detail Modal ─── */}
      {(detailOrder || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !detailLoading && setDetailOrder(null)}
        >
          <div
            className="bg-surface dark:bg-dcard rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="p-6 space-y-4">
                <div className="h-6 w-32 rounded bg-line animate-pulse" />
                <div className="h-4 w-48 rounded bg-line animate-pulse" />
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-12 rounded bg-line animate-pulse" />
                  ))}
                </div>
              </div>
            ) : detailOrder && (
              <>
                {/* Modal header with tabs */}
                <div className="p-5 border-b border-line dark:border-dline">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-ink dark:text-surface">Detail Pesanan</h2>
                      <p className="text-sm text-muted dark:text-gray-500">
                        {detailOrder.customerName || detailOrder.customerPhone || detailOrder.customerId}
                      </p>
                    </div>
                    <button
                      onClick={() => setDetailOrder(null)}
                      className="p-1.5 text-muted hover:text-ink dark:text-gray-500 dark:hover:text-gray-300 hover:bg-surface dark:hover:bg-dline rounded-lg transition"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  {/* Tabs */}
                  <div className="flex items-center gap-1 mt-3 border-b border-line dark:border-dline">
                    <button
                      onClick={() => handleTabChange('summary')}
                      className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
                        detailTab === 'summary'
                          ? 'bg-surface dark:bg-dcard text-brand border border-line dark:border-dline border-b-0'
                          : 'text-muted hover:text-ink hover:bg-surface dark:hover:bg-dline'
                      }`}
                    >
                      Ringkasan
                    </button>
                    <button
                      onClick={() => handleTabChange('conversation')}
                      className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
                        detailTab === 'conversation'
                          ? 'bg-surface dark:bg-dcard text-brand border border-line dark:border-dline border-b-0'
                          : 'text-muted hover:text-ink hover:bg-surface dark:hover:bg-dline'
                      }`}
                    >
                      Percakapan
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Status + primary action */}
                  {detailTab === 'summary' && (
                  <div className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-muted mb-2">Status Pesanan</p>
                    <div className="flex items-center gap-3">
                      {statusBadge(detailOrder.orderStatus)}
                      {!TERMINAL_STATUSES.includes(detailOrder.orderStatus) && ACTION_MAP[detailOrder.orderStatus] && (() => {
                        const action = ACTION_MAP[detailOrder.orderStatus];
                        return (
                          <button
                            onClick={() => handlePrimaryAction(detailOrder, 'modal')}
                            disabled={statusLoading}
                            className="w-auto shrink-0 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:opacity-50 transition flex items-center gap-1"
                          >
                            <action.icon className="w-3 h-3" />
                            {action.label}
                          </button>
                        );
                      })()}
                      {statusLoading && <Loader2 className="w-4 h-4 animate-spin text-brand" />}
                    </div>
                    {statusError && (
                      <p className="mt-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> {statusError}
                      </p>
                    )}
                  </div>

                  {/* Secondary actions — grid grid-cols-3 */}
                  {!TERMINAL_STATUSES.includes(detailOrder.orderStatus) && (
                    <div className="grid grid-cols-3 gap-2">
                      {FOLLOW_UP_STATUSES.includes(detailOrder.orderStatus) && (
                        <button
                          onClick={() => handleFollowUp(detailOrder)}
                          disabled={followUpState[detailOrder.id] === 'sending'}
                          className={`px-2 py-1.5 rounded-lg border border-line dark:border-dline text-xs font-medium text-muted hover:bg-surface dark:hover:bg-dline transition flex items-center justify-center gap-1 truncate ${
                            followUpState[detailOrder.id] === 'sent' ? 'text-green-600 dark:text-green-400' : ''
                          }`}
                        >
                          {followUpState[detailOrder.id] === 'sending' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : followUpState[detailOrder.id] === 'sent' ? (
                            'Terkirim ✓'
                          ) : (
                            <>
                              <Send className="w-3 h-3" />
                              Follow-up
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => setCancelConfirm({ orderId: detailOrder.id, ctx: 'modal' })}
                        className="px-2 py-1.5 rounded-lg border border-line dark:border-dline text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center justify-center gap-1 truncate"
                      >
                        <Ban className="w-3 h-3" />
                        Tidak jadi
                      </button>
                      <button
                        onClick={() => setDetailOrder(null)}
                        className="px-2 py-1.5 rounded-lg border border-line dark:border-dline text-xs text-muted hover:bg-surface dark:hover:bg-dline transition flex items-center justify-center truncate"
                      >
                        Detail
                      </button>
                    </div>
                  )}

                  {/* Items list */}
                  <div>
                    <p className="text-xs font-medium text-muted mb-2">Item Pesanan</p>
                    <div className="space-y-2">
                      {(detailOrder.items || []).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-surface dark:bg-dsurface rounded-lg px-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium text-ink dark:text-surface">{getItemName(item)}</p>
                            {item.unit && <p className="text-xs text-muted dark:text-gray-500">{item.unit}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-ink dark:text-surface">{getItemPrice(item)}</p>
                            {getItemQty(item) > 1 && (
                              <p className="text-xs text-muted dark:text-gray-500">x{getItemQty(item)}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Total + Address */}
                  <div className="border-t border-line dark:border-dline pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-ink dark:text-surface">Total</p>
                      <p className="text-lg font-bold text-ink dark:text-surface">
                        {detailOrder.totalPrice != null ? formatRupiah(detailOrder.totalPrice) : <span className="text-muted dark:text-gray-500">Total belum ada</span>}
                      </p>
                    </div>
                    {detailOrder.shippingAddress && (
                      <div>
                        <p className="text-xs font-medium text-muted">Alamat Pengiriman</p>
                        <p className="text-sm text-ink dark:text-surface mt-0.5">{detailOrder.shippingAddress}</p>
                      </div>
                    )}
                    <p className="text-xs text-muted dark:text-gray-500">
                      Dibuat pada {formatDate(detailOrder.createdAt)}
                    </p>
                  </div>

                  {/* Status override dropdown */}
                  <div>
                    <p className="text-xs font-medium text-muted mb-1.5">Ubah status manual</p>
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) handleStatusChange(detailOrder.id, v, 'modal');
                      }}
                      disabled={statusLoading}
                      className="w-full border border-line dark:border-dline rounded-lg px-3 py-1.5 text-sm text-ink dark:text-surface bg-surface dark:bg-dsurface focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                    >
                      <option value="">Pilih status...</option>
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

                {/* ── Percakapan Tab ── */}
                {detailTab === 'conversation' && (
                <div className="space-y-4">
                  {!detailOrder?.conversationId ? (
                    <p className="text-sm text-muted">Tidak ada percakapan terkait pesanan ini.</p>
                  ) : convLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-12 rounded bg-line animate-pulse" />
                      ))}
                    </div>
                  ) : convError ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200">
                      <AlertCircle className="w-4 h-4" />
                      {convError}
                    </div>
                  ) : convDetail && (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {convDetail.history.length === 0 ? (
                        <p className="text-sm text-muted py-6 text-center">Belum ada pesan</p>
                      ) : (
                        convDetail.history.map((msg) => {
                          const isUser = msg.role === 'user';
                          const isAgent = msg.role === 'agent';
                          return (
                            <div key={msg.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                              <div
                                className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                                  isUser
                                    ? 'bg-surface dark:bg-dsurface text-ink dark:text-surface rounded-bl-sm border border-line dark:border-dline'
                                    : isAgent
                                      ? 'bg-amber-50 dark:bg-amber-900/20 text-ink dark:text-surface rounded-br-sm border border-amber-200 dark:border-amber-800'
                                      : 'bg-brand-soft dark:bg-brand/10 text-ink dark:text-surface rounded-br-sm'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 mb-1">
                                  {isUser ? (
                                    <User className="w-3 h-3 text-muted" />
                                  ) : (
                                    <Bot className={`w-3 h-3 ${isAgent ? 'text-amber-600' : 'text-brand'}`} />
                                  )}
                                  <span className="text-[10px] font-medium text-muted">
                                    {isUser ? 'Customer' : isAgent ? 'Agent' : 'Assistant'}
                                  </span>
                                  {msg.source && (
                                    <span className="text-[9px] uppercase font-semibold text-muted bg-line/10 dark:bg-dline px-1 rounded">
                                      {msg.source}
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                <p className="text-[10px] text-muted dark:text-gray-500 mt-1 text-right">
                                  {formatTime(msg.createdAt)}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Cancel confirmation ─── */}
      {cancelConfirm && (
        <ConfirmDialog
          message="Tandai tidak jadi? Data tetap tersimpan untuk laporan."
          onConfirm={() => handleCancel(cancelConfirm.orderId, cancelConfirm.ctx)}
          onCancel={() => setCancelConfirm(null)}
        />
      )}
    </div>
  );
}
