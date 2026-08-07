import { useState, useEffect } from 'react';
import api from '../services/api';

export interface DashboardMetrics {
  totalMessages: number;
  faqAnswered: number;
  aiCostUSD: number;
}

export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/dashboard/metrics')
      .then((res) => {
        setMetrics(res.data.data);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return { metrics, loading, error };
}
