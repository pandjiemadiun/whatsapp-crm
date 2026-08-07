import { IWhatsAppGateway, SendMessageConfig } from './whatsapp-gateway.interface.js';
interface DeviceStatus {
    connected: boolean;
    status: string;
    phoneNumber?: string;
    error?: string;
    checkedAt: number;
}
export declare class FonnteService implements IWhatsAppGateway {
    /** Cek status device Fonnte — real ping, bukan cuma token !== null */
    getDeviceStatus(token: string): Promise<DeviceStatus>;
    /** Clear status cache (dipakai saat token di-update) */
    invalidateDeviceCache(token: string): void;
    sendImage(phone: string, imageUrl: string, caption?: string, token?: string): Promise<any>;
    /** Send image via Fonnte URL parameter (used by MessageProcessor with store token) */
    sendImageWithToken(phone: string, imageUrl: string, token: string, caption?: string): Promise<any>;
    sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any>;
    validateToken(token: string): Promise<boolean>;
}
export declare const fonnteService: FonnteService;
export {};
//# sourceMappingURL=fonnte.service.d.ts.map