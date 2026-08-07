/**
 * Normalize phone number to international format (62xxx).
 * Handles: 08xxx, +628xxx, 628xxx, 08xxx-xxxx, etc.
 */
export function normalizePhone(phone) {
    if (!phone)
        return '';
    // Strip all non-digit characters except leading +
    let cleaned = phone.replace(/[^\d+]/g, '');
    // +628xxx → 628xxx
    if (cleaned.startsWith('+62')) {
        return cleaned.slice(1);
    }
    // 08xxx → 628xxx
    if (cleaned.startsWith('0')) {
        return '62' + cleaned.slice(1);
    }
    // Already 628xxx
    if (cleaned.startsWith('62')) {
        return cleaned;
    }
    // Other (e.g. just 8xxxx) — assume Indonesia, prepend 62
    return '62' + cleaned;
}
//# sourceMappingURL=normalize-phone.js.map