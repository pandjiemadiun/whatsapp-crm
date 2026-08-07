/**
 * Health Monitor Service — memantau metrik konektivitas & performa gateway.
 * Saat health score turun, auto-engage "Safe Mode":
 * - Pause kirim non-priority
 * - Naik delay global
 * - Disable presence updates
 */
import type { CircuitBreakerService } from './circuit-breaker.service.js';

export interface HealthMetrics {
  reconnectsPerHour: number;
  sendTimeouts: number;
  authErrors: number;
  messageQueueDepth: number;
  uptimeSeconds: number;
  safeMode: boolean;
}

export interface HealthThresholds {
  maxReconnectsPerHour: number;
  maxSendTime: number;
  maxAuthErrors: number;
}

export class HealthMonitorService {
  private metrics: HealthMetrics = {
    reconnectsPerHour: 0,
    sendTimeouts: 0,
    authErrors: 0,
    messageQueueDepth: 0,
    uptimeSeconds: 0,
    safeMode: false,
  };

  private readonly thresholds: HealthThresholds = {
    maxReconnectsPerHour: 5,
    maxSendTime: 10,
    maxAuthErrors: 3,
  };

  private reconnectTimestamps: number[] = [];
  private readonly startTime: number = Date.now();
  private circuitBreakers: CircuitBreakerService[] = [];

  registerCircuitBreaker(cb: CircuitBreakerService): void {
    this.circuitBreakers.push(cb);
  }

  recordReconnect(): void {
    const now = Date.now();
    this.reconnectTimestamps.push(now);
    this.pruneReconnects(now);
    this.metrics.sendTimeouts = this.reconnectTimestamps.length;
  }

  recordSendTimeout(): void {
    this.metrics.sendTimeouts = (this.metrics.sendTimeouts || 0) + 1;
  }

  recordAuthError(): void {
    this.metrics.authErrors++;
  }

  updateQueueDepth(depth: number): void {
    this.metrics.messageQueueDepth = depth;
  }

  private pruneReconnects(now: number): void {
    this.reconnectTimestamps = this.reconnectTimestamps.filter((ts) => now - ts < 60 * 60 * 1000);
  }

  checkSafeMode(): boolean {
    const now = Date.now();
    this.metrics.uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    this.pruneReconnects(now);
    this.metrics.reconnectsPerHour = this.reconnectTimestamps.length;

    const shouldEngage =
      this.metrics.reconnectsPerHour > this.thresholds.maxReconnectsPerHour ||
      this.metrics.sendTimeouts > this.thresholds.maxSendTime ||
      this.metrics.authErrors > this.thresholds.maxAuthErrors;

    if (shouldEngage && !this.metrics.safeMode) {
      this.metrics.safeMode = true;
    } else if (!shouldEngage && this.metrics.safeMode) {
      this.metrics.safeMode = false;
      this.metrics.sendTimeouts = 0;
      this.metrics.authErrors = 0;
    }

    return this.metrics.safeMode;
  }

  getMetrics(): HealthMetrics {
    return { ...this.metrics };
  }

  getCircuitStates(): Array<{ name: string; state: string; failureCount: number }> {
    return this.circuitBreakers.map((cb) => {
      const m = cb.getMetrics();
      return { name: m.name, state: m.state, failureCount: m.failureCount };
    });
  }

  reset(): void {
    this.metrics = {
      reconnectsPerHour: 0,
      sendTimeouts: 0,
      authErrors: 0,
      messageQueueDepth: 0,
      uptimeSeconds: 0,
      safeMode: false,
    };
    this.reconnectTimestamps.length = 0;
  }
}

export const healthMonitorService = new HealthMonitorService();
