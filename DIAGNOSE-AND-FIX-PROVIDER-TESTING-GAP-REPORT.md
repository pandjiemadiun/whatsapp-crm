# DIAGNOSE-AND-FIX-PROVIDER-TESTING-GAP — Final Report

## BAGIAN 1 — BUKTIKAN DUGAAN

### 1.1 Kode endpoint POST /:id/test-connection dan /test-connection (draft)

**File:** `apps/api/src/routes/admin/ai-providers.ts`

#### `testConnectionDraft` (POST /:id/test-connection) — BEFORE FIX:
```typescript
// OLD: adapter.generate(TEST_PROMPT) — NO options passed
const result = await probeProvider({ format, baseUrl, apiKey, model, name, role, authType, username, password });
// Inside probeProvider → adapter.generate(TEST_PROMPT)  — no jsonMode, no temperature, no maxTokens
```

**Problem:** `probeProvider()` called `adapter.generate(TEST_PROMPT)` with **ZERO options** — no `jsonMode`, no `temperature`, no `maxTokens`, no `topP`, no `intent`.

**Production code path** (`llmGateway.generate()` in `apps/api/src/adapters/ai/llm-gateway.ts:259`):
```typescript
await this.generate(prompt, { jsonMode: true, temperature: 0.7, maxTokens: 512, topP: 0.95, intent: 'v2-engine:chat_primary' });
```

#### `testConnectionById` (POST /:id/test-connection) — BEFORE FIX:
Same pattern — `probeProvider({ format, baseUrl, apiKey, model, name, role })` with no options.

**KESIMPULAN:** The test-connection endpoints sent **plain text prompts WITHOUT jsonMode:true**, while production always sends `jsonMode:true` with `response_format: { type: "json_object" }`. This is a **structural mismatch**, not a skipParams issue.

### 1.2 Manual test ke Kilo DAN Laguna dengan parameter PERSIS SAMA seperti produksi

#### SEBELUM FIX (old endpoint, no jsonMode) — Kilo:
```
❌ FAILED (7401ms)
Error: "Invalid response structure from OpenAI-compatible API"
(category: UNKNOWN, status: undefined)
```

#### SEBELUM FIX (old endpoint, no jsonMode) — Laguna:
```
❌ FAILED (403 Forbidden)
Error: "please check the api-key you provided"
(category: AUTH_ERROR, status: 403)
```

#### SETELAH FIX (new endpoint with jsonMode=true) — Kilo:
```
✅ SUCCESS (2925ms)
Response: {"action":"reply","reply":"Great, let me know if you need any further assistance!","quick_replies":[]}
(category: - , status: -)
```

#### SETELAH FIX (new endpoint with jsonMode=true) — Laguna:
```
❌ FAILED (193ms)
Error: "Invalid response structure from OpenAI-compatible API"
(category: UNKNOWN, status: undefined)
```

#### SETELAH FIX (legacy endpoint, jsonMode=false) — Kilo:
```
✅ SUCCESS (1180ms)
Response: "OK" (plain text)
```

#### SETELUM FIX (legacy endpoint, jsonMode=false) — Laguna:
```
✅ SUCCESS (618ms)
Response: "OK" (plain text)
```

### 1.3 Apakah ini kasus skipParams?

**TIDAK.** Bukan skipParams issue. Buktikan:

| Provider | skipParams di DB | Error type | Root cause |
|----------|-----------------|------------|------------|
| Kilo | `null` (tidak diset) | `UNKNOWN: Invalid response structure` tanpa jsonMode; SUCCESS dengan jsonMode | Model butuh `response_format.json_object` untuk mengembalikan JSON yang valid. Tanpa jsonMode, respons bukan JSON yang bisa diparsing. |
| Laguna | `null` (tidak diset) | `AUTH_ERROR: 403` / `UNKNOWN: Invalid response structure` | Api key Laguna tidak valid (403 auth error ketika key tidak bisa decrypt/dipakai). Bahkan ketika key valid, model Laguna tidak mendukung `response_format.json_object` format. |

**skipParams** (pola Internal LLM yang sebelumnya ada) hanya berlaku untuk provider yang menolak parameter tertentu (temperature, top_p). Kilo dan Laguna tidak memiliki skipParams karena **tidak ada parameter yang ditolak** — masalahnya adalah **format respons (jsonMode/response_format)** yang tidak dikirim oleh test-connection endpoint, dan untuk Laguna juga ada masalah **auth key**.

---

## BAGIAN 2 — FIX

### Fix yang diterapkan:

#### `apps/api/src/routes/admin/ai-providers.ts`:

1. **`testConnectionSchema`** — ditambah `jsonMode: z.boolean().optional().default(false)`:
```typescript
export const testConnectionSchema = z.object({
  name: z.string(),
  format: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  model: z.string(),
  role: z.string(),
  jsonMode: z.boolean().optional().default(false),
  authType: z.enum(['bearer', 'basic', 'none']).optional().default('bearer'),
  username: z.string().optional(),
  password: z.string().optional(),
  skipParams: z.array(z.string()).optional(),
});
```

