import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign, Package, Users, UserCheck, Bot, TrendingUp,
  BarChart3, AlertCircle,
} from 'lucide-react';
import api from '../services/api';
import { KpiCard, SimpleBarChart, AnalyticsSkeleton } from '../components/analytics/AnalyticsComponents';

// ── TYPES ──
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

// ── CONSTANTS ──
const PAID_STATUSES = ['paid', 'packing', 'shipped', 'completed'];
const ORDER_PENDING = ['pending', 'waiting_payment', 'waiting_address', 'draft'];
const PROCESSING = ['paid', 'packing'];
const DONE = ['shipped', 'completed'];
const CANCELLED = ['cancelled', 'refunded'];

// ── HELPERS ──
function formatRupiahCompact(v: number): string {
  if (v >= 1e6) return `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (v >= 1e3) return `Rp ${Math.round(v / 1e3)} rb`;
  return `Rp ${Math.round(v)}`;
}

export default function AnalyticsPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(7);
  const [chartMetric, setChartMetric] = useState<'omzet' | 'pesanan'>('omzet');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    Promise.allSettled([
      api.get('/orders'),
      api.get('/conversations')
    ]).then(([ord, conv]) => {
      if (!active) return;
      const ordOk = ord.status === 'fulfilled';
      const convOk = conv.status === 'fulfilled';
      setError(!ordOk && !convOk ? 'Gagal memuat laporan' : '');
      if (ord.status === 'fulfilled') setOrders(ord.value.data.data ?? []);
      if (conv.status === 'fulfilled') setConversations(conv.value.data.data ?? []);
      setLoading(false);
    });

    return () => { active = false; };
  }, []);

  // ── Period filter ──
  const now = new Date();
  const periodStart = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);

  const periodOrders = orders.filter((o) => {
    const d = new Date(o.createdAt);
    return !isNaN(d.getTime()) && d >= periodStart;
  });

  const periodConversations = conversations.filter((c) => {
    if (!c.lastMessageAt) return false;
    const d = new Date(c.lastMessageAt);
    return !isNaN(d.getTime()) && d >= periodStart;
  });

  // ── KPI computations ──
  const estimatedRevenue = periodOrders
    .filter((o) => PAID_STATUSES.includes(o.orderStatus))
    .reduce((sum, o) => sum + (o.totalPrice ?? 0), 0);

  const orderCount = periodOrders.length;
  const uniqueCustomers = new Set(periodConversations.map((c) => c.customerId)).size;

  const customerOrderCounts = new Map<string, number>();
  periodOrders.forEach((o) => {
    if (o.customerId) {
      customerOrderCounts.set(o.customerId, (customerOrderCounts.get(o.customerId) || 0) + 1);
    }
  });
  const repeatCustomers = Array.from(customerOrderCounts.values()).filter((c) => c >= 2).length;

  // ── Chart data: CONTIGUOUS array — one entry per day, always period-length
  //    {day, omzet, pesanan} so SimpleBarChart always renders N bars (zero-allowed)
  const chartData = Array.from({ length: period }, (_, i) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (period - 1 - i));
    const dayKey = day.toDateString();
    const dayOrders = periodOrders.filter((o) => new Date(o.createdAt).toDateString() === dayKey);
    const paidDay = dayOrders.filter((o) => PAID_STATUSES.includes(o.orderStatus));
    return {
      day: day.toISOString().slice(0, 10),
      omzet: paidDay.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0),
      pesanan: dayOrders.length,
    };
  });

  const chartYKey = chartMetric === 'omzet' ? 'omzet' : 'pesanan';
  const chartFormat = chartMetric === 'omzet'
    ? (v: number) => `Rp ${v.toLocaleString('id-ID')}`
    : (v: number) => `${v} pesanan`;

  // ── Produk Terlaris (top 5 by qty) ──
  const productMap = new Map<string, { qty: number; revenue: number }>();
  periodOrders
    .filter((o) => PAID_STATUSES.includes(o.orderStatus))
    .forEach((o) => {
      (o.items || []).forEach((item) => {
        const name = item.product || '—';
        const qty = item.qty ?? item.quantity ?? 1;
        const price = item.price ?? 0;
        const ex = productMap.get(name) || { qty: 0, revenue: 0 };
        ex.qty += qty;
        ex.revenue += price * qty;
        productMap.set(name, ex);
      });
    });
  const topProducts = Array.from(productMap.entries())
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  // ── Status Pesanan groups ──
  const statusCounts = {
    needs_action: periodOrders.filter((o) => ORDER_PENDING.includes(o.orderStatus)).length,
    processing: periodOrders.filter((o) => PROCESSING.includes(o.orderStatus)).length,
    done: periodOrders.filter((o) => DONE.includes(o.orderStatus)).length,
    cancelled: periodOrders.filter((o) => CANCELLED.includes(o.orderStatus)).length,
  };

  const STATUS_ROWS = [
    { label: 'Butuh Aksi', count: statusCounts.needs_action, dot: 'bg-amber-500' },
    { label: 'Diproses', count: statusCounts.processing, dot: 'bg-blue-500' },
    { label: 'Selesai', count: statusCounts.done, dot: 'bg-green-500' },
    { label: 'Batal', count: statusCounts.cancelled, dot: 'bg-red-500' },
  ];

  // ── Bot strip ──
  const totalBotResponses = periodConversations.reduce(
    (sum, c) => sum + (c.aiResponseCount ?? 0) + (c.faqResponseCount ?? 0),
    0
  );
  const humanTakeoverCount = periodConversations.filter((c) => c.status === 'human_takeover').length;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-ink dark:text-surface">Laporan</h1>
        <p className="text-sm text-muted mt-0.5">Performa tokomu</p>
      </div>

      {/* ── Period chips ── */}
      <div className="flex gap-1 mb-6 p-1 bg-surface dark:bg-dline rounded-lg text-sm font-medium max-w-xs overflow-x-auto">
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => {
              setPeriod(d);
              setChartMetric(d <= 14 ? 'omzet' : 'pesanan');
            }}
            className={`flex-1 whitespace-nowrap py-1.5 px-3 rounded-md text-sm transition ${
              period === d
                ? 'bg-surface dark:bg-dcard text-brand shadow border border-line dark:border-dline'
                : 'text-muted hover:text-ink hover:bg-surface dark:hover:bg-dline'
            }`}
          >
            {d}H
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm text-red-700 bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <AnalyticsSkeleton />
      ) : (
        <>
          {/* ── KPI Row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <button
              onClick={() => navigate('/dashboard/orders')}
              className="w-full text-left focus-visible:ring-2 focus-visible:ring-brand rounded-xl overflow-hidden transition group"
            >
              <KpiCard
                label="Estimasi Omzet"
                value={formatRupiahCompact(estimatedRevenue)}
                sub={`${periodOrders.filter((o) => PAID_STATUSES.includes(o.orderStatus)).length} transaksi terbayar`}
                icon={<DollarSign className="w-4 h-4" />}
                accent="green"
              />
            </button>

            <button
              onClick={() => navigate('/dashboard/orders')}
              className="w-full text-left focus-visible:ring-2 focus-visible:ring-brand rounded-xl overflow-hidden transition group"
            >
              <KpiCard
                label="Pesanan"
                value={orderCount.toLocaleString()}
                sub="Total pesanan"
                icon={<Package className="w-4 h-4" />}
                accent="brand"
              />
            </button>

            <button
              onClick={() => navigate('/dashboard/conversations')}
              className="w-full text-left focus-visible:ring-2 focus-visible:ring-brand rounded-xl overflow-hidden transition group"
            >
              <KpiCard
                label="Pelanggan"
                value={uniqueCustomers.toLocaleString()}
                sub="Unik dalam periode"
                icon={<Users className="w-4 h-4" />}
                accent="amber"
              />
            </button>

            <button
              onClick={() => navigate('/dashboard/conversations')}
              className="w-full text-left focus-visible:ring-2 focus-visible:ring-brand rounded-xl overflow-hidden transition group"
            >
              <KpiCard
                label="Pelanggan Kembali"
                value={repeatCustomers.toLocaleString()}
                sub="≥2 pesanan"
                icon={<UserCheck className="w-4 h-4" />}
                accent="gray"
              />
            </button>
          </div>

          {/* ── Chart Card ── */}
          <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-brand" />
                <h2 className="font-semibold text-ink dark:text-surface">Tren dalam {period} Hari</h2>
              </div>
              <div className="flex gap-1 p-0.5 bg-surface dark:bg-dsurface rounded-lg text-xs font-medium">
                <button
                  onClick={() => setChartMetric('omzet')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    chartMetric === 'omzet'
                      ? 'bg-brand-soft dark:bg-brand/15 text-brand'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  Omzet
                </button>
                <button
                  onClick={() => setChartMetric('pesanan')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    chartMetric === 'pesanan'
                      ? 'bg-brand-soft dark:bg-brand/15 text-brand'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  Pesanan
                </button>
              </div>
            </div>
            <SimpleBarChart
              data={chartData}
              xKey="day"
              yKey={chartYKey}
              color={chartMetric === 'omzet' ? 'bg-brand' : 'bg-emerald-500'}
              height={140}
              formatValue={chartFormat}
            />
          </div>

          {/* ── Two-column: Produk Terlaris + Status Pesanan ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Produk Terlaris */}
            <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
                Produk Terlaris
              </h3>
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted">Belum ada produk terjual dalam periode ini.</p>
              ) : (
                <div className="space-y-3">
                  {topProducts.map(([name, stats]) => (
                    <div key={name} className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink dark:text-surface truncate">{name}</p>
                        <p className="text-xs text-muted dark:text-gray-500">{stats.qty} terjual</p>
                      </div>
                      <span className="text-sm font-semibold text-ink dark:text-surface text-right">
                        {formatRupiahCompact(stats.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => navigate('/dashboard/products')}
                className="mt-4 text-sm text-brand hover:text-brand-deep font-medium text-left"
              >
                Kelola produk →
              </button>
            </div>

            {/* Status Pesanan */}
            <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
                Status Pesanan
              </h3>
              <div className="space-y-2.5">
                {STATUS_ROWS.map((r) => (
                  <button
                    key={r.label}
                    onClick={() => navigate('/dashboard/orders')}
                    className="w-full flex items-center justify-between py-2 text-left hover:bg-brand-soft dark:hover:bg-brand/10 rounded-lg transition group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${r.dot} shrink-0`} />
                      <span className="text-sm text-ink dark:text-surface">{r.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-ink dark:text-surface group-hover:text-brand transition">
                      {r.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Bot Strip ── */}
          <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Bot className="w-5 h-5 text-brand" />
              <span className="text-sm text-ink dark:text-surface">
                Bot menjawab <strong>{totalBotResponses}</strong> chat ·{' '}
                <strong>{humanTakeoverCount}</strong> diambil alih
              </span>
            </div>
            <button
              onClick={() => navigate('/dashboard/conversations')}
              className="text-xs font-medium text-brand hover:text-brand-deep transition shrink-0"
            >
              Lihat →
            </button>
          </div>
        </>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && orderCount === 0 && uniqueCustomers === 0 && (
        <div className="text-center py-16">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted" />
          <h3 className="text-lg font-medium text-ink dark:text-surface mb-1">
            Belum ada laporan dalam periode ini
          </h3>
          <p className="text-sm text-muted mb-4">
            Pesanan dan percakapan dari WhatsApp akan muncul di sini.
          </p>
          <button
            onClick={() => navigate('/dashboard/orders')}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition"
          >
            Kelola Pesanan
          </button>
        </div>
      )}
    </div>
  );
}
