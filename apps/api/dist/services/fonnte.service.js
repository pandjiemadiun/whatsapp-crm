import axios from 'axios';
import { adapters } from '../adapters/container.js';
const FONNTE_BASE_URL = 'https://api.fonnte.com';
const DEVICE_CACHE_TTL_MS = 60000; // ping Fonnte max 1x per menit
const deviceStatusCache = new Map();
export class FonnteService {
    /** Cek status device Fonnte — real ping, bukan cuma token !== null */
    async getDeviceStatus(token) {
        const cached = deviceStatusCache.get(token);
        if (cached && Date.now() - cached.checkedAt < DEVICE_CACHE_TTL_MS) {
            return cached;
        }
        try {
            const response = await axios.post(`${FONNTE_BASE_URL}/device`, {}, { headers: { 'Authorization': token, 'Content-Type': 'application/json' } });
            const data = response.data;
            const status = {
                connected: data?.status === true,
                status: data?.status === true ? 'connected' : 'disconnected',
                phoneNumber: data?.device || data?.wa_number || data?.phone || undefined,
                error: data?.status === false ? (data?.reason || 'Device disconnected or token invalid') : undefined,
                checkedAt: Date.now(),
            };
            deviceStatusCache.set(token, status);
            return status;
        }
        catch (error) {
            const status = {
                connected: false,
                status: 'error',
                error: error?.response?.data?.reason || error.message || 'Fonnte API unreachable',
                checkedAt: Date.now(),
            };
            deviceStatusCache.set(token, status);
            return status;
        }
    }
    /** Clear status cache (dipakai saat token di-update) */
    invalidateDeviceCache(token) {
        deviceStatusCache.delete(token);
    }
    async sendImage(phone, imageUrl, caption, token) {
        if (!token) {
            throw new Error('sendImage requires token — use sendImageWithToken, or pass token as 4th argument');
        }
        return this.sendImageWithToken(phone, imageUrl, token, caption);
    }
    /** Send image via Fonnte URL parameter (used by MessageProcessor with store token) */
    async sendImageWithToken(phone, imageUrl, token, caption) {
        const payload = {
            target: String(phone),
            message: caption || '',
            url: imageUrl,
        };
        adapters.logger.info('Sending Fonnte image', { target: phone, imageUrl: imageUrl.substring(0, 50) });
        const response = await axios.post(`${FONNTE_BASE_URL}/send`, payload, {
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        });
        if (response.data?.status === false) {
            const reason = response.data?.reason || 'Unknown error';
            adapters.logger.warn('Fonnte image send returned failure', { reason });
            throw new Error(`Fonnte sendImage failed: ${reason}`);
        }
        return response.data;
    }
    async sendMessage(phone, text, config) {
        if (!config?.token) {
            throw new Error('Fonnte token is required. Pass it via config.token.');
        }
        // Tambahkan custom footer atau brand Anda (opsional)
        const customFooter = '\n\n---\n*Powered by Garuda CRM*';
        const messageWithFooter = text + customFooter;
        const payload = {
            target: String(phone),
            message: messageWithFooter,
            typing: config.typing ?? false,
            // Ini parameter Fonnte untuk disable branding
            nostyle: true, // Disable Fonnte branding jika supported
        };
        if (config.inboxid !== undefined) {
            payload.inboxid = config.inboxid;
        }
        try {
            adapters.logger.info('Sending Fonnte message', { target: phone });
            const response = await axios.post(`${FONNTE_BASE_URL}/send`, payload, {
                headers: {
                    'Authorization': config.token,
                    'Content-Type': 'application/json',
                },
            });
            if (response.data?.status === false) {
                adapters.logger.warn('Fonnte API returned failure', { reason: response.data.reason });
            }
            return response.data;
        }
        catch (error) {
            adapters.logger.error('Fonnte send failed', error);
            throw new Error(error?.response?.data?.reason || error.message || 'Fonnte send failed');
        }
    }
    async validateToken(token) {
        try {
            const response = await axios.post(`${FONNTE_BASE_URL}/device`, {}, {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json',
                },
            });
            return response.data?.status === true;
        }
        catch (error) {
            adapters.logger.error('Fonnte token validation failed', error);
            return false;
        }
    }
}
export const fonnteService = new FonnteService();
//# sourceMappingURL=fonnte.service.js.map