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
export function parseLocalDay(v, endOfDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!m)
        return new Date(v);
    const [, y, mo, d] = m.map(Number);
    const dt = new Date(y, mo - 1, d);
    if (endOfDay)
        dt.setHours(23, 59, 59, 999);
    else
        dt.setHours(0, 0, 0, 0);
    return dt;
}
/**
 * Key tanggal harian berbasis LOCAL (server timezone) — konsisten dengan
 * parseLocalDay. Jangan pakai toISOString() (UTC) karena record malam hari
 * di zona +7 bisa berpindah ke tanggal UTC sebelumnya.
 */
export function localDayKey(dt) {
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
}
/** Bangun array key hari lokal dari `since` (inclusive) sepanjang `days` hari. */
export function buildLocalDayKeys(since, days) {
    const keys = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        keys.push(localDayKey(d));
    }
    return keys;
}
//# sourceMappingURL=date-range.js.map