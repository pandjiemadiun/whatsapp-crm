import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.NODE_ENV !== 'production';
const sensitivePatterns = [
    /password[=:]\s*["']?[^"'\s&]+/gi,
    /token[=:]\s*["']?[^"'\s&]+/gi,
    /secret[=:]\s*["']?[^"'\s&]+/gi,
    /api.?key[=:]\s*["']?[^"'\s&]+/gi,
    /authorization[=:]\s*[^"'\s&]+/gi,
    /credit.?card[=:]\s*["']?[\d\s-]+/gi,
    /bearer\s+[a-zA-Z0-9._-]+/gi,
];
export function maskSensitiveData(data) {
    if (typeof data === 'string') {
        let masked = data.slice(0, 2048);
        for (const pattern of sensitivePatterns) {
            masked = masked.replace(pattern, (match) => {
                const eqIdx = match.indexOf('=') > 0 ? match.indexOf('=') : match.indexOf(':');
                if (eqIdx > 0)
                    return match.slice(0, eqIdx + 1) + '***';
                return '***';
            });
        }
        return masked;
    }
    if (data && typeof data === 'object') {
        const obj = { ...data };
        const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization', 'creditCard'];
        for (const key of sensitiveKeys) {
            if (key in obj)
                obj[key] = '***';
        }
        return obj;
    }
    return data;
}
const logger = winston.createLogger({
    level: isDev ? 'debug' : 'info',
    format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), winston.format.errors({ stack: isDev }), winston.format((info) => {
        info.env = process.env.NODE_ENV || 'development';
        if (info.message && typeof info.message === 'string') {
            info.message = maskSensitiveData(info.message);
        }
        return info;
    })(), winston.format.json()),
    defaultMeta: { service: 'garuda-api' },
    transports: [
        new winston.transports.Console({
            format: isDev
                ? winston.format.combine(winston.format.colorize(), winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length > 2 ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${level}] ${message}${metaStr}`;
                }))
                : undefined,
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/error.log'),
            level: 'error',
            maxsize: 100 * 1024 * 1024,
            maxFiles: 7,
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/combined.log'),
            maxsize: 100 * 1024 * 1024,
            maxFiles: 7,
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({ filename: path.join(__dirname, '../../logs/exceptions.log') }),
    ],
});
export default logger;
//# sourceMappingURL=logger.js.map