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

  useEffect(() => {
    api.get('/dashboard/metrics')
      .then((res) => setMetrics(res.data.data))
      .catch(() => setMetrics({ totalMessages: 0, faqAnswered: 0, aiCostUSD: 0 }))
      .finally(() => setLoading(false));
  }, []);

  return { metrics, loading };
}
