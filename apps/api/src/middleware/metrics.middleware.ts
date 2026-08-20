import { Request, Response, NextFunction } from 'express';

interface RequestSample {
  latencyMs: number;
  statusCode: number;
  timestamp: number;
}

const MAX_SAMPLES = 1000;
const WINDOW_MS = 15 * 60 * 1000;

class MetricsStore {
  private samples: RequestSample[] = [];

  record(latencyMs: number, statusCode: number, timestamp: number): void {
    this.samples.push({ latencyMs, statusCode, timestamp });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  private windowed(): RequestSample[] {
    const cutoff = Date.now() - WINDOW_MS;
    let firstValid = 0;
    while (firstValid < this.samples.length && this.samples[firstValid].timestamp < cutoff) {
      firstValid++;
    }
    if (firstValid > 0) {
      this.samples = this.samples.slice(firstValid);
    }
    return this.samples;
  }

  snapshot() {
    const samples = this.windowed();
    const total = samples.length;
    let errorCount = 0;
    let sum = 0;
    const latencies: number[] = [];

    for (const s of samples) {
      sum += s.latencyMs;
      latencies.push(s.latencyMs);
      if (s.statusCode >= 400) {
        errorCount++;
      }
    }

    const avgLatencyMs = total > 0 ? Math.round((sum / total) * 100) / 100 : 0;
    latencies.sort((a, b) => a - b);
    const p95LatencyMs = total > 0 ? latencies[Math.floor(0.95 * (total - 1))] : 0;
    const errorRate = total > 0 ? Math.round((errorCount / total) * 10000) / 100 : 0;

    return {
      total,
      windowMs: WINDOW_MS,
      avgLatencyMs,
      p95LatencyMs,
      errorCount,
      errorRate,
    };
  }
}

export const metricsStore = new MetricsStore();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const startTime = Date.now();

  res.on('finish', () => {
    const diffNs = process.hrtime.bigint() - start;
    const latencyMs = Number(diffNs) / 1_000_000;
    metricsStore.record(latencyMs, res.statusCode, startTime);
  });

  next();
}
