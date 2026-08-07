import type { ReactNode } from 'react';

export interface MetricCardProps {
  title: string;
  value: React.ReactNode;
  trend?: { direction: 'up' | 'down'; percentage: number };
  icon?: ReactNode;
  isLoading?: boolean;
}

export function MetricCard({ title, value, trend, icon, isLoading }: MetricCardProps) {
  return (
    <div className="bg-dcard border border-dline rounded-lg p-4">
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
        {icon}
        <span>{title}</span>
      </div>

      {isLoading ? (
        <div className="space-y-1">
          <div className="h-8 w-24 rounded bg-dline animate-pulse" />
          <div className="h-4 w-16 rounded bg-dline animate-pulse" />
        </div>
      ) : (
        <>
          <p className="text-3xl font-mono font-bold text-surface">{value}</p>

          {trend && (
            <div className={`flex items-center gap-1 mt-1 text-xs font-mono ${
              trend.direction === 'up' ? 'text-cyan' : 'text-red-500'
            }`}>
              <span>{trend.direction === 'up' ? '↑' : '↓'}</span>
              <span>{trend.percentage}%</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
