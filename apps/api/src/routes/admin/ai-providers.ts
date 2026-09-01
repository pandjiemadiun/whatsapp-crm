/**
 * /api/admin/ai-providers — Admin CRUD + test-connection for AIProviderConfig.
 *
 * Mount (index.ts):
 *   app.use('/api/admin/ai-providers', adminAuthMiddleware, requireAdminRole(['super_admin']), adminAiProvidersRoutes);
 *
 * Security:
 *  - requireAdminRole(['super_admin']) applied to ALL routes via router.use —
 *    this data controls which LLM the entire platform routes customer chat
 *    through, so it's treated as destructive-tier (mirrors engine.ts POST).
 *  - apiKey is NEVER returned raw/decrypted to the frontend:
 *      * GET / masks to last-4 chars (maskKey)
 *      * test-connection returns {modelUsed, sampleResponse, ...} — never the
 *        credential itself (and the error path surfaces category/message/status
 *        only, not the key).
 *  - `apiKey` is encrypted/decrypted transparently by the Prisma `$use`
 *    middleware in infrastructure/prisma.ts (SENSITIVE_FIELDS: AIProviderConfig.apiKey),
 *    so a findUnique/findMany here yields the PLAINTEXT key in memory only.
 *
 * DELETE guard (owner question — deliberated, not silently decided):
 *  - DELETE /:id is intentionally permissive: no "last active provider for a
 *    role" guard. isActive + priority ordering is the admin's responsibility.
 *  - Rationale: a hard guard would block legitimate cleanup/migration flows
 *    (admin may be rotating away from a role). The resolver (Unit 3a) already
 *    fails-loud on empty lists; the gateway (Unit 3b) warns + falls back to the
 *    default singleton when a role has no active providers — so a missing role
 *    surfaces as a logged warn, not a silent outage. A "protect the last active
 *    chat_primary/chat_fallback" guard is deferred (cheap: pre-delete read + 409)
 *    and flagged here as future work.
 *
 * Test-connection design (owner question — reported):
 *  - POST /test-connection     -> test DRAFT (format/baseUrl/apiKey/model) BEFORE saving.
 *                                 No DB write; no lastTestedAt update (unsaved).
 *  - POST /:id/test-connection -> test a SAVED provider (key decrypted by middleware).
 *                                 Updates lastTestedAt/lastTestResult on the row
 *                                 (success => 'ok'; failure => '<CATEGORY>:msg' so the
 *                                 table shows why it last failed).
 *  Both return the SAME {success, latencyMs, modelUsed, sampleResponse | errorCategory,
 *  errorMessage, statusCode} shape, surfacing the ACTUAL provider error message
 *  (HTTP status / category / provider error body) — never a generic boolean.
 *
 * The handlers are exported as RAW async functions (so tests can invoke them
 * directly without asyncHandler swallowing errors); route registration wraps
 * them in asyncHandler (mirrors routes/admin/config.ts).
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../infrastructure/prisma.js';
import { adapters } from '../../adapters/container.js';
import { OpenAICompatibleAdapter } from '../../adapters/ai/openai-compatible.adapter.js';
import { GeminiShimAdapter } from '../../adapters/ai/gemini-shim.adapter.js';
import {
  AIProvider,
  AIProviderError,
  ErrorCategory,
  type AIResponse,
} from '../../adapters/ai/types.js';
import { requireAdminRole } from '../../middleware/adminAuthGuard.js';
import { AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateRequest, getValidated } from '../../middleware/validate-request.js';

const router = Router();
// Destructive-tier: controls the platform-wide LLM. super_admin only.
router.use(requireAdminRole(['super_admin']));

// ─── Schemas ─────────────────────────────────────────────────────────

/** Must match schema.prisma AIProviderConfig.format + the resolver's format dispatch. */
export const providerFormatSchema = z.enum(['openai_compatible', 'gemini_native']);
/** Must match schema.prisma AIProviderConfig.role. */
export const providerRoleSchema = z.enum([
  'chat_primary',
  'chat_fallback',
  'chat_gatekeeper',
  'wizard',
  'other',
]);

