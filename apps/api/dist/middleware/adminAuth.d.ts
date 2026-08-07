import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedAdminRequest extends Request {
    admin?: {
        adminId: string;
        email: string;
        role: string;
    };
}
export declare function adminAuthMiddleware(req: AuthenticatedAdminRequest, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=adminAuth.d.ts.map