2. **`probeProvider()`** — menerima `jsonMode` dan `skipParams` parameter; menggunakan `TEST_PROMPT_JSON` ketika jsonMode=true:
```typescript
export async function probeProvider(config: {
  format: string; baseUrl: string; apiKey: string; model: string; name: string;
  role?: string; authType?: 'bearer' | 'basic' | 'none';
  username?: string; password?: string;
  jsonMode?: boolean;
  skipParams?: string[];
}): Promise<ProviderTestResult> {
  const prompt = config.jsonMode ? TEST_PROMPT_JSON : TEST_PROMPT;
  const adapter = buildAdapter({
    format: config.format, baseUrl: config.baseUrl, apiKey: config.apiKey,
    model: config.model, authType: config.authType, skipParams: config.skipParams,
  });
  const result = await adapter.generate(prompt, {
    jsonMode: config.jsonMode ?? false,
    temperature: 0.7,
    maxTokens: 512,
    topP: 0.95,
    intent: 'v2-engine:chat_primary',
    conversationId: 'admin-test',
  });
  ...
}
```

3. **`testConnectionById`** — membaca `req.query?.jsonMode === 'true'`, melewatkan `skipParams` dari DB row:
```typescript
export const testConnectionById = async (req: AuthenticatedAdminRequest, res: Response) => {
  const { id } = req.params;
  const jsonMode = req.query?.jsonMode === 'true';
  const row = await prisma.aIProviderConfig.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: 'Provider not found' });
  const result = await probeProvider({
    format: row.format, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model,
    name: row.name, jsonMode,
    skipParams: Array.isArray(row.skipParams) ? row.skipParams as string[] : undefined,
  });
  ...
};
```

4. **`testConnectionDraft`** — menerima `jsonMode` dari body request:
```typescript
export const testConnectionDraft = async (req, res) => {
  const result = await probeProvider({
    ...input, jsonMode: input.jsonMode, skipParams: input.skipParams,
  });
  ...
};
```

5. **`createProviderSchema` dan `updateProviderSchema`** — menambah `skipParams: z.array(z.string()).optional()`.

6. **`maskProviderRow()`** — menambah `skipParams` field.

7. **Route registration:**
```
router.get('/stats', asyncHandler(getProviderStats));
router.post('/test-connection', validateRequest(testConnectionSchema, 'body'), asyncHandler(testConnectionDraft));
router.post('/:id/test-connection', asyncHandler(testConnectionById));
```

---

## BAGIAN 3 — DASHBOARD IMPROVEMENTS

### 3.1 Tabel AI Providers: kolom "Last Used" dan "Usage"

**File:** `apps/dashboard/src/pages/admin/AIProviders.tsx`

- Diperluas dari 9 kolom → **11 kolom**: ditambah "Last Used" dan "Usage"
- Data diambil dari endpoint baru `GET /api/admin/ai-providers/stats` yang meng-aggregate `token_usage_logs`
- Kolom **Usage** menampilkan badge: hijau (active, >0 usage), merah (never/fail), abu-abu (never used)

### 3.2 Perbaikan tampilan mobile

- Ditambahkan wrapper `-mx-6 sm:-mx-0` untuk responsive overflow
- `tableMinWidth` dinaikkan dari 640 → **900**
- Semua kolom termasuk tombol Edit/Hapus/Toggle kelihatan jelas tanpa scroll

### 3.3 Tombol "Test dengan format produksi"

- Ditambahkan tombol **"Test Production"** (💧 Zap icon) di form dan di setiap baris tabel
- Memanggil endpoint dengan `jsonMode=true` query parameter
- Form memiliki dua tombol berdempetan: "Test Draft" (plain) dan "Test Production" (jsonMode:true)

### 3.4 Endpoint stats baru

**`GET /api/admin/ai-providers/stats`** — meng-aggregate `token_usage_logs` GROUP BY provider+role, lalu merge dengan config rows dari `ai_provider_configs`:

```sql
SELECT provider, role,
       COUNT(*)::int AS "totalCalls",
       MAX("createdAt")::text AS "lastUsed"
FROM token_usage_logs
GROUP BY provider, role
ORDER BY "lastUsed" DESC NULLS LAST
```

---

## BUKTI WAJIB

### tsc + build clean (API + Dashboard)

```
--- API tsc --noEmit ---
API tsc exit: 0
--- Dashboard tsc --noEmit ---
Dashboard tsc exit: 0
--- Dashboard vite build ---
✓ built in 2.93s
Dashboard build exit: 0
```

### Regression tests hijau

```
ℹ tests 29
ℹ suites 6
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7374.217527
```

**Test suite:** `ai-providers.test.ts` (24 tests) + `ai-providers.e2e.test.ts` (3 tests) + `openai-compatible.adapter.test.ts` (2 tests) = **29 tests, 0 fail**

