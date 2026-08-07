import { IWhatsAppGateway, SendMessageConfig } from '../../services/whatsapp-gateway.interface.js';
export declare class GOWAAdapter implements IWhatsAppGateway {
    private config;
    reconfigure(): Promise<void>;
    private ensureConfig;
    isConfigured(): boolean;
    private basicAuthHeader;
    sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any>;
    validateToken(_token: string): Promise<boolean>;
    /** GOWA: mark message as read */
    markRead(phone: string, deviceId?: string): Promise<void>;
    /** GOWA: set presence state (composing/paused) */
    setPresence(phone: string, state: 'composing' | 'paused' | 'none', deviceId?: string): Promise<void>;
}
export declare const gowaAdapter: GOWAAdapter;
//# sourceMappingURL=gowa.adapter.d.ts.map