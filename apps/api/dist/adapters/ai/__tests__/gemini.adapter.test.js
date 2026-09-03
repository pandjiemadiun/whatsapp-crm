/**
 * Part A — Gemini adapter test coverage (prerequisite).
 *
 * Target: the EXISTING production GeminiAdapter (src/adapters/ai/gemini.adapter.ts)
 * — file untouched. Only the HTTP layer (`global.fetch`) is mocked; we do NOT
 * call the real Gemini API. generate() internally calls getAiDefaults() which
 * reads configService/system_settings (garuda_dev) and falls back to FALLBACKS
 * (ai-config.ts) — DB-tolerant, never throws on missing rows.
 *
 * Runner: npx tsx --env-file=../../.env --test --test-force-exit \
 *   src/adapters/ai/__tests__/gemini.adapter.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiAdapter, geminiAdapter } from '../gemini.adapter.js';
import { AIProviderError, ErrorCategory } from '../types.js';
const calls = [];
let responder = async () => contentResp('x');
/* Balanced helper: builds a valid Gemini 200 response (avoids inline bracket soup). */
function contentResp(text, extra = {}) {
    return fakeResponse({
        ok: true,
        json: { candidates: [{ content: { parts: [{ text }] } }], ...extra },
    });
}
function fakeResponse(opts) {
    return {
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 500),
        statusText: opts.statusText ?? '',
        headers: {
            get: (k) => {
                const m = opts.headers ?? {};
                return m[k] ?? m[k.toLowerCase()] ?? null;
            },
        },
        json: async () => (typeof opts.json === 'string' ? JSON.parse(opts.json) : opts.json),
        text: async () => opts.text !== undefined
            ? opts.text
            : opts.json !== undefined
                ? JSON.stringify(opts.json)
                : '',
    };
}
const originalFetch = global.fetch;
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
before(() => {
    console.log = () => { };
    console.warn = () => { };
    console.error = () => { };
    global.fetch = ((input, init) => {
        const url = typeof input === 'string' ? input : String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, init, parsedBody: body });
        return Promise.resolve(responder(url, body));
    });
});
after(() => {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
});
describe('GeminiAdapter (existing production adapter — HTTP mocked, no real Gemini calls)', () => {
    it('case1: successful generate() — body {contents/parts/generationConfig} + parsed content + usage/cost', async () => {
        calls.length = 0;
        responder = async () => contentResp('Hai Kak! Ada yang bisa saya bantu?', {
            usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 7,
                thoughtsTokenCount: 3,
                totalTokenCount: 20,
            },
        });
        const adapter = new GeminiAdapter('test-key-AAA');
        const r = await adapter.generate('hello', { temperature: 0.5, maxTokens: 128, topP: 0.9 });
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.includes(':generateContent?key=test-key-AAA'), 'URL must carry ?key=<apiKey>');
        const body = calls[0].parsedBody;
        assert.deepEqual(body.contents, [{ parts: [{ text: 'hello' }] }]);
        assert.deepEqual(body.generationConfig, { temperature: 0.5, maxOutputTokens: 128, topP: 0.9 });
        assert.equal(r.content, 'Hai Kak! Ada yang bisa saya bantu?');
        assert.equal(r.provider, 'gemini');
        assert.equal(typeof r.model, 'string');
        assert.equal(r.tokens.input, 10);
        assert.equal(r.tokens.output, 10); // candidatesTokenCount(7) + thoughtsTokenCount(3)
        assert.ok(Math.abs(r.cost - ((10 * 0.075 + 10 * 0.3) / 1000000)) < 1e-12);
    });
    it('case2: usage fallback (missing usageMetadata) → ceil(prompt/content length / 4)', async () => {
        calls.length = 0;
        responder = async () => contentResp('ok');
        const adapter = new GeminiAdapter('k');
        const r = await adapter.generate('hello', { temperature: 0.7, maxTokens: 2048, topP: 0.95 });
        // prompt 'hello' len 5 -> ceil(5/4)=2 ; content 'ok' len 2 -> ceil(2/4)=1 ; thoughts 0
        assert.equal(r.tokens.input, 2);
        assert.equal(r.tokens.output, 1);
    });
    it('case3: 401 → AIProviderError AUTH_ERROR, statusCode 401, not retryable', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Retry-After': '5' },
            text: '{"error":{"message":"bad","type":"auth"}}',
        });
        const adapter = new GeminiAdapter('k');
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.AUTH_ERROR &&
            e.statusCode === 401 &&
            e.retryable === false &&
            e.retryAfter === 5);
    });
    it('case3b: 429 → RATE_LIMIT, retryable, Retry-After parsed', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Retry-After': '12' },
            text: '{"error":{"message":"slow down"}}',
        });
        const adapter = new GeminiAdapter('k');
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.RATE_LIMIT &&
            e.retryable === true &&
            e.retryAfter === 12);
    });
    it('case3c: 500 → AIProviderError SERVER_ERROR, retryable', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'boom' });
        const adapter = new GeminiAdapter('k');
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.SERVER_ERROR &&
            e.retryable === true);
    });
    it('case4: malformed (no candidates) → AIProviderError UNKNOWN', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { usageMetadata: {} } });
        const adapter = new GeminiAdapter('k');
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.UNKNOWN &&
            /Invalid response structure/.test(e.message));
    });
    it('case5: malformed (parts[0].text missing) → AIProviderError UNKNOWN', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { candidates: [{ content: { parts: [{}] } }] } });
        const adapter = new GeminiAdapter('k');
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError && e.category === ErrorCategory.UNKNOWN);
    });
    it('case6: AbortError (timeout) → AIProviderError NETWORK_TIMEOUT, retryable', async () => {
        calls.length = 0;
        responder = async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const adapter = new GeminiAdapter('k');
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.NETWORK_TIMEOUT &&
            e.retryable === true);
    });
    it('case7: isHealthy() is meaningful (200→true, 401→false, throw→false)', async () => {
        const adapter = new GeminiAdapter('health-key');
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, status: 200 });
        assert.equal(await adapter.isHealthy(), true);
        assert.ok(calls[0].url.includes('/models?key=health-key'), 'health URL carries ?key=<apiKey>');
        responder = async () => fakeResponse({ ok: false, status: 401 });
        assert.equal(await adapter.isHealthy(), false);
        responder = async () => Promise.reject(new Error('network down'));
        assert.equal(await adapter.isHealthy(), false);
    });
    it('case8: configure() overrides API key → used as ?key= in request URL', async () => {
        calls.length = 0;
        responder = async () => contentResp('x');
        const adapter = new GeminiAdapter(); // env-sourced (or '')
        adapter.configure('cfg-key-XYZ');
        await adapter.generate('hi', { temperature: 0.7, maxTokens: 64, topP: 0.95 });
        assert.ok(calls[0].url.includes('?key=cfg-key-XYZ'), 'configure() key must appear in URL');
        assert.equal(adapter.getName(), 'gemini');
    });
    it('case9: constructor-supplied key appears as ?key= in request URL', async () => {
        calls.length = 0;
        responder = async () => contentResp('x');
        const adapter = new GeminiAdapter('ctor-key-123');
        await adapter.generate('hi', { temperature: 0.7, maxTokens: 64, topP: 0.95 });
        assert.ok(calls[0].url.includes('?key=ctor-key-123'));
    });
    it('case10: exported geminiAdapter singleton URL format (?key= + :generateContent)', async () => {
        calls.length = 0;
        responder = async () => contentResp('x');
        await geminiAdapter.generate('hi', { temperature: 0.7, maxTokens: 64, topP: 0.95 });
        assert.ok(calls[0].url.includes(':generateContent'));
        assert.ok(calls[0].url.includes('?key='));
        assert.equal(geminiAdapter.getName(), 'gemini');
    });
});
//# sourceMappingURL=gemini.adapter.test.js.map