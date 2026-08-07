import axios from 'axios';
import { adapters } from '../adapters/container.js';
import { IWhatsAppGateway, SendMessageConfig } from './whatsapp-gateway.interface.js';

const FONNTE_BASE_URL = 'https://api.fonnte.com';
const DEVICE_CACHE_TTL_MS = 60_000; // ping Fonnte max 1x per menit

interface DeviceStatus {
  connected: boolean;
  status: string;
  phoneNumber?: string;
  error?: string;
  checkedAt: number;
}

const deviceStatusCache = new Map<string, DeviceStatus>();

export class FonnteService implements IWhatsAppGateway {
  /** Cek status device Fonnte — real ping, bukan cuma token !== null */
  async getDeviceStatus(token: string): Promise<DeviceStatus> {
    const cached = deviceStatusCache.get(token);
    if (cached && Date.now() - cached.checkedAt < DEVICE_CACHE_TTL_MS) {
      return cached;
    }

    try {
      const response = await axios.post(
        `${FONNTE_BASE_URL}/device`,
        {},
        { headers: { 'Authorization': token, 'Content-Type': 'application/json' } }
      );

      const data = response.data;
      const status: DeviceStatus = {
        connected: data?.status === true,
        status: data?.status === true ? 'connected' : 'disconnected',
        phoneNumber: data?.device || data?.wa_number || data?.phone || undefined,
        error: data?.status === false ? (data?.reason || 'Device disconnected or token invalid') : undefined,
        checkedAt: Date.now(),
      };
      deviceStatusCache.set(token, status);
      return status;
    } catch (error: any) {
      const status: DeviceStatus = {
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
  invalidateDeviceCache(token: string): void {
    deviceStatusCache.delete(token);
  }

  async sendImage(phone: string, imageUrl: string, caption?: string, token?: string): Promise<any> {
    if (!token) {
      throw new Error('sendImage requires token — use sendImageWithToken, or pass token as 4th argument');
    }
    return this.sendImageWithToken(phone, imageUrl, token, caption);
  }

  /** Send image via Fonnte URL parameter (used by MessageProcessor with store token) */
  async sendImageWithToken(phone: string, imageUrl: string, token: string, caption?: string): Promise<any> {
    const payload: Record<string, any> = {
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

  async sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any> {
    if (!config?.token) {
      throw new Error('Fonnte token is required. Pass it via config.token.');
    }

    // Tambahkan custom footer atau brand Anda (opsional)
    const customFooter = '\n\n---\n*Powered by Garuda CRM*';
    const messageWithFooter = text + customFooter;

    const payload: Record<string, any> = {
      target: String(phone),
      message: messageWithFooter,
      typing: config.typing ?? false,
      // Ini parameter Fonnte untuk disable branding
      nostyle: true,  // Disable Fonnte branding jika supported
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
    } catch (error: any) {
      adapters.logger.error('Fonnte send failed', error as Error);
      throw new Error(error?.response?.data?.reason || error.message || 'Fonnte send failed');
    }
  }

  async validateToken(token: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${FONNTE_BASE_URL}/device`,
        {},
        {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data?.status === true;
    } catch (error: any) {
      adapters.logger.error('Fonnte token validation failed', error as Error);
      return false;
    }
  }
}

export const fonnteService = new FonnteService();
