/**
 * seed-ai-providers-from-env.mts
 * =============================================================================
 * LLM Provider Abstraction — Unit 1 prep script.
 *
 * ONE-OFF ONLY. NOT auto-run. NOT executed during Unit 1 (scope = schema +
 * migration only — see task). Run manually at Unit 3 cutover:
 *
 *   npx tsx --env-file=../../.env apps/api/scripts/seed-ai-providers-from-env.mts
 *
 * Purpose: migrate the CURRENT provider credentials from the old config surface
 * (system_settings GROQ_API_KEYS / GEMINI_API_KEY, read the same way
 * container.ts:91-95 reads them today) into new AIProviderConfig rows, mirroring
 * the llm-gateway.ts:70-74 defaults:
 *
 *   - Gemini -> role='chat_primary'   (primary speaker)
 *   - Groq   -> role='chat_fallback' + role='chat_gatekeeper' (fallback speaker +
 *               intent-extraction gatekeeper)
 *
 * apiKey is stored AES-256-GCM encrypted via encryptField() (apps/api/src/utils/
 * encryption.ts), with the key resolved through getEncryptionKey() which itself
 * lives in that same encryption module (FIELD_ENCRYPTION_KEY from
 * system_settings -> Cloudflare Worker -> env). This is the project's existing
 * field-encryption pattern (same one used for PII such as phoneNumber in the
 * Prisma `$use` middleware at apps/api/src/infrastructure/prisma.ts).
 *
 * Idempotent: matches by `name` (there is no unique constraint on name by design)
 * and upserts — updates apiKey + config when a row exists, inserts otherwise.
 */
import { prisma } from '../src/infrastructure/prisma.js';
import { configService } from '../src/business/config.service.js';
import { encryptField, getEncryptionKey } from '../src/utils/encryption.js';

// Endpoint/format values the adapters expect today (see groq.adapter.ts:12,
// gemini.adapter.ts:11). baseUrl is the "base" the Unit-3 adapter fills model +
// key into per `format`.
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Mirror current ai-config.ts FALLBACKS (ai-config.ts:14-26) so seeded rows are
// a faithful migration of the existing defaults, not a new policy decision.
const GROQ_MODEL_FALLBACK = 'openai/gpt-oss-120b';
const GEMINI_MODEL_FALLBACK = 'gemini-2.0-flash';

function splitKeys(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

interface UpsertParams {
  name: string;
  format: string;
  baseUrl: string;
  apiKeyPlain: string;
  model: string;
  role: string;
  priority: number;
}

async function upsertProvider(params: UpsertParams): Promise<boolean> {
  const { name, format, baseUrl, apiKeyPlain, model, role, priority } = params;

  // No DB unique on `name`; dedupe on the most-recent row with the same name.
  const existing = await prisma.aIProviderConfig.findFirst({
    where: { name },
    orderBy: { createdAt: 'desc' },
  });

  const key = await getEncryptionKey();
  if (!key) {
    throw new Error(
      `[seed] No FIELD_ENCRYPTION_KEY available — refusing to write apiKey for "${name}" in plaintext.`,
    );
  }
  const encrypted = encryptField(apiKeyPlain, key);
  if (!encrypted) {
    throw new Error(`[seed] Failed to encrypt apiKey for provider "${name}"`);
  }

  const data = {
    name,
    format,
    baseUrl,
    apiKey: encrypted,
    model,
    role,
    priority,
    isActive: true,
  };

  if (existing) {
    await prisma.aIProviderConfig.update({ where: { id: existing.id }, data });
    console.log(`[seed] updated ${name} (id=${existing.id}, role=${role})`);
  } else {
    await prisma.aIProviderConfig.create({ data });
    console.log(`[seed] created ${name} (role=${role}, format=${format})`);
  }
  return true;
}

async function main(): Promise<void> {
  // Read sources exactly like container.ts:91-95 (DB-first, env fallback).
  const groqKeysRaw = await configService.getConfig('GROQ_API_KEYS');
  const groqKeys = splitKeys(groqKeysRaw);
  const geminiKey = await configService.getConfig('GEMINI_API_KEY');

  let created = 0;

  // --- Groq: one chat_fallback row per key (priority chain) + one gatekeeper ---
  if (groqKeys.length > 0) {
    for (let i = 0; i < groqKeys.length; i++) {
      await upsertProvider({
        name: `Groq (fallback ${i + 1})`,
        format: 'openai_compatible',
        baseUrl: GROQ_BASE_URL,
        apiKeyPlain: groqKeys[i],
        model: GROQ_MODEL_FALLBACK,
        role: 'chat_fallback',
        priority: groqKeys.length - i, // first env key = highest priority
      });
      created++;
    }
    await upsertProvider({
      name: 'Groq (gatekeeper)',
      format: 'openai_compatible',
      baseUrl: GROQ_BASE_URL,
      apiKeyPlain: groqKeys[0],
      model: GROQ_MODEL_FALLBACK,
      role: 'chat_gatekeeper',
      priority: 1,
    });
    created++;
  } else {
    console.warn('[seed] No GROQ_API_KEYS found in system_settings/env — skipping Groq rows');
  }

  // --- Gemini: single chat_primary row ---
  if (geminiKey) {
    await upsertProvider({
      name: 'Gemini (primary)',
      format: 'gemini_native',
      baseUrl: GEMINI_BASE_URL,
      apiKeyPlain: geminiKey,
      model: GEMINI_MODEL_FALLBACK,
      role: 'chat_primary',
      priority: 1,
    });
    created++;
  } else {
    console.warn('[seed] No GEMINI_API_KEY found in system_settings/env — skipping Gemini row');
  }

  console.log(`[seed] done. rows upserted: ${created}`);
}

main()
  .catch((e) => {
    console.error('[seed] FAILED:', (e as Error).message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
