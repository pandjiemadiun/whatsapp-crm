/**
 * Part B tests — New generic OpenAI-compatible adapter (NOT wired, HTTP mocked).
 *
 * Target: src/adapters/ai/openai-compatible.adapter.ts (NEW, standalone).
 * The adapter takes baseUrl/apiKey/model as config params — no env, no DB,
 * no getAiDefaults dependency — so these tests are fully hermetic (only
 * `global.fetch` is stubbed; no real network).
 *
 * Runner: npx tsx --test --test-force-exit src/adapters/ai/__tests__/openai-compatible.adapter.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleAdapter } from '../openai-compatible.adapter.js';
import { AIProviderError, ErrorCategory } from '../types.js';
const calls = [];
let responder = async () => fakeResponse({ ok: true, json: { choices: [{ message: { content: 'x' } }] } });
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
const BASE_URL = 'https://api.test/v1/chat/completions';
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
describe('OpenAICompatibleAdapter (NEW generic adapter — fully hermetic)', () => {
    it('case1: success — OpenAI body shape + Bearer auth + parsed content + tokens + cost', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({
            ok: true,
            json: { choices: [{ message: { content: 'Hello!' } }], usage: { prompt_tokens: 8, completion_tokens: 4 } },
        });
        const adapter = new OpenAICompatibleAdapter({
            baseUrl: BASE_URL,
            apiKey: 'sk-test-abc',
            model: 'gpt-x',
            name: 'openai-test',
        });
        const r = await adapter.generate('hi', { temperature: 0.3, maxTokens: 64, topP: 0.8 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, BASE_URL);
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-abc');
        const body = calls[0].parsedBody;
        assert.deepEqual(body, {
            model: 'gpt-x',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.3,
            max_tokens: 64,
            top_p: 0.8,
        });
        assert.equal(r.content, 'Hello!');
        assert.equal(r.provider, 'openai-test');
        assert.equal(r.model, 'gpt-x');
        assert.equal(r.tokens.input, 8);
        assert.equal(r.tokens.output, 4);
        assert.ok(Math.abs(r.cost - ((8 * 0.05 + 4 * 0.15) / 1000000)) < 1e-12);
    });
    it('case2: jsonMode adds response_format: { type: json_object }', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { choices: [{ message: { content: '{}' } }] } });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await adapter.generate('hi', { jsonMode: true });
        assert.deepEqual(calls[0].parsedBody.response_format, { type: 'json_object' });
    });
    it('case2b: without jsonMode, response_format is absent', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { choices: [{ message: { content: '{}' } }] } });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await adapter.generate('hi');
        assert.equal(calls[0].parsedBody.response_format, undefined);
    });
    it('case3: usage fallback (no usage) → ceil(prompt/content length / 4)', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { choices: [{ message: { content: 'Hello!' } }] } });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        const r = await adapter.generate('hi');
        // prompt 'hi' len 2 -> ceil(2/4)=1 ; content 'Hello!' len 6 -> ceil(6/4)=2
        assert.equal(r.tokens.input, 1);
        assert.equal(r.tokens.output, 2);
    });
    it('case4: 401 → AUTH_ERROR, statusCode 401, not retryable', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: '{"error":{"message":"no"}}' });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.AUTH_ERROR &&
            e.statusCode === 401 &&
            e.retryable === false);
    });
    it('case5: 429 → RATE_LIMIT, retryable, Retry-After parsed', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '7' }, text: '{}' });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.RATE_LIMIT &&
            e.retryable === true &&
            e.retryAfter === 7);
    });
    it('case6: 500 → SERVER_ERROR, retryable', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'boom' });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.SERVER_ERROR &&
            e.retryable === true);
    });
    it('case7: malformed (no choices) → UNKNOWN AIProviderError', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: {} });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.UNKNOWN &&
            /Invalid response structure from OpenAI-compatible API/.test(e.message));
    });
    it('case8: AbortError (timeout) → NETWORK_TIMEOUT, retryable', async () => {
        calls.length = 0;
        responder = async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm' });
        await assert.rejects(adapter.generate('hi'), (e) => e instanceof AIProviderError &&
            e.category === ErrorCategory.NETWORK_TIMEOUT &&
            e.retryable === true);
    });
    it('case9: isHealthy() — 2xx→true, non-2xx→false, throw→false', async () => {
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'sk-test-abc', model: 'm' });
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, status: 200 });
        assert.equal(await adapter.isHealthy(), true);
        assert.equal(calls[0].init.method, 'GET');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-abc');
        responder = async () => fakeResponse({ ok: false, status: 401 });
        assert.equal(await adapter.isHealthy(), false);
        responder = async () => Promise.reject(new Error('network down'));
        assert.equal(await adapter.isHealthy(), false);
    });
    it('case10: custom name surfaces as provider in AIResponse', async () => {
        calls.length = 0;
        responder = async () => fakeResponse({ ok: true, json: { choices: [{ message: { content: 'x' } }] } });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BASE_URL, apiKey: 'k', model: 'm', name: 'deepseek-pro' });
        const r = await adapter.generate('hi');
        assert.equal(r.provider, 'deepseek-pro');
        assert.equal(adapter.getName(), 'deepseek-pro');
        assert.equal(adapter.getModel(), 'm');
    });
    // ── PV-P3-debug: prove the EXACT outbound request for a real provider (Mistral) ──
    // baseUrl is forwarded VERBATIM — no path appended / rewritten. This is the
    // trace (URL + method + headers + body) the debug task asked for.
    it('case11: Mistral baseUrl sent VERBATIM — POST + Bearer + Content-Type + OpenAI body', async () => {
        calls.length = 0;
        const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
        responder = async () => fakeResponse({ ok: true, json: { choices: [{ message: { content: 'OK' } }] } });
        const adapter = new OpenAICompatibleAdapter({
            baseUrl: MISTRAL_URL,
            apiKey: 'sk-mistral-fake',
            model: 'mistral-small-latest',
            name: 'mistral-probe',
        });
        const r = await adapter.generate(TEST_PROMPT());
        assert.equal(calls.length, 1);
        // Acceptance #4: EXACTLY the configured baseUrl, nothing appended/rewritten.
        assert.equal(calls[0].url, MISTRAL_URL, 'baseUrl must be sent VERBATIM');
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-mistral-fake');
        assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
        const body = calls[0].parsedBody;
        assert.equal(body.model, 'mistral-small-latest');
        assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with the single word: OK' }]);
        assert.equal(body.temperature, 0.7);
        assert.equal(body.max_tokens, 512);
        assert.equal(body.top_p, 0.95);
        assert.equal(r.content, 'OK');
    });
    it('case12: bare origin "/v1" forwarded VERBATIM (no /chat/completions appended) — explains the option-1 404', async () => {
        calls.length = 0;
        const BARE = 'https://api.mistral.ai/v1';
        responder = async () => fakeResponse({ ok: false, status: 404, statusText: 'Not Found', text: '{}' });
        const adapter = new OpenAICompatibleAdapter({ baseUrl: BARE, apiKey: 'k', model: 'mistral-small-latest' });
        await assert.rejects(() => adapter.generate('hi'), (e) => e instanceof AIProviderError && e.statusCode === 404);
        // The adapter does NOT append /chat/completions — it sends the origin as-is.
        assert.equal(calls[0].url, BARE);
        assert.equal(calls[0].init.method, 'POST');
    });
});
/** Prompt used by probeProvider/test-connection (mirrors ai-providers.ts TEST_PROMPT). */
function TEST_PROMPT() {
    return 'Reply with the single word: OK';
}
//# sourceMappingURL=openai-compatible.adapter.test.js.map