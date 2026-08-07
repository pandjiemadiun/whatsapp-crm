/**
 * Helper rentang tanggal untuk filter analytics.
 *
 * Latar belakang bug (fix 1.9.6): UI mengirim `YYYY-MM-DD` yang di-parse
 * `new Date('YYYY-MM-DD')` sebagai UTC midnight → off-by-one untuk zona
 * waktu positif (mis. WIB +7): record yang dibuat sebelum 07:00 waktu lokal
 * tidak masuk filter hari itu. Solusi: parse komponen tanggal lalu treat
 * sebagai LOCAL start/end-of-day (server timezone).
 */
/**
 * Parse `YYYY-MM-DD` sebagai local date.
 * - endOfDay=false → 00:00:00.000 hari itu (inclusive start)
 * - endOfDay=true  → 23:59:59.999 hari itu (inclusive end)
 * Fallback ke `new Date(v)` bila format tidak cocok.
 */
export declare function parseLocalDay(v: string, endOfDay: boolean): Date;
/**
 * Key tanggal harian berbasis LOCAL (server timezone) — konsisten dengan
 * parseLocalDay. Jangan pakai toISOString() (UTC) karena record malam hari
 * di zona +7 bisa berpindah ke tanggal UTC sebelumnya.
 */
export declare function localDayKey(dt: Date): string;
/** Bangun array key hari lokal dari `since` (inclusive) sepanjang `days` hari. */
export declare function buildLocalDayKeys(since: Date, days: number): string[];
//# sourceMappingURL=date-range.d.ts.map