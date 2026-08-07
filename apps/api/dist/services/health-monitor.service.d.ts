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
export declare class HealthMonitorService {
    private metrics;
    private readonly thresholds;
    private reconnectTimestamps;
    private readonly startTime;
    private circuitBreakers;
    registerCircuitBreaker(cb: CircuitBreakerService): void;
    recordReconnect(): void;
    recordSendTimeout(): void;
    recordAuthError(): void;
    updateQueueDepth(depth: number): void;
    private pruneReconnects;
    checkSafeMode(): boolean;
    getMetrics(): HealthMetrics;
    getCircuitStates(): Array<{
        name: string;
        state: string;
        failureCount: number;
    }>;
    reset(): void;
}
export declare const healthMonitorService: HealthMonitorService;
//# sourceMappingURL=health-monitor.service.d.ts.map