export interface StorePresenceInfo {
    timezone: string;
    operatingHours?: {
        enabled?: boolean;
        days?: Record<string, {
            open: string;
            close: string;
        }>;
    };
}
export interface CustomerPresenceInfo {
    avgResponseTimeMs?: number;
}
export interface PresenceSimulationResult {
    delay: number;
    shouldMarkRead: boolean;
    presenceState: 'composing' | 'paused' | 'none';
    path: 'full_presence' | 'direct';
}
export declare class PresenceSimulatorService {
    private static readonly BASE_DELAY_MS;
    private static readonly TYPING_SPEED_MS_PER_WORD;
    private static readonly NIGHT_MODE_DELAY_MULTIPLIER;
    private static readonly NIGHT_MODE_TYPING_MULTIPLIER;
    private static readonly NIGHT_START;
    private static readonly NIGHT_END;
    /**
     * Hitung delay berdasarkan panjang pesan dan karakter customer.
     * - base + (wordCount * typing_speed)
     * - Adaptive: gunakan avgResponseTime customer jika tersedia
     * - Night mode: tingkatkan delay
     */
    calculateDelay(content: string, store: StorePresenceInfo, customer?: CustomerPresenceInfo, isNightMode?: boolean): number;
    /** 70% composing, 10% paused, 20% none */
    getRandomPresenceState(): 'composing' | 'paused' | 'none';
    /** Cek apakah saat ini night mode berdasarkan timezone store */
    isNightMode(store: StorePresenceInfo): boolean;
    /**
     * Simulate full response sequence.
     * 85% → markRead → composing → delay → send
     * 15% → direct send (delay reduced)
     */
    simulateResponse(opts: {
        store: StorePresenceInfo;
        customer?: CustomerPresenceInfo;
        content: string;
        gateway?: {
            markRead?: (phone: string) => Promise<void>;
            setPresence?: (phone: string, state: 'composing' | 'paused' | 'none') => Promise<void>;
        };
        phone: string;
    }): Promise<PresenceSimulationResult>;
    /**
     * Hitung berapa jam "sekarang" di timezone tertentu.
     * Fallback: gunakan UTC offset dari timezone string.
     */
    private getHoursInTimezone;
    private isOutsideOperatingHours;
}
export declare const presenceSimulatorService: PresenceSimulatorService;
//# sourceMappingURL=presence-simulator.service.d.ts.map