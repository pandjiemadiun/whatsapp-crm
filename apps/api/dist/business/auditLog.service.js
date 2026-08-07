import { Prisma } from '@prisma/client';
import { prisma } from '../infrastructure/prisma.js';
export async function logAction(input) {
    await prisma.auditLog.create({
        data: {
            storeId: input.storeId,
            action: input.action,
            entity: input.entity,
            entityId: input.entityId,
            userId: input.adminId,
            changes: input.changes ?? Prisma.DbNull,
            ipAddress: input.ipAddress,
            createdAt: new Date(),
        },
    });
}
export async function searchLogs(filters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50));
    const where = {};
    if (filters.action)
        where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.entity)
        where.entity = { contains: filters.entity, mode: 'insensitive' };
    if (filters.storeId)
        where.storeId = filters.storeId;
    if (filters.userId)
        where.userId = filters.userId;
    if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate)
            where.createdAt.gte = filters.startDate;
        if (filters.endDate)
            where.createdAt.lte = filters.endDate;
    }
    const total = await prisma.auditLog.count({ where });
    const logs = await prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
    });
    return {
        logs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    };
}
export async function getLogDetail(logId) {
    const log = await prisma.auditLog.findUnique({ where: { id: logId } });
    if (!log)
        throw new Error('Log not found');
    return log;
}
export async function getLogStats(storeId) {
    const where = {};
    if (storeId)
        where.storeId = storeId;
    const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: { action: true, userId: true, createdAt: true },
    });
    const actionBreakdown = {};
    const userCount = {};
    for (const log of logs) {
        actionBreakdown[log.action] = (actionBreakdown[log.action] || 0) + 1;
        if (log.userId)
            userCount[log.userId] = (userCount[log.userId] || 0) + 1;
    }
    const topUsers = Object.entries(userCount)
        .map(([userId, count]) => ({ userId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return {
        totalActions: logs.length,
        actionBreakdown,
        lastActionAt: logs[0]?.createdAt ?? null,
        topUsers,
    };
}
export async function exportLogs(filters, format) {
    const where = {};
    if (filters.action)
        where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.entity)
        where.entity = { contains: filters.entity, mode: 'insensitive' };
    if (filters.storeId)
        where.storeId = filters.storeId;
    if (filters.userId)
        where.userId = filters.userId;
    if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate)
            where.createdAt.gte = filters.startDate;
        if (filters.endDate)
            where.createdAt.lte = filters.endDate;
    }
    const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
    });
    if (format === 'json') {
        return JSON.stringify(logs, null, 2);
    }
    // CSV export
    const headers = ['id', 'storeId', 'action', 'entity', 'entityId', 'userId', 'ipAddress', 'createdAt'];
    const rows = logs.map((l) => [
        l.id,
        l.storeId,
        l.action,
        l.entity,
        l.entityId,
        l.userId || '',
        l.ipAddress || '',
        l.createdAt.toISOString(),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return headers.join(',') + '\n' + rows.join('\n');
}
//# sourceMappingURL=auditLog.service.js.map