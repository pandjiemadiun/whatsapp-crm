export interface WhatsAppConnectionStatus {
    connected: boolean;
    gateway: 'fonnte' | 'gowa' | null;
    phoneNumber: string | null;
    lastCheckedAt: string;
}
/**
 * SATU SUMBER KEBENARAN untuk WhatsApp connection status.
 * Cek Fonnte token dulu → jika valid, connected via fonnte.
 * Jika tidak, cek GOWA device → jika terhubung, connected via gowa.
 */
export declare function getWhatsAppConnectionStatus(storeId: string): Promise<WhatsAppConnectionStatus>;
//# sourceMappingURL=whatsapp-connection.service.d.ts.map