export const createProviderSchema = z.object({
  name: z.string().min(1, 'name is required'),
  format: providerFormatSchema,
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  apiKey: z.string().min(1, 'apiKey is required'),
  model: z.string().min(1, 'model is required'),
  role: providerRoleSchema,
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  format: providerFormatSchema.optional(),
  baseUrl: z.string().url().optional(),
  /** Blank/omitted => keep existing key (do NOT overwrite/clear). */
  apiKey: z.string().optional(),
  model: z.string().optional(),
  role: providerRoleSchema.optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const testConnectionSchema = z.object({
  format: providerFormatSchema,
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  apiKey: z.string().min(1, 'apiKey is required'),
  model: z.string().min(1, 'model is required'),
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionSchema>;

export interface ConnectionResult {
  success: boolean;
  latencyMs: number;
  modelUsed?: string;
  sampleResponse?: string;
  /** ErrorCategory value (e.g. 'AUTH_ERROR', 'NETWORK_TIMEOUT'). Undefined on success. */
  errorCategory?: string;
  /** Specific provider error message — NOT a generic "connection failed". */
  errorMessage?: string;
  statusCode?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Mask an API key to last-4 chars. NEVER returns the raw credential.
 * - null/undefined/empty => null
 * - "sk-abc123456"        => "******3456"
 * Used in every read path (GET /, create/update/test-connection responses).
 */
export function maskKey(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  const last4 = apiKey.slice(-4);
  const maskLen = Math.max(apiKey.length - 4, 4);
  return '*'.repeat(maskLen) + last4;
}

/**
 * Build a parameterized adapter from config (Unit 2 adapters).
 * Throws on unknown format — fail-loud (mirrors the resolver invariant: bad
 * format must never reach the provider call). The route validates format via
 * zod before this runs; this is a defensive backstop.
 */
export function buildAdapter(config: {
  format: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  name?: string;
  timeoutMs?: number;
}): AIProvider {
  const name = config.name ?? `ai-provider-${config.format}`;
  const timeoutMs = config.timeoutMs ?? 8000;
  if (config.format === 'gemini_native') {
    return new GeminiShimAdapter({
      baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, name, timeoutMs,
    });
  }
  if (config.format === 'openai_compatible') {
    return new OpenAICompatibleAdapter({
      baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, name, timeoutMs,
    });
  }
  throw new Error(
    `Unknown AIProviderConfig format: '${config.format}' ` +
      `(expected 'openai_compatible' | 'gemini_native') — ` +
      `resolver fail-loud invariant: bad format must never reach the DB.`,
  );
}

const TEST_PROMPT = 'Reply with the single word: OK';
const TEST_TIMEOUT_MS = 8000;

/** Run a single generate() against the provider; surface the ACTUAL provider error. */
async function probeProvider(config: {
  format: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  name?: string;
}): Promise<ConnectionResult> {
  const start = Date.now();
  let adapter: AIProvider;
  try {
    adapter = buildAdapter({ ...config, timeoutMs: TEST_TIMEOUT_MS });
  } catch (e) {
    return { success: false, latencyMs: 0, errorCategory: ErrorCategory.VALIDATION_ERROR, errorMessage: (e as Error).message };
  }

  try {
    const sample: AIResponse = await adapter.generate(TEST_PROMPT);
    // Response contains NO credential: only model + content + timing.
    return {
      success: true,
      latencyMs: Date.now() - start,
      modelUsed: sample.model,
      sampleResponse: sample.content,
    };
  } catch (e) {
    const latencyMs = Date.now() - start;
    if (e instanceof AIProviderError) {
      // Adapters already categorize HTTP errors (401/403=>AUTH_ERROR, 400=>VALIDATION_ERROR,
      // 429=>RATE_LIMIT, 5xx=>SERVER_ERROR) and AbortError=>NETWORK_TIMEOUT — surface verbatim.
      return { success: false, latencyMs, errorCategory: e.category, errorMessage: e.message, statusCode: e.statusCode };
    }
    if (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))) {
      return { success: false, latencyMs, errorCategory: ErrorCategory.NETWORK_TIMEOUT, errorMessage: `Request aborted/timed out after ${TEST_TIMEOUT_MS}ms` };
    }
    return { success: false, latencyMs, errorCategory: ErrorCategory.UNKNOWN, errorMessage: e instanceof Error ? e.message : String(e) };
  }
}

/** Strip to masked shape + scalar fields. apiKey is masked here, never raw. */
function maskProviderRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    baseUrl: row.baseUrl,
    apiKey: maskKey(row.apiKey),
    model: row.model,
    role: row.role,
    priority: row.priority,
    isActive: row.isActive,
    lastTestedAt: row.lastTestedAt,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Raw handlers (exported for direct test invocation; wrapped in asyncHandler
//     at route registration — mirrors routes/admin/config.ts) ──────────

export const listProviders = async (req: AuthenticatedAdminRequest, res: Response) => {
  const rows = await prisma.aIProviderConfig.findMany({
    orderBy: [{ role: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
  });
  res.json({ success: true, data: rows.map(maskProviderRow) });
};

export const createProvider = async (req: AuthenticatedAdminRequest, res: Response) => {
  const input = getValidated<CreateProviderInput>(req);
  const created = await prisma.aIProviderConfig.create({ data: input });
  adapters.logger.info('AIProviderConfig created', { name: input.name, format: input.format, role: input.role });
  res.status(201).json({ success: true, data: maskProviderRow(created) });
};

export const updateProvider = async (req: AuthenticatedAdminRequest, res: Response) => {
  const { id } = req.params;
  const input = getValidated<UpdateProviderInput>(req);

  const existing = await prisma.aIProviderConfig.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Provider not found' });

  // "Leave blank to keep current": omit apiKey from the update payload so
  // the existing ciphertext is NOT overwritten/re-cleared. A non-empty apiKey
  // (re-typed) is included and the Prisma middleware re-encrypts it on update.
  const { apiKey, ...rest } = input;
  const data: UpdateProviderInput = { ...rest };
  if (apiKey !== undefined && apiKey !== null && String(apiKey).trim()) {
    data.apiKey = apiKey;
  }

  const updated = await prisma.aIProviderConfig.update({ where: { id }, data });
  res.json({ success: true, data: maskProviderRow(updated) });
};

export const deleteProvider = async (req: AuthenticatedAdminRequest, res: Response) => {
  const { id } = req.params;
  const existing = await prisma.aIProviderConfig.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Provider not found' });
  await prisma.aIProviderConfig.delete({ where: { id } });
  adapters.logger.warn('AIProviderConfig deleted', {
    id, name: existing.name, format: existing.format, role: existing.role,
  });
  res.json({ success: true, message: `Provider '${existing.name}' (${existing.format}/${existing.role}) deleted` });
};

export const testConnectionById = async (req: AuthenticatedAdminRequest, res: Response) => {
  const { id } = req.params;
  // findUnique → Prisma middleware decrypts apiKey into row.apiKey (in-memory only).
  const row = await prisma.aIProviderConfig.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: 'Provider not found' });

  const result = await probeProvider({
    format: row.format, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model, name: row.name,
  });

  await prisma.aIProviderConfig.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastTestResult: result.success ? 'ok' : `${result.errorCategory ?? 'UNKNOWN'}:${result.errorMessage ?? ''}`,
    },
  });

  // result contains NO apiKey (probeProvider returns modelUsed/sampleResponse/error only).
  res.json({ success: true, data: result });
};

export const testConnectionDraft = async (req: AuthenticatedAdminRequest, res: Response) => {
  const input = getValidated<TestConnectionInput>(req);
  const result = await probeProvider({
    format: input.format, baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model,
  });
  res.json({ success: true, data: result });
};

// ─── Router composition (order matters: /test-connection before /:id/test-connection) ──

router.get('/', asyncHandler(listProviders));
router.post('/', validateRequest(createProviderSchema, 'body'), asyncHandler(createProvider));
router.put('/:id', validateRequest(updateProviderSchema, 'body'), asyncHandler(updateProvider));
router.delete('/:id', asyncHandler(deleteProvider));
router.post('/test-connection', validateRequest(testConnectionSchema, 'body'), asyncHandler(testConnectionDraft));
router.post('/:id/test-connection', asyncHandler(testConnectionById));

export default router;
