import crypto from 'crypto';
export function requestIdMiddleware(req, _res, next) {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID().slice(0, 12);
    _res.setHeader('x-request-id', req.requestId);
    next();
}
//# sourceMappingURL=requestId.js.map