import { useState, useCallback } from 'react';
import adminApi from '../services/adminApi';

export interface MissionControlPulse {
  totalActiveMerchants: number;
  totalMessagesToday: number;
  aiCostToday: number;
  systemHealth: {
    db: boolean;
    redis: boolean;
    gowa: boolean;
  };
}

export interface ModelUsageEntry {
  model: string;
  count: number;
  totalCostUSD: number;
}

export interface AiOpsData {
  modelUsage: ModelUsageEntry[];
  fallbackRate: number;
}

export interface HourlyActivityEntry {
  hour: number;
  messageCount: number;
}

export interface HeatmapData {
  hourlyActivity: HourlyActivityEntry[];
}

export interface MerchantStat {
  storeId: string;
  storeName: string;
  messageCount: number;
  lastActiveAt: string | null;
}

export interface LeaderboardData {
  topMerchants: MerchantStat[];
}

export interface StoreWaStatus {
  storeId: string;
  storeName: string;
  hasGowa: boolean;
  hasFonnte: boolean;
  lastMessageAt: string | null;
}

type Range = '7d' | '30d' | '90d';

interface MissionControlState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useMissionControl() {
  const [pulse, setPulse] = useState<MissionControlState<MissionControlPulse>>({
    data: null, loading: false, error: null,
  });
  const [aiOps, setAiOps] = useState<MissionControlState<AiOpsData>>({
    data: null, loading: false, error: null,
  });
  const [heatmap, setHeatmap] = useState<MissionControlState<HeatmapData>>({
    data: null, loading: false, error: null,
  });
  const [leaderboard, setLeaderboard] = useState<MissionControlState<LeaderboardData>>({
    data: null, loading: false, error: null,
  });
  const [waStatus, setWaStatus] = useState<MissionControlState<StoreWaStatus[]>>({
    data: null, loading: false, error: null,
  });

  const fetchPulse = useCallback(async () => {
    setPulse({ data: null, loading: true, error: null });
    try {
      const res = await adminApi.get('/mission-control/pulse');
      setPulse({ data: res.data, loading: false, error: null });
      return res.data as MissionControlPulse;
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memuat pulse';
      setPulse({ data: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  const fetchAiOps = useCallback(async (range: Range = '7d') => {
    setAiOps({ data: null, loading: true, error: null });
    try {
      const res = await adminApi.get('/mission-control/ai-ops', { params: { range } });
      setAiOps({ data: res.data, loading: false, error: null });
      return res.data as AiOpsData;
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memuat AI ops';
      setAiOps({ data: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  const fetchHeatmap = useCallback(async (days?: number) => {
    setHeatmap({ data: null, loading: true, error: null });
    try {
      const params = days !== undefined ? { days } : {};
      const res = await adminApi.get('/mission-control/heatmap', { params });
      setHeatmap({ data: res.data, loading: false, error: null });
      return res.data as HeatmapData;
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memuat heatmap';
      setHeatmap({ data: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  const fetchLeaderboard = useCallback(async (range: Range = '30d') => {
    setLeaderboard({ data: null, loading: true, error: null });
    try {
      const res = await adminApi.get('/mission-control/leaderboard', { params: { range } });
      setLeaderboard({ data: res.data, loading: false, error: null });
      return res.data as LeaderboardData;
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memuat leaderboard';
      setLeaderboard({ data: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  const fetchWaStatus = useCallback(async () => {
    setWaStatus({ data: null, loading: true, error: null });
    try {
      const res = await adminApi.get('/mission-control/wa-status');
      setWaStatus({ data: res.data, loading: false, error: null });
      return res.data as StoreWaStatus[];
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memuat WA status';
      setWaStatus({ data: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  return {
    pulse,
    aiOps,
    heatmap,
    leaderboard,
    waStatus,
    fetchPulse,
    fetchAiOps,
    fetchHeatmap,
    fetchLeaderboard,
    fetchWaStatus,
  };
}
