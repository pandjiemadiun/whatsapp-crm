import { Request, Response, NextFunction } from 'express';
declare class MetricsStore {
    private samples;
    record(latencyMs: number, statusCode: number, timestamp: number): void;
    private windowed;
    snapshot(): {
        total: number;
        windowMs: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
        errorCount: number;
        errorRate: number;
    };
}
export declare const metricsStore: MetricsStore;
export declare function metricsMiddleware(req: Request, res: Response, next: NextFunction): void;
export {};
//# sourceMappingURL=metrics.middleware.d.ts.map