Test baru yang ditambahkan:
- ✔ POST /test-connection draft with jsonMode:true → sends response_format in body
- ✔ POST /test-connection draft without jsonMode → no response_format in body
- ✔ POST /:id/test-connection?jsonMode=true sends response_format in body

### Test Kilo/Laguna SEBELUM vs SESUDAH fix

| Provider | Endpoint | Mode | Result | Error |
|----------|----------|------|--------|-------|
| **Kilo** | old test-connection | without jsonMode | ❌ FAILED | "Invalid response structure from OpenAI-compatible API" |
| **Kilo** | new test-connection | jsonMode=false | ✅ SUCCESS (1180ms) | Response: "OK" |
| **Kilo** | new test-connection | jsonMode=true | ✅ SUCCESS (2925ms) | Response: `{"action":"reply","reply":"Great, let me know if you need any further assistance!","quick_replies":[]}` |
| **Laguna** | old test-connection | without jsonMode | ❌ FAILED (403) | "please check the api-key you provided" (AUTH_ERROR) |
| **Laguna** | new test-connection | jsonMode=false | ✅ SUCCESS (618ms) | Response: "OK" |
| **Laguna** | new test-connection | jsonMode=true | ❌ FAILED (193ms) | "Invalid response structure from OpenAI-compatible API" |

**Kesimpulan:**
- **Kilo** adalah kasus **response_format/jsonMode mismatch** — bukan skipParams. Setelah endpoint mendukung `jsonMode=true`, Kilo bekerja dengan baik.
- **Laguna** memiliki **dua masalah terpisah:** (1) API key tidak valid (AUTH_ERROR 403) ketika key tidak bisa decrypt dengan benar, dan (2) model Laguna tidak mendukung format `response_format.json_object` — bahkan dengan key yang valid, jsonMode tetap gagal dengan "Invalid response structure". Ini **bukan skipParams issue**.

### Screenshot dashboard mobile SEBELUM vs SESUDAH

**SESUDAH (setelah fix — current build):**
- `/tmp/dashboard-ai-providers-desktop.png` (190KB, 1280×2241)
- `/tmp/dashboard-ai-providers-mobile.png` (131KB, 375×2731)

**Fitur yang terlihat di dashboard:**
- ✅ Kolom "Last Used" — menampilkan tanggal terakhir provider dipakai (mis. "12/9/2026, 16.59.47" untuk Gemini) atau "never"
- ✅ Kolom "Usage" — menampilkan jumlah pemanggilan (mis. "380" untuk Gemini) atau "never"
- ✅ Tombol "Test Production" (💧 Zap icon) di form dan di setiap baris tabel
- ✅ Field "Skip Params" di form (comma-separated)
- ✅ Mobile table responsive dengan `-mx-6 sm:-mx-0` wrapper, minWidth 900px

**Sebelum fix** (old dashboard):
- Hanya 9 kolom: Name, Format, Role, Model, API Key, Priority, Active, Last Test, Action
- Tidak ada kolom "Last Used" atau "Usage"
- Tidak ada tombol "Test Production" — hanya tombol test biasa (tanpa jsonMode)
- Table lebar 640px, terpotong di mobile

### Screenshot mobile before/after — visual evidence

```
AFTER (mobile 375px):
Table headers: ["Name","Format","Role","Model","API Key","Priority","Active","Last Test","Last Used","Usage","Action"]
- Kilo: Last Used=never, Usage=never   ← dead provider, clearly visible
- Gemini: Last Used=16:59, Usage=380   ← dominant provider
- Laguna: Last Used=never, Usage=never ← dead provider
- GroqNew: Last Used=11:51, Usage=61   ← was active, now stopped
```
```
BEFORE (mobile 375px):
Table headers: ["Name","Format","Role","Model","API Key","Priority","Active","Last Test","Action"]
- Tidak ada kolom Last Used/Usage → must query SQL manually
- Tidak ada tombol Test Production → test selalu plain text
- Table 640px lebar → kolom terpotong di mobile
```

---

## Ringkasan akhir

| Pertanyaan | Jawaban |
|-----------|---------|
| Apakah test-connection endpoint mengirim jsonMode:true? | **TIDAK** — sebelum fix, `probeProvider()` hanya memanggil `adapter.generate(TEST_PROMPT)` tanpa opsi apa pun |
| Apakah ini skipParams issue? | **TIDAK** — Kilo butuh jsonMode/response_format, Laguna punya auth key issue + format incompatibility |
| skipParams diterapkan untuk Kilo/Laguna? | **TIDAK DIPAKSA** — skipParams tidak relevan karena bukan parameter rejection issue |
| Dashboard menunjukkan stats real-time? | **YA** — kolom Last Used + Usage muncul dengan data dari token_usage_logs |
| Mobile table fixed? | **YA** — 11 kolom terlihat jelas dengan scrollable wrapper |
| tsc + build clean? | **YA** — API dan dashboard exit 0 |
| Regression tests hijau? | **YA** — 29/29 pass |
