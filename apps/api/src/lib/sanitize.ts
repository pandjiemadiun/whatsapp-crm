import sanitizeHtml from 'sanitize-html';

const DEFAULT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
};

const MESSAGE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'br', 'p'],
  allowedAttributes: {},
};

export function sanitize(input: string): string {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, DEFAULT_OPTIONS).trim();
}

export function sanitizeMessage(content: string): string {
  if (typeof content !== 'string') return '';
  return sanitizeHtml(content, MESSAGE_OPTIONS).trim();
}
