import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';

export interface MagicPasteAnalyticsSummary {
  totalExtractions: number;
  totalSuccess: number;
  failedCount: number;
  previewCount: number;
  averageConfidence: number;
  medianConfidence: number;
  minConfidence: number;
  maxConfidence: number;
  lowConfidenceCount: number;
  lowConfidenceRate: number;
  successRate: number;
}

export interface TrendPoint {
  date: string;
  count: number;
  failed: number;
  avgConfidence: number;
}

export interface HistoryItem {
  id: string;
  productId: string | null;
  textLength: number;
  confidence: number;
  status: 'success' | 'failed' | 'preview';
  warnings: string[] | null;
  extractedName: string | null;
  categoryHint: string | null;
  source: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface MagicPasteAnalytics {
  summary: MagicPasteAnalyticsSummary;
  trend: TrendPoint[];
  distribution: { low: number; medium: number; high: number };
  sourceBreakdown: { source: string; count: number; avgConfidence: number }[];
  history: HistoryItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  status?: string;
  source?: string;
}

/**
 * Hook untuk mengambil data analytics magic paste.
 * Mengikuti pola useDashboardMetrics (useState + useEffect + api.get).
 */
export function useMagicPasteAnalytics(filters: AnalyticsFilters = {}) {
  const [data, setData] = useState<MagicPasteAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.status) params.status = filters.status;
      if (filters.source) params.source = filters.source;
      const res = await api.get('/analytics/magic-paste', { params });
      setData(res.data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Gagal memuat analytics');
    } finally {
      setLoading(false);
    }
  }, [filters.from, filters.to, filters.status, filters.source]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return { data, loading, error, refetch: fetchAnalytics };
}
