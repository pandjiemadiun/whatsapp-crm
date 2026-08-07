import type { ReactNode } from 'react';
import { BarChart3, AlertCircle } from 'lucide-react';

/**
 * Card KPI ringkas untuk analytics dashboard.
 */
export function KpiCard({
  label,
  value,
  sub,
  icon,
  accent = 'brand',
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
  accent?: 'brand' | 'green' | 'amber' | 'red' | 'gray';
}) {
  const accents: Record<string, string> = {
    brand: 'bg-brand-soft dark:bg-brand/15 text-brand',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400',
    gray: 'bg-line text-muted dark:bg-dline dark:text-gray-400',
  };

  return (
    <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-5">
      <div className="flex items-center gap-3 mb-3">
        {icon && (
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accents[accent]}`}>
            {icon}
          </div>
        )}
        <span className="text-sm font-medium text-muted">{label}</span>
      </div>
      <div className="text-2xl font-bold text-ink dark:text-surface">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

/**
 * Bar chart sederhana berbasis Tailwind — tanpa dependency chart library.
 */
export function SimpleBarChart({
  data,
  xKey,
  yKey,
  color = 'bg-brand',
  height = 120,
  formatValue,
  hideXLabels = false,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  hideXLabels?: boolean;
}) {
  if (data.length === 0) {
    return <div className="text-sm text-muted py-6 text-center">Belum ada data</div>;
  }

  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1);

  // Format ISO date strings as dd/MM, fall back to raw string
  const formatXLabel = (raw: unknown): string => {
    const s = String(raw);
    if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) {
      const parts = s.slice(0, 10).split('-');
      return `${parts[2]}/${parts[1]}`;
    }
    return s;
  };

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => {
          const v = Number(d[yKey]) || 0;
          const h = Math.max((v / max) * 100, v > 0 ? 8 : 2);
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group" title={formatValue ? formatValue(v) : String(v)}>
              <div
                className={`w-full max-w-[28px] ${color} rounded-t transition-all group-hover:opacity-80`}
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
{!hideXLabels && (
        <div className="flex gap-1.5 mt-1.5">
          {data.map((d, i) => (
            <div key={i} className={`flex-1 text-center text-[10px] text-muted truncate ${i % 2 !== 0 ? 'hidden sm:block' : ''}`}>
              {formatXLabel(d[xKey])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Loading state skeleton.
 */
export function AnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-line animate-pulse" />
        ))}
      </div>
      <div className="h-48 rounded-xl bg-line animate-pulse" />
      <div className="h-64 rounded-xl bg-line animate-pulse" />
    </div>
  );
}

/**
 * Error state dengan tombol coba lagi.
 */
export function AnalyticsError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-surface dark:bg-dcard rounded-xl border border-red-200 dark:border-red-800 p-8 text-center space-y-3">
      <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
      <p className="text-sm text-red-700 font-medium">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}

/**
 * Empty state — belum ada data extraction.
 */
export function AnalyticsEmpty() {
  return (
    <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-10 text-center space-y-2">
      <div className="mx-auto w-12 h-12 rounded-full bg-brand-soft dark:bg-brand/15 flex items-center justify-center">
        <BarChart3 className="w-6 h-6 text-brand" />
      </div>
      <p className="font-medium text-ink">Belum ada data extraction</p>
      <p className="text-sm text-muted">
        Gunakan fitur Magic Paste di halaman Products untuk mulai melihat analytics confidence di sini.
      </p>
    </div>
  );
}
