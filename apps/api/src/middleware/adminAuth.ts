import { Request, Response, NextFunction } from 'express';
import { adapters } from '../adapters/container.js';
import { prisma } from '../infrastructure/prisma.js';

export interface AuthenticatedAdminRequest extends Request {
  admin?: { adminId: string; email: string; role: string };
}

export async function adminAuthMiddleware(req: AuthenticatedAdminRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const tokenRecord = await prisma.adminAuthToken.findUnique({
      where: { token },
      include: { adminUser: true },
    });

    if (!tokenRecord) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check revoked
    if (tokenRecord.revokedAt) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Check expiry
    if (new Date(tokenRecord.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Token expired, please login again' });
    }

    // Check admin user active & not deleted
    const admin = tokenRecord.adminUser;
    if (!admin.isActive || admin.deletedAt) {
      return res.status(401).json({ error: 'Account suspended or inactive' });
    }

    req.admin = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    };

    next();
  } catch (error) {
    adapters.logger.error('Admin auth middleware error', error as Error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}
