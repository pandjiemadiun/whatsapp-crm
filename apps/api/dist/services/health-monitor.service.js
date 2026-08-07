export class HealthMonitorService {
    constructor() {
        this.metrics = {
            reconnectsPerHour: 0,
            sendTimeouts: 0,
            authErrors: 0,
            messageQueueDepth: 0,
            uptimeSeconds: 0,
            safeMode: false,
        };
        this.thresholds = {
            maxReconnectsPerHour: 5,
            maxSendTime: 10,
            maxAuthErrors: 3,
        };
        this.reconnectTimestamps = [];
        this.startTime = Date.now();
        this.circuitBreakers = [];
    }
    registerCircuitBreaker(cb) {
        this.circuitBreakers.push(cb);
    }
    recordReconnect() {
        const now = Date.now();
        this.reconnectTimestamps.push(now);
        this.pruneReconnects(now);
        this.metrics.sendTimeouts = this.reconnectTimestamps.length;
    }
    recordSendTimeout() {
        this.metrics.sendTimeouts = (this.metrics.sendTimeouts || 0) + 1;
    }
    recordAuthError() {
        this.metrics.authErrors++;
    }
    updateQueueDepth(depth) {
        this.metrics.messageQueueDepth = depth;
    }
    pruneReconnects(now) {
        this.reconnectTimestamps = this.reconnectTimestamps.filter((ts) => now - ts < 60 * 60 * 1000);
    }
    checkSafeMode() {
        const now = Date.now();
        this.metrics.uptimeSeconds = Math.floor((now - this.startTime) / 1000);
        this.pruneReconnects(now);
        this.metrics.reconnectsPerHour = this.reconnectTimestamps.length;
        const shouldEngage = this.metrics.reconnectsPerHour > this.thresholds.maxReconnectsPerHour ||
            this.metrics.sendTimeouts > this.thresholds.maxSendTime ||
            this.metrics.authErrors > this.thresholds.maxAuthErrors;
        if (shouldEngage && !this.metrics.safeMode) {
            this.metrics.safeMode = true;
        }
        else if (!shouldEngage && this.metrics.safeMode) {
            this.metrics.safeMode = false;
            this.metrics.sendTimeouts = 0;
            this.metrics.authErrors = 0;
        }
        return this.metrics.safeMode;
    }
    getMetrics() {
        return { ...this.metrics };
    }
    getCircuitStates() {
        return this.circuitBreakers.map((cb) => {
            const m = cb.getMetrics();
            return { name: m.name, state: m.state, failureCount: m.failureCount };
        });
    }
    reset() {
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
//# sourceMappingURL=health-monitor.service.js.map