import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
export declare class RealtimeService {
    private io;
    private readonly wsPath;
    private onlineByStore;
    private customerPresence;
    constructor(wsPath?: string);
    /** Mount Socket.IO pada http.Server yang SAMA yang melayani Express (pm2). */
    init(httpServer: http.Server, corsOrigins: string[]): SocketIOServer;
    shutdown(): void;
    /** Apakah ada customer online (untuk FASE 4 notification service). */
    isStoreOnline(storeId: string): boolean;
    private presenceKey;
    /**
     * FASE 4 — authoritative online signal for push eligibility (single-VPS MVP).
     * true  = ada >= 1 active authenticated customer Web Socket untuk conversation ini.
     * false = tidak ada active customer socket untuk conversation ini.
     * Tenant-isolated: lookup memakai storeId + conversationId (store A cannot
     * read presence of store B's conversation).
     */
    isCustomerConversationOnline(storeId: string, conversationId: string): boolean;
    private authGuard;
    private onConnection;
    private dispatch;
}
export declare const realtimeService: RealtimeService;
//# sourceMappingURL=realtime.service.d.ts.map