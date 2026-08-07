import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, MessageCircle, Bot, DollarSign, Clock,
  ShoppingCart, Users, Store, TrendingUp, AlertCircle,
} from 'lucide-react';
import adminApi from '../../services/adminApi';
import { KpiCard, SimpleBarChart, AnalyticsSkeleton, AnalyticsError } from '../../components/analytics/AnalyticsComponents';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { formatRupiahCompact, usdToIdr } from '../../utils/formatMoney';

type DateRange = '7d' | '30d' | '90d';

interface AnalyticsData {
  range: DateRange;
  periodStart: string;
  periodEnd: string;
  messageVolumeTrend: Array<{ date: string; customer: number; assistant: number; system: number }>;
  costTrendUSD: Array<{ date: string; cost: number }>;
  responseTimeTrend: Array<{ date: string; avgMs: number; count: number }>;
  sourceBreakdown: Array<{ source: string; count: number; percentage: number }>;
  aiResponseRate: number;
  faqMatchRate: number;
  humanTakeoverRate: number;
  orderFunnel: Array<{ status: string; count: number; percentage: number }>;
  revenueTrend: Array<{ date: string; revenue: number; orderCount: number }>;
  activeStores: number;
  activeCustomers: number;
  totalMessages: number;
  totalOrders: number;
  totalCostUSD: number;
}

const RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7 Hari',
  '30d': '30 Hari',
  '90d': '90 Hari',
};

const SOURCE_LABELS: Record<string, string> = {
  ai: 'AI',
  faq: 'FAQ',
  product: 'Produk',
  sop: 'SOP',
  knowledge: 'Knowledge',
  cache: 'Cache',
  api: 'API',
  unknown: 'Lainnya',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  waiting_address: 'Menunggu Alamat',
  waiting_payment: 'Menunggu Pembayaran',
  paid: 'Dibayar',
  packing: 'Dikemas',
  shipped: 'Dikirim',
  pending: 'Tertunda',
  human_takeover: 'Human Takeover',
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  waiting_address: 'text-cyan',
  waiting_payment: 'bg-amber-400',
  paid: 'bg-cyan',
  packing: 'bg-brand',
  shipped: 'bg-indigo-500',
  pending: 'bg-slate-500',
  human_takeover: 'bg-red-500',
};

