import sanitizeHtml from 'sanitize-html';
const DEFAULT_OPTIONS = {
    allowedTags: [],
    allowedAttributes: {},
};
const MESSAGE_OPTIONS = {
    allowedTags: ['b', 'i', 'em', 'strong', 'br', 'p'],
    allowedAttributes: {},
};
export function sanitize(input) {
    if (typeof input !== 'string')
        return '';
    return sanitizeHtml(input, DEFAULT_OPTIONS).trim();
}
export function sanitizeMessage(content) {
    if (typeof content !== 'string')
        return '';
    return sanitizeHtml(content, MESSAGE_OPTIONS).trim();
}
//# sourceMappingURL=sanitize.js.map