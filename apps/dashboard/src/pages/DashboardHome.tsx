import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, DollarSign, MessageSquare, Package, AlertCircle,
  Clock, CheckCircle2, Phone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

// ── HELPERS ──
function greeting(hour: number): string {
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}

const USD_TO_IDR = 16000; // Rate statis aproksimasi

function formatRupiahCompact(v: number): string {
  if (v >= 1e6) return `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (v >= 1e3) return `Rp ${Math.round(v / 1e3)} rb`;
  return `Rp ${Math.round(v)}`;
}

function formatAiCostUSD(usd: number): string {
  if (usd <= 0) return 'Rp 0';
  return formatRupiahCompact(usd * USD_TO_IDR);
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Baru saja';
  if (diffMin < 60) return `${diffMin} mnt`;
  if (diffHr < 24) return `${diffHr} jam`;
  if (diffDay < 7) return `${diffDay} d`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function Skeleton({ className = 'h-5 w-20' }: { className?: string }) {
  return <div className={`${className} rounded-md bg-line dark:bg-dline animate-pulse`} />;
}

// ── TYPES ──
interface DashboardMetrics {
  totalMessages: number;
  faqAnswered: number;
  aiCostUSD: number;
}

interface ConversationItem {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  lastMessageAt: string | null;
  aiResponseCount: number;
  faqResponseCount: number;
}

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
  customerPhone?: string;
  items: OrderItem[];
  totalPrice: number | null;
  currency: string;
  orderStatus: string;
  shippingAddress: string | null;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  sku: string | null;
  stock: number | null;
  primaryImageUrl: string | null;
  isActive: boolean;
  source: string;
}

interface WaStatus {
  status: string;
  gateway: 'fonnte' | 'gowa' | null;
  phoneNumber: string | null;
  fonnteNumber: string | null;
  lastCheckedAt: string;
}

interface NeedActionTask {
  id: string;
  type: 'conversation' | 'order' | 'product' | 'whatsapp';
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  title: string;
  desc: string;
  actionLabel: string;
  path: string;
}

// Status-order yang butuh aksi pemilik
const ORDER_PENDING = ['pending', 'waiting_payment', 'waiting_address', 'draft'];

export default function DashboardHome() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [waStatus, setWaStatus] = useState<WaStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [metricsError, setMetricsError] = useState(false);
  const [convError, setConvError] = useState(false);

  useEffect(() => {
    // ── Fetch all dashboard data with Promise.allSettled ──
    const fetchData = async () => {
      setLoading(true);

      const [metricsRes, convRes, orderRes, prodRes, waRes] = await Promise.allSettled([
        api.get('/dashboard/metrics'),
        api.get('/conversations'),
        api.get('/orders'),
        api.get('/products/my'),
        api.get('/whatsapp/fonnte/status'),
      ]);

      const hasMetrics = metricsRes.status === 'fulfilled';
      const hasConversations = convRes.status === 'fulfilled';

      setMetricsError(!hasMetrics);
      setConvError(!hasConversations);

      if (metricsRes.status === 'fulfilled') {
        setMetrics(metricsRes.value.data.data);
      } else {
        setMetrics(null);
      }
      if (convRes.status === 'fulfilled') {
        setConversations(convRes.value.data.data ?? []);
      } else {
        setConversations([]);
      }
      if (orderRes.status === 'fulfilled') {
        setOrders(orderRes.value.data.data ?? []);
      }
      if (prodRes.status === 'fulfilled') {
        setProducts(prodRes.value.data?.products ?? []);
      }
      if (waRes.status === 'fulfilled') {
        setWaStatus(waRes.value.data.data);
      }

      setLoading(false);
    };

    fetchData();
  }, []);

  // ── Compute "Perlu tindakanmu" — at most one row per category ──
  const tasks: NeedActionTask[] = [];

  // 1. WhatsApp belum terhubung (brand tone, FIRST priority)
  if (waStatus && waStatus.status !== 'connected') {
    tasks.push({
      id: 'wa-connect',
      type: 'whatsapp',
      icon: Phone,
      iconBg: 'bg-brand-soft dark:bg-brand/20',
      iconColor: 'text-brand',
      title: 'Hubungkan WhatsApp',
      desc: 'Bot belum bisa bekerja sebelum kanal terhubung',
      actionLabel: 'Hubungkan',
      path: 'whatsapp',
    });
  }

  // 2. Human takeover conversations (red — one row, aggregated)
  const human = conversations.filter((c) => c.status === 'human_takeover');
  if (human.length > 0) {
    tasks.push({
      id: 'human-takeover',
      type: 'conversation',
      icon: MessageSquare,
      iconBg: 'bg-red-50 dark:bg-red-900/20',
      iconColor: 'text-red-600',
      title: `${human.length} chat diambil alih`,
      desc: 'Butuh respons langsung dari Anda',
      actionLabel: 'Balas',
      path: 'conversations',
    });
  }

  // 3. Pending orders (amber — one row, aggregated)
  const pending = orders.filter((o) => ORDER_PENDING.includes(o.orderStatus));
  if (pending.length > 0) {
    const sumItems = pending.reduce(
      (sum, o) => sum + (Array.isArray(o.items)
        ? o.items.reduce((a, it) => a + Number(it?.quantity ?? it?.qty ?? 1), 0)
        : 0),
      0
    );
    const sumTotal = pending.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0);
    tasks.push({
      id: 'pending-orders',
      type: 'order',
      icon: Clock,
      iconBg: 'bg-amber-50 dark:bg-amber-900/20',
      iconColor: 'text-amber-600',
      title: `${pending.length} pesanan perlu proses`,
      desc: sumItems > 0
        ? `${sumItems} item • ${formatRupiahCompact(sumTotal)}`
        : formatRupiahCompact(sumTotal),
      actionLabel: 'Proses',
      path: 'orders',
    });
  }

  // 4. Low stock products (orange — one row, aggregated)
  const lowStock = products.filter((p) => p.stock !== null && p.stock <= 5);
  if (lowStock.length > 0) {
    tasks.push({
      id: 'low-stock',
      type: 'product',
      icon: Package,
      iconBg: 'bg-orange-50 dark:bg-orange-900/20',
      iconColor: 'text-orange-600',
      title: `${lowStock.length} stok menipau`,
      desc: 'Beberapa produk perlu restock',
      actionLabel: 'Cek',
      path: 'products',
    });
  }

  // ── Derived stats ──
  const openConversations = conversations.filter((c) => c.status === 'open');
  const openConversationCount = openConversations.length;
  const activeOrderCount = orders.filter((o) =>
    !['shipped', 'cancelled', 'refunded', 'completed'].includes(o.orderStatus)
  ).length;

  // ── Estimasi Omzet ──
  const completedStatuses = ['paid', 'packing', 'shipped', 'completed'];
  const estimatedRevenue = orders
    .filter((o) => completedStatuses.includes(o.orderStatus))
    .reduce((sum, o) => sum + (o.totalPrice ?? 0), 0);

  // ── Greeting ──
  const now = new Date();
  const greet = greeting(now.getHours());
  const storeName = user?.storeName || user?.email?.split('@')[0] || 'Toko';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ── 1. Greeting header ── */}
      <div className="min-w-0">
        <h1 className="text-2xl font-display font-bold text-navy dark:text-surface">
          {greet}, {storeName}!
        </h1>
        <p className="text-sm text-muted mt-0.5">
          Ini ringkasan aktivitas toko Anda hari ini.
        </p>
      </div>

      {/* ── 2. Error banner (retry) ── */}
      {(metricsError || convError) && (
        <div className="px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:border-red-800 dark:border-red-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium">Data tidak dapat dimuat</span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-semibold text-red-700 underline hover:text-red-800 dark:text-red-400"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* ── 2.5. WhatsApp CTA banner ── */}
      <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-brand-soft dark:bg-brand/20 rounded-lg flex items-center justify-center shrink-0">
            <Phone className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ink dark:text-surface">WhatsApp Business</h2>
            <p className="text-sm text-muted mt-0.5">
              {waStatus && waStatus.status === 'connected'
                ? `Terhubung • ${waStatus.phoneNumber || '-'}`
                : 'WhatsApp belum terhubung — bot tidak dapat memproses pesan.'}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/dashboard/whatsapp')}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition"
        >
          <Phone className="w-4 h-4" />
          {waStatus && waStatus.status === 'connected' ? 'Lihat Percakapan' : 'Hubungkan WhatsApp dulu'}
        </button>
      </div>

      {/* ── 3. "Perlu tindakanmu" ── */}
      <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
          Perlu tindakanmu
        </h2>

        {tasks.length === 0 ? (
          openConversationCount > 0 ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface dark:bg-dsurface">
              <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-ink dark:text-surface">Inbox aktif</p>
                <p className="text-sm text-muted">{openConversationCount} percakapan terbuka</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-muted">
              <CheckCircle2 className="w-8 h-8 mx-auto text-green-400 mb-2" />
              <p className="font-medium text-ink dark:text-surface">Semua beres!</p>
              <p className="text-sm mt-1">Tidak ada tugas yang perlu ditindaklanjuti.</p>
            </div>
          )
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center gap-3 p-3 rounded-lg hover:bg-brand-soft dark:hover:bg-dline transition group"
              >
                <div className={`w-8 h-8 ${task.iconBg} rounded-lg flex items-center justify-center shrink-0`}>
                  <task.icon className={`w-4 h-4 ${task.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0 basis-40">
                  <p className="font-medium text-ink dark:text-surface">{task.title}</p>
                  <p className="text-sm text-muted">{task.desc}</p>
                </div>
                <button
                  onClick={() => navigate(task.path)}
                  className="w-full sm:w-auto justify-center px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition shrink-0"
                >
                  {task.actionLabel}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 4. KPI strip ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
          Ringkasan
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {/* Total Pesan → conversations */}
          <button
            type="button"
            onClick={() => navigate('conversations')}
            className="text-left bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 hover:bg-brand-soft dark:hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-brand transition group"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition">
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-xs text-muted">Total Pesan</span>
            </div>
            <div className="text-xl font-bold text-ink dark:text-surface">
              {loading ? <Skeleton className="h-6 w-16" /> : metricsError ? <span className="text-sm text-muted">Gagal dimuat</span> : (metrics?.totalMessages ?? 0).toLocaleString()}
            </div>
          </button>

          {/* Chat Terbuka → conversations */}
          <button
            type="button"
            onClick={() => navigate('conversations')}
            className="text-left bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 hover:bg-brand-soft dark:hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-brand transition group"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 bg-brand-soft dark:bg-brand/20 rounded-lg flex items-center justify-center group-hover:bg-brand/20 transition">
                <MessageSquare className="w-4 h-4 text-brand" />
              </div>
              <span className="text-xs text-muted">Chat Terbuka</span>
            </div>
            <div className="text-xl font-bold text-ink dark:text-surface">
              {loading ? <Skeleton className="h-6 w-14" /> : openConversationCount}
            </div>
          </button>

          {/* Pesanan Aktif → orders */}
          <button
            type="button"
            onClick={() => navigate('orders')}
            className="text-left bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 hover:bg-brand-soft dark:hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-brand transition group"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 bg-rose-50 dark:bg-rose-900/20 rounded-lg flex items-center justify-center group-hover:bg-rose-100 dark:group-hover:bg-rose-900/30 transition">
                <Package className="w-4 h-4 text-rose-600" />
              </div>
              <span className="text-xs text-muted">Pesanan Aktif</span>
            </div>
            <div className="text-xl font-bold text-ink dark:text-surface">
              {loading ? <Skeleton className="h-6 w-14" /> : activeOrderCount}
            </div>
          </button>

          {/* Estimasi Omzet → orders */}
          <button
            type="button"
            onClick={() => navigate('orders')}
            className="text-left bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 hover:bg-brand-soft dark:hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-brand transition group"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition">
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-xs text-muted">Estimasi Omzet</span>
            </div>
            <div className="text-xl font-bold text-ink dark:text-surface">
              {loading ? <Skeleton className="h-6 w-24" /> : formatRupiahCompact(estimatedRevenue)}
            </div>
          </button>

          {/* Biaya AI → metrics (D3: Rupiah, rate 16000) */}
          <button
            type="button"
            className="text-left bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 opacity-60 cursor-default group"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
                <Package className="w-4 h-4 text-indigo-600" />
              </div>
              <span className="text-xs text-muted">Biaya AI (kira-kira)</span>
            </div>
            <div className="text-xl font-bold text-ink dark:text-surface">
              {loading ? <Skeleton className="h-6 w-20" /> : formatAiCostUSD(metrics?.aiCostUSD ?? 0)}
            </div>
          </button>
        </div>
      </div>

      {/* ── 5. Aktivitas terbaru ── */}
      <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
          Aktivitas terbaru
        </h2>

        <div className="space-y-3">
          {loading ? (
            // Skeleton placeholders
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-line dark:bg-dline animate-pulse shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20 mt-1" />
                  </div>
                </div>
              ))
            ) : conversations.length === 0 ? (
              <p className="text-sm text-muted dark:text-gray-500 py-4 text-center">
                Belum ada aktivitas percakapan.
              </p>
            ) : (
              [...conversations]
                .sort((a, b) => {
                  const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                  const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                  return tb - ta;
                })
                .slice(0, 4)
                .map((c) => {
                  const avatarInitial = c.customerName
                    ? c.customerName.trim().charAt(0).toUpperCase()
                    : 'P';
                  return (
                    <button
                      key={c.id}
                      onClick={() => navigate('conversations')}
                      className="w-full flex items-center gap-3 text-left hover:bg-brand-soft dark:hover:bg-dline rounded-lg p-2 transition group"
                    >
<div className="w-8 h-8 rounded-full bg-brand-soft dark:bg-brand/20 text-brand flex items-center justify-center text-xs font-semibold shrink-0">
                        {avatarInitial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink dark:text-surface truncate">
                          {c.customerName || `Pelanggan ${c.customerPhone}`}
                        </p>
                        <p className="text-xs text-muted truncate">
                          {c.lastMessageAt
                            ? timeAgo(c.lastMessageAt)
                            : '-'}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          c.status === 'human_takeover'
                            ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                            : c.status === 'open'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                            : 'bg-surface text-muted dark:bg-dsurface dark:text-gray-500'
                        }`}
                      >
                        {c.status === 'human_takeover'
                          ? 'Butuh balasan'
                          : c.status === 'open'
                          ? 'Terbuka'
                          : 'Selesai'}
                      </span>
                    </button>
                  );
                })
            )}
          </div>
        </div>
      </div>
  );
}
