/**
 * Message Normalizer — BAGIAN 1 (compatibility re-export)
 *
 * Re-exports dari src/services/chat/normalizer.ts
 * File lama dipertahankan untuk backward compatibility dengan test lama.
 */
export {
  normalizeText,
  normalizeMessage,
  invalidateChatCatalogCache,
  TYPO_DICTIONARY,
} from './chat/normalizer.js';
