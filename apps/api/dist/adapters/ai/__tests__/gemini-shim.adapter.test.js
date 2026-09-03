/**
 * Part B tests — New parameterized Gemini (native REST) shim (NOT wired, HTTP mocked).
 *
 * Target: src/adapters/ai/gemini-shim.adapter.ts (NEW, standalone).
 * Takes baseUrl/apiKey/model as config params — no env, no DB — so fully
 * hermetic (only `global.fetch` is stubbed; no real network).
 *
 * Output contract mirrors gemini.adapter.ts (contents/parts/generationConfig
 * request, candidates[0].content.parts[0].text parsing, usageMetadata token
 * accounting incl. thoughts, $0.075/$0.30 costing).
 *
 * Runner: npx tsx --test --test-force-exit src/adapters/ai/__tests__/gemini-shim.adapter.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiShimAdapter } from '../gemini-shim.adapter.js';
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
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const EXPECTED_URL = `${BASE_URL}/models/gemini-2.0-flash:generateContent?key=shim-key`;
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
function adapter() {
    return new GeminiShimAdapter({
        baseUrl: BASE_URL,
        apiKey: 'shim-key',
        model: 'gemini-2.0-flash',
        name: 'gemini-shim',
    });
}
describe('GeminiShimAdapter (NEW parameterized Gemini shim — fully hermetic)', () => {
    it('case1: success — native body {contents/parts/generationConfig} + URL ?key= + parsed content + thoughts-aware tokens + cost', async () => {
        calls.length = 0;
        responder = async () => contentResp('Hai Kak!', {
            usageMetadata: {
                promptTokenCount: 12,
                candidatesTokenCount: 8,
                thoughtsTokenCount: 4,
                totalTokenCount: 24,
            },
        });
        const r = await adapter().generate('hello', { temperature: 0.5, maxTokens: 128, topP: 0.9 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, EXPECTED_URL);
        assert.equal(calls[0].init.method, 'POST');
        const body = calls[0].parsedBody;
        assert.deepEqual(body.contents, [{ parts: [{ text: 'hello' }] }]);
        assert.deepEqual(body.generationConfig, { temperature: 0.5, maxOutputTokens: 128, topP: 0.9 });
        assert.equal(r.content, 'Hai Kak!');
        assert.equal(r.provider, 'gemini-shim');
        assert.equal(r.model, 'gemini-2.0-flash');
        assert.equal(r.tokens.input, 12);
        assert.equal(r.tokens.output, 12); // candidatesTokenCount(8) + thoughtsTokenCount(4)
        assert.ok(Math.abs(r.cost - ((12 * 0.075 + 12 * 0.3) / 1000000)) < 1e-12);
    });
    it('case2: usage fallback (missing usageMetadata) → ceil(prompt/content / 4), thoughts 0', async () => {
        calls.length = 0;
        responder = async () => contentResp('ok');
        const r = await adapter().generate('hello');
        // prompt 'hello' len 5 -> ceil(5/4)=2 ; content 'ok' len 2 -> ceil(2/4)=1
        assert.equal(r.tokens.input, 2);
        assert.equal(r.tokens.output, 1);
    });
    it('case3: malformed (no candidates) → UNKNOWN AIProviderError', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { usageMetadata: {} } });
        await assert.rejects(adapter().generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.UNKNOWN &&
            /Invalid response structure from Gemini API/.test(e.message));
    });
    it('case4: malformed (parts[0].text missing) → UNKNOWN AIProviderError', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { candidates: [{ content: { parts: [{}] } }] } });
        await assert.rejects(adapter().generate('hi'), (e) => e instanceof AIProviderError && e.category === ErrorCategory.UNKNOWN);
    });
    it('case5: 401 → AUTH_ERROR, not retryable', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: '{"error":{"message":"no"}}' });
        await assert.rejects(adapter().generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.AUTH_ERROR &&
            e.statusCode === 401 &&
            e.retryable === false);
    });
    it('case6: 500 → SERVER_ERROR, retryable', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'boom' });
        await assert.rejects(adapter().generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.SERVER_ERROR &&
            e.retryable === true);
    });
    it('case7: 429 → RATE_LIMIT, retryable, Retry-After parsed', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '9' }, text: '{}' });
        await assert.rejects(adapter().generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.RATE_LIMIT &&
            e.retryable === true &&
            e.retryAfter === 9);
    });
    it('case8: AbortError (timeout) → NETWORK_TIMEOUT, retryable', async () => {
        calls.length = 0;
        responder = async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        await assert.rejects(adapter().generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.NETWORK_TIMEOUT &&
            e.retryable === true);
    });
    it('case9: isHealthy() — 2xx→true, non-2xx→false, throw→false; URL carries ?key=', async () => {
        const a = adapter();
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, status: 200 });
        assert.equal(await a.isHealthy(), true);
        assert.ok(calls[0].url.includes('/models?key=shim-key'), 'health URL carries ?key=<apiKey>');
        responder = async () => fakeResponse({ ok: false, status: 401 });
        assert.equal(await a.isHealthy(), false);
        responder = async () => Promise.reject(new Error('network down'));
        assert.equal(await a.isHealthy(), false);
    });
    it('case10: config name/model reflected (getName/getModel/provider/model)', async () => {
        const a = new GeminiShimAdapter({
            baseUrl: BASE_URL,
            apiKey: 'k',
            model: 'gemini-2.5-flash',
            name: 'gemmy',
        });
        calls.length = 0;
        responder = async () => contentResp('x');
        const r = await a.generate('hi');
        assert.equal(a.getName(), 'gemmy');
        assert.equal(a.getModel(), 'gemini-2.5-flash');
        assert.equal(r.provider, 'gemmy');
        assert.equal(r.model, 'gemini-2.5-flash');
    });
});
//# sourceMappingURL=gemini-shim.adapter.test.js.map