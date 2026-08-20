import { configService } from '../../business/config.service.js';
import { normalizePhone } from '../../lib/normalize-phone.js';
export class GOWAAdapter {
    constructor() {
        this.config = null;
    }
    /** Lazy dynamic import container (putus cycle import container↔adapter, FIX-5). */
    async getAdapters() {
        const { adapters } = await import('../container.js');
        return adapters;
    }
    async reconfigure() {
        const [baseUrl, username, password] = await Promise.all([
            configService.getConfig('GOWA_API_URL'),
            configService.getConfig('GOWA_BASIC_AUTH_USER'),
            configService.getConfig('GOWA_BASIC_AUTH_PASS'),
        ]);
        this.config = {
            baseUrl: baseUrl || process.env.GOWA_API_URL || 'http://localhost:3001',
            username: username || process.env.GOWA_BASIC_AUTH_USER || 'admin',
            password: password || process.env.GOWA_BASIC_AUTH_PASS || '',
        };
    }
    async ensureConfig() {
        if (!this.config) {
            await this.reconfigure();
        }
        return this.config;
    }
    isConfigured() {
        return !!this.config && !!this.config.baseUrl && !!this.config.username && !!this.config.password;
    }
    async basicAuthHeader() {
        const cfg = await this.ensureConfig();
        return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    }
    async sendMessage(phone, text, config) {
        await this.ensureConfig();
        if (!this.isConfigured()) {
            (await this.getAdapters()).logger.warn('GOWA not configured, skipping send', { phone });
            throw new Error('GOWA not configured');
        }
        const deviceId = config?.deviceId || config?.token || '';
        const normalizedPhone = normalizePhone(phone);
        try {
            (await this.getAdapters()).logger.info('Sending GOWA message', { phone, textLength: text.length, deviceId });
            const response = await fetch(`${this.config.baseUrl}/send/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': await this.basicAuthHeader(),
                    ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
                },
                body: JSON.stringify({
                    phone: normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@s.whatsapp.net`,
                    message: text,
                }),
            });
            if (!response.ok) {
                const errorBody = await response.text();
                (await this.getAdapters()).logger.error('GOWA send failed', undefined, { status: response.status, body: errorBody });
                throw new Error(`GOWA HTTP ${response.status}: ${errorBody}`);
            }
            const data = await response.json();
            (await this.getAdapters()).logger.info('GOWA message sent successfully', { phone });
            return data;
        }
        catch (error) {
            (await this.getAdapters()).logger.error('GOWA send error', error);
            throw error;
        }
    }
    async validateToken(_token) {
        await this.ensureConfig();
        return this.isConfigured();
    }
    /** GOWA: mark message as read */
    async markRead(phone, deviceId) {
        await this.ensureConfig();
        if (!this.isConfigured())
            return;
        const normalizedPhone = normalizePhone(phone);
        const payload = {
            phone: normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@s.whatsapp.net`,
        };
        if (deviceId)
            payload.deviceId = deviceId;
        try {
            const response = await fetch(`${this.config.baseUrl}/message/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': await this.basicAuthHeader(),
                    ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
                },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                (await this.getAdapters()).logger.debug('GOWA markRead sent', { phone });
            }
        }
        catch (error) {
            (await this.getAdapters()).logger.error('GOWA markRead failed', error, { phone });
        }
    }
    /** GOWA: set presence state (composing/paused) */
    async setPresence(phone, state, deviceId) {
        await this.ensureConfig();
        if (!this.isConfigured())
            return;
        const normalizedPhone = normalizePhone(phone);
        const payload = {
            phone: normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@s.whatsapp.net`,
            presence: state,
        };
        if (deviceId)
            payload.deviceId = deviceId;
        try {
            const response = await fetch(`${this.config.baseUrl}/message/presence`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': await this.basicAuthHeader(),
                    ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
                },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                (await this.getAdapters()).logger.debug('GOWA setPresence sent', { phone, state });
            }
        }
        catch (error) {
            (await this.getAdapters()).logger.error('GOWA setPresence failed', error, { phone });
        }
    }
}
export const gowaAdapter = new GOWAAdapter();
//# sourceMappingURL=gowa.adapter.js.map