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
 * DELETE guard (Unit 5 Part 6 — implemented):
 *  - DELETE /:id checks, before deleting, whether this row is the LAST ACTIVE
 *    provider for its role (count of OTHER active rows same role). If that
 *    count === 0, returns 409 (cannot delete into a hard empty-active-role state).
 *  - Deleting an already-inactive row, or a role with >1 active provider, is
 *    always allowed (rotation/migration flows keep working).
 *  - Note: chat_gatekeeper rows are currently cosmetic (gatekeeper stays pinned
 *    to groqAdapter — see Option B in the Unit 5 report); the guard still applies
 *    generically to every role including chat_gatekeeper/batch_task.
 *  - The resolver (Unit 3a) fails-loud on empty role lists and the gateway
 *    (Unit 3b) warns + falls back to the default singleton when a role has no
 *    active providers — so even without the guard a missing role surfaces as a
 *    logged warn rather than a silent outage; the 409 simply makes the admin
 *    intent explicit upfront.
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
import { Response } from 'express';
import { z } from 'zod';
import { AIProvider } from '../../adapters/ai/types.js';
import { AuthenticatedAdminRequest } from '../../middleware/adminAuth.js';
declare const router: import("express-serve-static-core").Router;
/** Must match schema.prisma AIProviderConfig.format + the resolver's format dispatch. */
export declare const providerFormatSchema: z.ZodEnum<{
    openai_compatible: "openai_compatible";
    gemini_native: "gemini_native";
}>;
/** Must match schema.prisma AIProviderConfig.role. */
export declare const providerRoleSchema: z.ZodEnum<{
    other: "other";
    chat_primary: "chat_primary";
    chat_fallback: "chat_fallback";
    chat_gatekeeper: "chat_gatekeeper";
    batch_task: "batch_task";
    wizard: "wizard";
}>;
export declare const createProviderSchema: z.ZodObject<{
    name: z.ZodString;
    format: z.ZodEnum<{
        openai_compatible: "openai_compatible";
        gemini_native: "gemini_native";
    }>;
    baseUrl: z.ZodString;
    apiKey: z.ZodString;
    model: z.ZodString;
    role: z.ZodEnum<{
        other: "other";
        chat_primary: "chat_primary";
        chat_fallback: "chat_fallback";
        chat_gatekeeper: "chat_gatekeeper";
        batch_task: "batch_task";
        wizard: "wizard";
    }>;
    priority: z.ZodDefault<z.ZodNumber>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const updateProviderSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    format: z.ZodOptional<z.ZodEnum<{
        openai_compatible: "openai_compatible";
        gemini_native: "gemini_native";
    }>>;
    baseUrl: z.ZodOptional<z.ZodString>;
    apiKey: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<{
        other: "other";
        chat_primary: "chat_primary";
        chat_fallback: "chat_fallback";
        chat_gatekeeper: "chat_gatekeeper";
        batch_task: "batch_task";
        wizard: "wizard";
    }>>;
    priority: z.ZodOptional<z.ZodNumber>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const testConnectionSchema: z.ZodObject<{
    format: z.ZodEnum<{
        openai_compatible: "openai_compatible";
        gemini_native: "gemini_native";
    }>;
    baseUrl: z.ZodString;
    apiKey: z.ZodString;
    model: z.ZodString;
}, z.core.$strip>;
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
/**
 * Mask an API key to last-4 chars. NEVER returns the raw credential.
 * - null/undefined/empty => null
 * - "sk-abc123456"        => "******3456"
 * Used in every read path (GET /, create/update/test-connection responses).
 */
export declare function maskKey(apiKey: string | null | undefined): string | null;
/**
 * Build a parameterized adapter from config (Unit 2 adapters).
 * Throws on unknown format — fail-loud (mirrors the resolver invariant: bad
 * format must never reach the provider call). The route validates format via
 * zod before this runs; this is a defensive backstop.
 */
export declare function buildAdapter(config: {
    format: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    name?: string;
    timeoutMs?: number;
}): AIProvider;
export declare const listProviders: (req: AuthenticatedAdminRequest, res: Response) => Promise<void>;
export declare const createProvider: (req: AuthenticatedAdminRequest, res: Response) => Promise<void>;
export declare const updateProvider: (req: AuthenticatedAdminRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const deleteProvider: (req: AuthenticatedAdminRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const testConnectionById: (req: AuthenticatedAdminRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const testConnectionDraft: (req: AuthenticatedAdminRequest, res: Response) => Promise<void>;
export default router;
//# sourceMappingURL=ai-providers.d.ts.map