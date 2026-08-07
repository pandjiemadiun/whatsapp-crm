import logger from '../utils/logger.js';
export function validateRequest(schema, source = 'body') {
    return (req, res, next) => {
        const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
        const result = schema.safeParse(data);
        if (!result.success) {
            logger.warn(`Validation error on ${req.path}`, {
                source,
                errors: result.error.issues.map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
            res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
                timestamp: new Date().toISOString(),
            });
            return;
        }
        req.validated = result.data;
        next();
    };
}
// Helper to cast validated data in route handlers
export function getValidated(req) {
    return req.validated;
}
//# sourceMappingURL=validate-request.js.map