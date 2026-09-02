import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, AlertCircle } from 'lucide-react';
import adminApi from '../../services/adminApi';

interface ProviderUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface QueryResponse {
  success: boolean;
  data: {
    from: string;
    to: string;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    perProvider: Record<string, ProviderUsage>;
  };
}

type RangePreset = 'today' | '7d' | '30d' | 'custom';

function getRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const end = now.toISOString();

  switch (preset) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start.toISOString(), to: end };
    }
    case '7d': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { from: start.toISOString(), to: end };
    }
    case '30d': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { from: start.toISOString(), to: end };
    }
    case 'custom': {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : end,
        to: customTo ? new Date(customTo).toISOString() : end,
      };
    }
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString('id-ID');
}

function formatCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.001) return '<$0.001';
  return `$${n.toFixed(4)}`;
}

export default function TokenUsage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QueryResponse['data'] | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getRange(preset, customFrom, customTo);
      const res = await adminApi.get<QueryResponse>('/config/token-usage/query', {
        params: { from, to },
      });
      setData(res.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Gagal memuat data penggunaan token.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const providerEntries = data ? Object.entries(data.perProvider) : [];
  const maxRequests = providerEntries.reduce((max, [, v]) => Math.max(max, v.requests), 0);

  return (
    <div className="p-6 text-surface">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin/ai-providers')} className="text-slate-400 hover:text-surface transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-xl text-surface">Token Usage</h1>
          <p className="text-sm text-slate-400">
            Monitor LLM token consumption per provider over time.
          </p>
        </div>
      </div>

      {/* ── Time range selector ── */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {([
          { key: 'today', label: 'Today' },
          { key: '7d', label: 'Last 7 days' },
          { key: '30d', label: 'Last 30 days' },
          { key: 'custom', label: 'Custom' },
        ] as const).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setPreset(opt.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              preset === opt.key
                ? 'bg-cyan/10 text-cyan border border-cyan/20'
                : 'bg-dline/20 text-slate-400 hover:text-surface border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-dcard border border-dline text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan"
            />
            <span className="text-slate-400 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-dcard border border-dline text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan"
            />
          </div>
        )}
      </div>

      {/* ── Loading state ── */}
      {loading && (
        <div className="space-y-4">
          <div className="h-24 rounded-lg bg-dline/30 animate-pulse" />
          <div className="h-48 rounded-lg bg-dline/30 animate-pulse" />
        </div>
      )}

      {/* ── Error state ── */}
      {!loading && error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && data && providerEntries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <BarChart3 className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-sm font-medium">No usage data for this range.</p>
          <p className="text-xs mt-1">Try a wider range, or check back after some chat activity.</p>
        </div>
      )}

      {/* ── Data ── */}
      {!loading && !error && data && providerEntries.length > 0 && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-dcard rounded-lg border border-dline p-4">
              <p className="text-xs text-slate-400 mb-1">Total Requests</p>
              <p className="text-2xl font-semibold text-surface">{formatNumber(data.totalRequests)}</p>
            </div>
            <div className="bg-dcard rounded-lg border border-dline p-4">
              <p className="text-xs text-slate-400 mb-1">Input Tokens</p>
              <p className="text-2xl font-semibold text-surface">{formatNumber(data.totalInputTokens)}</p>
            </div>
            <div className="bg-dcard rounded-lg border border-dline p-4">
              <p className="text-xs text-slate-400 mb-1">Output Tokens</p>
              <p className="text-2xl font-semibold text-surface">{formatNumber(data.totalOutputTokens)}</p>
            </div>
          </div>

          {/* Simple bar chart — requests per provider */}
          <div className="bg-dcard rounded-lg border border-dline p-4">
            <h2 className="text-sm font-medium text-slate-400 mb-4">Requests per Provider</h2>
            <div className="space-y-3">
              {providerEntries.map(([provider, usage]) => (
                <div key={provider} className="flex items-center gap-3">
                  <span className="text-sm text-surface w-28 shrink-0 truncate font-mono">{provider}</span>
                  <div className="flex-1 h-6 bg-dline/20 rounded overflow-hidden">
                    <div
                      className="h-full bg-cyan/60 rounded transition-all"
                      style={{ width: `${maxRequests > 0 ? (usage.requests / maxRequests) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-400 w-12 text-right">{usage.requests}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-provider breakdown table */}
          <div className="bg-dcard rounded-lg border border-dline overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dline">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Provider</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Requests</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Input Tokens</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Output Tokens</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Cost (approx)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dline">
                {providerEntries.map(([provider, usage]) => (
                  <tr key={provider}>
                    <td className="px-4 py-3 text-surface font-mono">{provider}</td>
                    <td className="px-4 py-3 text-right text-surface">{formatNumber(usage.requests)}</td>
                    <td className="px-4 py-3 text-right text-surface">{formatNumber(usage.inputTokens)}</td>
                    <td className="px-4 py-3 text-right text-surface">{formatNumber(usage.outputTokens)}</td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs">{formatCost(usage.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-dline bg-dline/10">
                  <td className="px-4 py-3 text-surface font-medium">Total</td>
                  <td className="px-4 py-3 text-right text-surface font-medium">{formatNumber(data.totalRequests)}</td>
                  <td className="px-4 py-3 text-right text-surface font-medium">{formatNumber(data.totalInputTokens)}</td>
                  <td className="px-4 py-3 text-right text-surface font-medium">{formatNumber(data.totalOutputTokens)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{formatCost(data.totalCostUsd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
