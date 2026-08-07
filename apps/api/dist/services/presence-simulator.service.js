/**
 * Presence Simulator Service — mensimulasikan respons manusia untuk menghindari
 * pola API yang kaku.
 *
 * Fitur:
 * - 85% peluang: markRead → composing → send
 * - 15% peluang: langsung kirim (tanpa presence)
 * - Presence state random: 70% composing, 10% paused, 20% none
 * - Delay proporsional: base + (wordCount * typingSpeedPerWord)
 * - Night mode: naik delay, turunkan composing probability di luar jam operasional
 */
import { adapters } from '../adapters/container.js';
export class PresenceSimulatorService {
    /**
     * Hitung delay berdasarkan panjang pesan dan karakter customer.
     * - base + (wordCount * typing_speed)
     * - Adaptive: gunakan avgResponseTime customer jika tersedia
     * - Night mode: tingkatkan delay
     */
    calculateDelay(content, store, customer, isNightMode = false) {
        const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
        let baseDelay = PresenceSimulatorService.BASE_DELAY_MS;
        let speedPerWord = PresenceSimulatorService.TYPING_SPEED_MS_PER_WORD;
        if (isNightMode) {
            baseDelay *= PresenceSimulatorService.NIGHT_MODE_DELAY_MULTIPLIER;
            speedPerWord *= PresenceSimulatorService.NIGHT_MODE_TYPING_MULTIPLIER;
        }
        if (customer?.avgResponseTimeMs && customer.avgResponseTimeMs > 0) {
            baseDelay = customer.avgResponseTimeMs / 2;
        }
        const delay = baseDelay + wordCount * speedPerWord;
        const jitter = delay * 0.2;
        return Math.floor(delay + (Math.random() * jitter * 2 - jitter));
    }
    /** 70% composing, 10% paused, 20% none */
    getRandomPresenceState() {
        const r = Math.random();
        if (r < 0.70)
            return 'composing';
        if (r < 0.80)
            return 'paused';
        return 'none';
    }
    /** Cek apakah saat ini night mode berdasarkan timezone store */
    isNightMode(store) {
        try {
            const now = new Date();
            const localHour = this.getHoursInTimezone(now, store.timezone);
            if (store.operatingHours?.enabled && store.operatingHours?.days) {
                return this.isOutsideOperatingHours(localHour, store.operatingHours.days);
            }
            return localHour >= PresenceSimulatorService.NIGHT_START || localHour < PresenceSimulatorService.NIGHT_END;
        }
        catch {
            return false;
        }
    }
    /**
     * Simulate full response sequence.
     * 85% → markRead → composing → delay → send
     * 15% → direct send (delay reduced)
     */
    async simulateResponse(opts) {
        const isNightMode = this.isNightMode(opts.store);
        const baseDelay = this.calculateDelay(opts.content, opts.store, opts.customer, isNightMode);
        const isDirect = Math.random() < 0.15;
        const shouldMarkRead = !isDirect;
        if (isDirect) {
            return {
                delay: baseDelay * 0.3, // langsung kirim, delay kecil
                shouldMarkRead: false,
                presenceState: 'none',
                path: 'direct',
            };
        }
        const presenceState = this.getRandomPresenceState();
        if (opts.gateway?.markRead && shouldMarkRead) {
            await opts.gateway.markRead(opts.phone).catch((err) => {
                adapters.logger.warn('markRead failed', err);
            });
        }
        if (opts.gateway?.setPresence) {
            await opts.gateway.setPresence(opts.phone, presenceState).catch((err) => {
                adapters.logger.warn('setPresence failed', err);
            });
        }
        let delayMultiplier = 1;
        if (isNightMode) {
            delayMultiplier *= 1.5;
            if (presenceState !== 'composing') {
                delayMultiplier *= 2;
            }
        }
        return {
            delay: Math.floor(baseDelay * delayMultiplier),
            shouldMarkRead,
            presenceState,
            path: 'full_presence',
        };
    }
    /**
     * Hitung berapa jam "sekarang" di timezone tertentu.
     * Fallback: gunakan UTC offset dari timezone string.
     */
    getHoursInTimezone(date, tz) {
        if (tz === 'Asia/Jakarta' || tz === 'WIB') {
            return (date.getUTCHours() + 7) % 24;
        }
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                hour: 'numeric',
                hour12: false,
            });
            const parts = formatter.formatToParts(date);
            const hourPart = parts.find((p) => p.type === 'hour');
            return parseInt(hourPart?.value || '0', 10);
        }
        catch {
            return date.getUTCHours();
        }
    }
    isOutsideOperatingHours(hour, days) {
        const hariIni = new Date().toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
        const dayConfig = days[hariIni] || days[hariIni === 'monday' ? 'monday' : 'monday'];
        if (!dayConfig)
            return true;
        const [openH, openM] = dayConfig.open.split(':').map(Number);
        const [closeH, closeM] = dayConfig.close.split(':').map(Number);
        const openMinutes = openH * 60 + openM;
        const closeMinutes = closeH * 60 + closeM;
        const nowMinutes = hour * 60;
        if (openMinutes <= closeMinutes) {
            return nowMinutes < openMinutes || nowMinutes > closeMinutes;
        }
        else {
            return nowMinutes > closeMinutes && nowMinutes < openMinutes;
        }
    }
}
PresenceSimulatorService.BASE_DELAY_MS = 3000;
PresenceSimulatorService.TYPING_SPEED_MS_PER_WORD = 100;
PresenceSimulatorService.NIGHT_MODE_DELAY_MULTIPLIER = 3;
PresenceSimulatorService.NIGHT_MODE_TYPING_MULTIPLIER = 1.5;
PresenceSimulatorService.NIGHT_START = 22;
PresenceSimulatorService.NIGHT_END = 8;
export const presenceSimulatorService = new PresenceSimulatorService();
//# sourceMappingURL=presence-simulator.service.js.map