export default function AnalyticsDashboard() {
  const navigate = useNavigate();
  const { admin } = useAdminAuth();
  const isSuperAdmin = admin?.role === 'super_admin';

  const [range, setRange] = useState<DateRange>('30d');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAnalytics = async (selectedRange: DateRange, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get(`/analytics?range=${selectedRange}&refresh=${force}`);
      setData(res.data?.data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memuat analytics';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) {
      setError('Akses ditolak — super_admin only');
      setLoading(false);
      return;
    }
    fetchAnalytics(range);
  }, [range, isSuperAdmin]);

  const handleRangeChange = (newRange: DateRange) => {
    if (newRange !== range) {
      setRange(newRange);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await adminApi.post('/analytics/invalidate-cache');
    } catch {}
    await fetchAnalytics(range, true);
    setRefreshing(false);
  };

  // ─── Currency formatting ───
  // USD_TO_IDR is imported from utils/formatMoney.ts
  // AI/API costs stored in USD (costUSD) → displayed in IDR at display time only.

  const formatRupiah = (v: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  };

  // AI cost: USD stored → show compact IDR at display time only
  const formatCost = (v: number) => {
    return formatRupiahCompact(usdToIdr(v));
  };

  // Revenue: already in IDR from orders.totalPrice
  const formatRevenue = (v: number) => {
    return formatRupiah(v);
  };

  const formatCompact = (v: number) => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}jt`;
    if (v >= 1e3) return `${Math.round(v / 1e3)}rb`;
    return String(Math.round(v));
  };

  if (loading) {
    return (
      <div className="p-6 text-surface">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-xl text-surface">Analytics Dashboard</h1>
            <p className="text-sm text-slate-400">Platform-wide analytics ({RANGE_LABELS[range]})</p>
          </div>
        </div>
        <AnalyticsSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-surface">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-xl text-surface">Analytics Dashboard</h1>
            <p className="text-sm text-slate-400">Platform-wide analytics ({RANGE_LABELS[range]})</p>
          </div>
        </div>
        <AnalyticsError message={error} onRetry={() => fetchAnalytics(range, true)} />
      </div>
    );
  }

  const d = data!;

  // Determine AI response rate trend (color-coded)
  const aiRateColor = d.aiResponseRate >= 60 ? 'green' : d.aiResponseRate >= 30 ? 'amber' : 'red';

  // Revenue trend direction
  const revenueTrendData = d.revenueTrend;
  const firstRev = revenueTrendData[0]?.revenue || 0;
  const lastRev = revenueTrendData[revenueTrendData.length - 1]?.revenue || 0;
  const revenueDirection = revenueTrendData.length > 1
    ? lastRev >= firstRev ? 'up' : 'down'
    : 'flat';

  // Message volume trend direction
  const msgTrendData = d.messageVolumeTrend;
  const firstMsg = msgTrendData[0] ? msgTrendData[0].customer + msgTrendData[0].assistant : 0;
  const lastMsg = msgTrendData[msgTrendData.length - 1]
    ? msgTrendData[msgTrendData.length - 1].customer + msgTrendData[msgTrendData.length - 1].assistant
    : 0;
  const msgDirection = msgTrendData.length > 1
    ? lastMsg >= firstMsg ? 'up' : 'down'
    : 'flat';

  return (
    <div className="p-6 space-y-6 text-surface">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-xl text-surface">Analytics Dashboard</h1>
            <p className="text-sm text-slate-400">Platform-wide analytics</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Range selector tabs */}
          <div className="inline-flex items-center gap-1 bg-dline/20 rounded-lg p-1 text-sm">
            {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={`px-3 py-1.5 rounded-md font-medium text-sm transition font-mono ${
                  range === r
                    ? 'bg-brand text-white shadow'
                    : 'text-slate-400 hover:text-surface'
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 text-slate-400 hover:text-surface hover:bg-dline/20 rounded-lg transition disabled:opacity-50"
            title="Refresh (force recalculation)"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Headline KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Pesan"
          value={<span className="font-mono">{formatCompact(d.totalMessages)}</span>}
          sub={`${d.messageVolumeTrend.length} hari aktif`}
          icon={<MessageCircle className="w-5 h-5" />}
          accent={msgDirection === 'up' ? 'green' : msgDirection === 'down' ? 'red' : 'gray'}
        />
        <KpiCard
          label="AI Response Rate"
          value={<span className="font-mono">{d.aiResponseRate}%</span>}
          sub={`${formatCompact(d.activeCustomers)} pelanggan aktif`}
          icon={<Bot className="w-5 h-5" />}
          accent={aiRateColor}
        />
        <KpiCard
          label="FAQ Match Rate"
          value={<span className="font-mono">{d.faqMatchRate}%</span>}
          sub={`${d.humanTakeoverRate}% human takeover`}
          icon={<TrendingUp className="w-5 h-5" />}
          accent="amber"
        />
        <KpiCard
          label="Revenue"
          value={<span className="font-mono">{formatRevenue(d.revenueTrend.reduce((s, r) => s + r.revenue, 0))}</span>}
          sub={`${formatCompact(d.totalOrders)} pesan • ${revenueDirection === 'up' ? '↑' : revenueDirection === 'down' ? '↓' : '→'} vs start`}
          icon={<DollarSign className="w-5 h-5" />}
          accent={revenueDirection === 'up' ? 'green' : revenueDirection === 'down' ? 'red' : 'gray'}
        />
      </div>

      {/* Secondary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Toko Aktif"
          value={<span className="font-mono">{d.activeStores}</span>}
          icon={<Store className="w-5 h-5" />}
          accent="brand"
        />
        <KpiCard
          label="Pelanggan Aktif"
          value={<span className="font-mono">{formatCompact(d.activeCustomers)}</span>}
          icon={<Users className="w-5 h-5" />}
          accent="brand"
        />
        <KpiCard
          label="Total Cost (AI)"
          value={<span className="font-mono">{formatCost(d.totalCostUSD)}</span>}
          sub={formatCost(d.totalCostUSD)}

          icon={<DollarSign className="w-5 h-5" />}
          accent="gray"
        />
        <KpiCard
          label="Avg Response"
          value={<span className="font-mono">{`${d.responseTimeTrend.length > 0
            ? Math.round(d.responseTimeTrend.reduce((s, r) => s + r.avgMs, 0) / d.responseTimeTrend.length)
            : 0}ms`}</span>}
          sub="Rata-rata seluruh periode"
          icon={<Clock className="w-5 h-5" />}
          accent="gray"
        />
      </div>

      {/* Charts row 1: Message volume + Source breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <MessageCircle className="w-4 h-4" />
            Volume Pesan per Hari
          </h3>
          <div className="space-y-3">
            {d.messageVolumeTrend.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">Belum ada data</p>
            ) : (
              <>
                {/* Legend as separate row, no inline label competing with charts */}
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-brand" />
                    <span className="text-xs text-slate-400 font-mono">Customer</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-cyan" />
                    <span className="text-xs text-slate-400 font-mono">Assistant</span>
                  </div>
                </div>
                {/* Customer bars — chart takes full width now */}
                <SimpleBarChart
                  data={d.messageVolumeTrend}
                  xKey="date"
                  yKey="customer"
                  color="bg-brand"
                  height={80}
                  hideXLabels
                />
                {/* Assistant bars — only this chart shows date labels */}
                <SimpleBarChart
                  data={d.messageVolumeTrend}
                  xKey="date"
                  yKey="assistant"
                  color="bg-cyan"
                  height={80}
                />
              </>
            )}
          </div>
        </div>

        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Sumber Respons AI
          </h3>
          {d.sourceBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Belum ada data</p>
          ) : (
            <div className="space-y-3">
              {d.sourceBreakdown.map((s) => (
                <div key={s.source} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-400 w-20">{SOURCE_LABELS[s.source] || s.source}</span>
                  <div className="flex-1 h-6 bg-dline rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full transition-all"
                      style={{ width: `${s.percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 w-12 text-right font-mono">{s.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2: Cost trend + Response time trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Biaya AI per Hari (IDR)
          </h3>
          {d.costTrendUSD.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Belum ada data</p>
          ) : (
            <SimpleBarChart
              data={d.costTrendUSD}
              xKey="date"
              yKey="cost"
              color="bg-cyan"
              height={120}
              formatValue={(v) => formatRupiahCompact(usdToIdr(v))}
            />
          )}
        </div>

        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Waktu Respon per Hari
          </h3>
          {d.responseTimeTrend.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Belum ada data</p>
          ) : (
            <SimpleBarChart
              data={d.responseTimeTrend}
              xKey="date"
              yKey="avgMs"
              color="bg-brand"
              height={120}
              formatValue={(v) => `${v}ms`}
            />
          )}
        </div>
      </div>

      {/* Charts row 3: Order funnel + Revenue trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            Funnel Pesanan
          </h3>
          {d.orderFunnel.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Belum ada order</p>
          ) : (
            <div className="space-y-3">
              {d.orderFunnel
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((o) => (
                  <div key={o.status} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-400 w-32">{ORDER_STATUS_LABELS[o.status] || o.status}</span>
                    <div className="flex-1 h-6 bg-dline rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          ORDER_STATUS_COLORS[o.status] || 'bg-slate-500'
                        }`}
                        style={{ width: `${o.percentage}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-12 text-right font-mono">{o.count}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Revenue per Hari (IDR)
          </h3>
          {d.revenueTrend.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Belum ada data</p>
          ) : (
            <SimpleBarChart
              data={d.revenueTrend}
              xKey="date"
              yKey="revenue"
              color="bg-cyan"
              height={120}
              formatValue={(v) => formatRevenue(v)}
            />
          )}
        </div>
      </div>

      {/* Data source note */}
      <div className="pt-4 border-t border-dline text-xs text-slate-400 flex items-start gap-2">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Data dihitung secara real-time dari agregasi query. Cache berlaku 5 menit.
          Periode: <span className="font-mono">{new Date(d.periodStart).toLocaleDateString('id-ID')}</span> — <span className="font-mono">{new Date(d.periodEnd).toLocaleDateString('id-ID')}</span>.
        </span>
      </div>
    </div>
  );
}
