import { Request, Response, NextFunction } from 'express';
import { configService } from '../business/config.service.js';
import { adapters } from '../adapters/container.js';

export async function maintenanceModeMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip health endpoint, root, and admin config during maintenance
  if (req.path === '/api/health' || req.path === '/' || req.path.startsWith('/api/admin/config') || req.path.startsWith('/r/')) {
    return next();
  }

  try {
    const maintenanceMode = await configService.getConfig('MAINTENANCE_MODE');
    if (maintenanceMode === 'true') {
      return res.status(503).json({ error: 'Service under maintenance' });
    }
  } catch (error) {
    adapters.logger.warn('Maintenance mode check failed, allowing request', { error });
  }

  next();
}
