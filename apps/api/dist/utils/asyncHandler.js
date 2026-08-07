/**
 * asyncHandler — Wraps async route handlers so errors are forwarded to next().
 * No more try/catch boilerplate in route handlers.
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
//# sourceMappingURL=asyncHandler.js.map