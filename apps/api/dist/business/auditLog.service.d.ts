import { Prisma } from '@prisma/client';
export interface AuditLogInput {
    storeId: string;
    action: string;
    entity: string;
    entityId: string;
    adminId: string;
    changes?: Prisma.InputJsonValue;
    ipAddress?: string;
}
export interface AuditLogSearchFilters {
    page?: number;
    pageSize?: number;
    action?: string;
    entity?: string;
    storeId?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
}
export declare function logAction(input: AuditLogInput): Promise<void>;
export declare function searchLogs(filters?: AuditLogSearchFilters): Promise<{
    logs: {
        id: string;
        createdAt: Date;
        storeId: string;
        action: string;
        entity: string;
        entityId: string;
        userId: string | null;
        changes: Prisma.JsonValue | null;
        ipAddress: string | null;
    }[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}>;
export declare function getLogDetail(logId: string): Promise<{
    id: string;
    createdAt: Date;
    storeId: string;
    action: string;
    entity: string;
    entityId: string;
    userId: string | null;
    changes: Prisma.JsonValue | null;
    ipAddress: string | null;
}>;
export declare function getLogStats(storeId?: string): Promise<{
    totalActions: number;
    actionBreakdown: Record<string, number>;
    lastActionAt: Date;
    topUsers: {
        userId: string;
        count: number;
    }[];
}>;
export interface ExportFilters {
    action?: string;
    entity?: string;
    storeId?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
}
export declare function exportLogs(filters: ExportFilters, format: 'json' | 'csv'): Promise<string>;
//# sourceMappingURL=auditLog.service.d.ts.map