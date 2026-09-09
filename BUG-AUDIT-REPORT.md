# 📋 Laporan Audit Bug, Race Condition, & Kode yang Perlu Perhatian
## Project Garuda API (`apps/api`)

**Scope:** `apps/api/src/` — TypeScript backend (~560 file sumber, 7790+ baris TS)
**Metode:** Review manual terhadap modul inti (message pipeline, conversation/chat engine, order/payment, AI gateway, realtime, middleware, infrastruktur)
**Tanggal:** 2026-09-09
**Auditor:** AI Code Review

---

## ⚠️ Disclaimer Lingkup &amp; Keterbatasan

Karena codebase sangat besar, laporan ini **tidak dapat menjamin 100% akurasi** atas seluruh 560+ file. Beberapa modul besar yang **belum seluruhnya ditinjau secara mendalam** antara lain:

- `product.service.ts` (1513 baris)
- `cart-authority.ts` (1447 baris)
- `fallback.service.ts` (1201 baris)
- `canonical-context.service.ts` (1451 baris)
- `conversation-context.service.ts` (621 baris, bagian akhir belum seluruh dibaca)
- Semua file di `routes/admin/*`, `routes/internal/*`, dan `marketplace/`

Temuan di bawah mewakili pola-pola bug yang ditemukan di modul yang ditinjau. Sebaiahnya dilakukan review lanjutan terhadap modul yang belum selesai, khususnya **CartAuthority** (logika stok & variant resolution) dan **CanonicalConversationStateService** (boundary penulis baru yang kompleks).

---

## 🔴 Severity 1 — Bug Logis / Race Condition Kritis

### 1. Circuit Breaker Double-Failure Counting (BUG)

**File:** `src/services/message-processor.service.ts` (lines 257–268)
**Juga:** `src/services/circuit-breaker.service.ts` (line 121)

`CircuitBreakerService.wrap()` sudah secara internal memanggil `recordFailure()` ketika `fn()` melempar error:

```typescript
async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.recordSuccess();       // ← counts success
      return result;
    } catch (err) {
      this.recordFailure();       // ← FIRST failure count (internal)
      throw err;
    }
}
```

Tapi `processWithLock` di message-processor **secara eksplisit memanggil `recordFailure()` sekali lagi** di blok catch-nya:

```typescript
result = await this.llmCircuitBreaker.wrap(() => conversationService.processCustomerMessage(...));
} catch (err) {
    this.llmCircuitBreaker.recordFailure();  // ← SECOND failure count (redundant)
    ...
}
```

**Dampak:** Dengan `failureThreshold: 2`, sirkuit hanya butuh **1 kegagalan LLM sebenarnya** untuk berubah ke OPEN (karena 2 kali `recordFailure()` dipanggil). Ini berarti setiap kegagalan LLM pertama langsung memicu circuit breaker terbuka dan mengirim pesan apology hardcoded ke customer, padahal harusnya tahan 2 kegagalan berturut-turut. Fitur circuit breaker menjadi tidak efektif — "terlalu sensitif."

**Fix:** Hapus panggilan eksplisit `recordFailure()` pada line 268 — biarkan `wrap()` yang mengatur send failure counting.

---

### 2. TOCTOU Race pada `transitionOrder` — State Machine Bypass (BUG)

**File:** `src/business/order-transition.ts` (lines 96–141)

`transitionOrder()` melakukan read-modify-write yang **tidak atomik dan tidak ada guard pada status di klausa `where` update**:

```typescript
const existing = await tx.order.findUnique({ where: { id: orderId }, ... });
// ... validate ALLOWED_TRANSITIONS[existing.orderStatus].has(toStatus) ...
const row = await tx.order.update({
    where: { id: orderId },  // ← TIDAK ada orderStatus: existing.orderStatus di sini!
    data: { orderStatus: toStatus, ... },
});
```

**Dampak:** Dua request konkuren yang me-transition order yang sama (mis. satu ke `confirmed`, satu ke `cancelled`) dapat keduanya lolasi validasi melawan data stal. Karena `where` hanya matching `id`, update terakhir akan menimpa tanpa tahu perubahan status, **melewati state machine** — sebuah order bisa loncat dari `pending` langsung ke `cancelled` walau sudah ada yang transisi ke `confirmed`, atau dua order berbeda stok bisa double-decrement. Ini melanggar invariant G2-B.6.

Route `PUT /:id/status` (orders.ts:126–165) juga melakukan pre-validation yang sama (read → validate → transition) tanpa lock, sehingga race-nya masih ada.

**Fix:** Tambahkan `orderStatus: fromStatus` ke `where` clause di `update`, atau gunakan `SELECT ... FOR UPDATE` dalam transaksi.

---

### 3. In-Memory Circuit Breaker / Cooldown Tidak Konsisten (BUG)

**File:** `src/services/provider-cooldown.ts` (baris 18 — module-level `Map`)

`provider-cooldown.ts` (yang dipakai oleh `LLMGateway`) menyimpan cooldown di **memori proses** (`const store = new Map()`). Ini tidak dishare antar PM2 instance. Padahal `ai-key-router.service.ts` (yang dipakai oleh `GroqAdapter`) sudah benar-benar menggunakan Redis untuk cooldown.

**Dampak:** Jika aplikasi di-scale ke lebih dari 1 instance, cooldown per-provider tidak akan konsisten antar instance. Instance A yang baru saja dapat 429 akan tetap mengirim request ke provider yang sama di instance B. Ini bisa memicu rate-limit cascade yang lebih buruk.

**Fix:** Migrasikan `provider-cooldown.ts` ke Redis, atau gunakan Redis untuk semua cooldown tracking.

---

### 4. `AIProviderManager` dan `LLMGateway` — Dua Sistem Duplikat (BUG ARSITEKTURAL)

**File:** `src/adapters/ai/manager.ts` vs `src/adapters/ai/llm-gateway.ts`

Kedua file ini **menduplikat fungsionalitas yang sama**: provider selection, circuit breaker, retry logic, token usage tracking, provider cooldown. Tapi mereka dipakai di path yang berbeda:

| System | Digunakan oleh | Scope |
|---|---|---|
| `AIProviderManager` (`manager.ts`) | `adapters/container.ts` → `product.service.ts:1089` | V1 product catalog path |
| `LLMGateway` (`llm-gateway.ts`) | `interpreter.ts`, `reasoning.ts`, v2-engine | V1 conversation + V2 engine path |

**Dampak:**
- State circuit breaker tidak dishare antara keduanya (jika Gemini down di `LLMGateway`, `AIProviderManager` tidak tahu).
- Statistik penggunaan AI tidak konsisten (two separate stats objects).
- `manager.ts` **tidak punya retry loop** (comment line 155: "manager.ts has no per-provider retry loop"), sementara `LLMGateway` punya (3 attempts). Perilaku error handling berbeda antara path product catalog vs conversation.
- Maintenance menjadi 2x — fix di satu tempat tidak otomatis berlaku di tempat lain.

**Fix:** Unifiedkan menjadi satu gateway. Pilih yang paling lengkap (`LLMGateway`) dan migrasikan semua caller.

---

### 5. Webhook Secret di Query Parameter URL (BUG KEAMANAN)

**File:** `src/routes/messages.ts` (lines 143, 161) + `src/routes/webhooks.ts` (line 143)

Webhook Fonnte URL dibangun dengan secret di query parameter:
```
${webhookUrl}/api/webhooks/fonnte?secret=${webhookSecret}
```

**Dampak:** Query parameter direkam oleh web server logs, reverse proxy logs, CDN, browser history, dan `Referer` header. Jika webhook URL bocor, attacker bisa mem-palsakan webhook. Fonnte memang hanya mendukung query-param secrets, tapi sebaiknya secret tidak mengandung nilai sensitif tinggi atau harus rotasi otomatis.

**Fix:** Gunakan header HMAC-based authentication, atau setidaknya dokumentasikan sebagai risk yang diterima.

---

## 🟠 Severity 2 — Bug Logis / Race Condition

### 6. `recordReconnect` Menimpa Metric `sendTimeouts` (BUG)

**File:** `src/services/health-monitor.service.ts` (line 53)

```typescript
recordReconnect(): void {
    const now = Date.now();
    this.reconnectTimestamps.push(now);
    this.pruneReconnects(now);
    this.metrics.sendTimeouts = this.reconnectTimestamps.length;  // ← BUG!
}
```

`recordReconnect()` menimpa `metrics.sendTimeouts` dengan jumlah reconnect. Kedua metric ini seharusnya independen:
- `sendTimeouts` — seharusnya di-increment oleh `recordSendTimeout()` (line 56-58)
- `reconnectsPerHour` — di-set dari `reconnectTimestamps.length` di `checkSafeMode()` (line 76)

**Dampak:** Safe mode bisa engage secara salah karena `sendTimeouts` tiba-tiba melonjol ke jumlah reconnect (bukan jumlah timeout yang sebenarnya). Ini bisa menyebabkan false positive safe mode, yang men-delay semua pesan kirim.

**Fix:** Hapus line 53 — `recordReconnect()` seharusnya hanya push timestamp, biarkan `checkSafeMode()` yang menghitung `reconnectsPerHour`.

---

### 7. `drainChatBuffers` — Substring Matching Bug (BUG)

**File:** `src/services/message-queue.service.ts` (lines 340, 348)

```typescript
if (bufKey.includes(chatId)) {  // ← substring match!
```

Key buffer berupa `${storeId}:${customerId}` (mis. `store1:customer123`). Jika `chatId = "123"`, ini akan match buffer key `store1:customer123` meskipun bukan conversation 123.

**Dampak:** Pada shutdown, `drainChatBuffers` bisa mendrain buffer conversation yang salah, menggabungkan pesan dari customer yang berbeda. Ini jarang terjadi karena key berupa ID unik, tapi tetap adalah bug latent.

**Fix:** Gunakan exact match atau prefix match yang tepat (`bufKey.startsWith(...)` dengan delimiter, atau parse key).

---

### 8. `getStats()` — Duplicate Fields (BUG)

**File:** `src/services/message-queue.service.ts` (lines 384-385)

```typescript
activeQueues: this.processingLocks.size,
activeLocks: this.processingLocks.size,   // ← sama persis!
```

`activeQueues` dan `activeLocks` mengembalikan nilai yang sama. `activeQueues` seharusnya menggambarkan jumlah buffer yang aktif (textBuffers + mediaBuffers), bukan jumlah lock.

**Fix:** `activeQueues` → `this.textBuffers.size + this.mediaBuffers.size`.

---

### 9. `NEGATION_WORDS` — Duplikat (BUG MINOR)

**File:** `src/services/message-queue.service.ts` (lines 85-87)

```typescript
const NEGATION_WORDS = [
  'nggak', 'gak', 'tidak', 'bukan', 'ga', 'tak', 'nggak', 'gak',  // ← 'nggak' dan 'gak' duplikat
];
```

**Dampak:** Tidak mempengaruhi logika (hanya duplikat), tapi menunjukkan code smell.

---

### 10. `customerInfo.avgResponseTimeMs` Selalu `undefined` (BUG DEAD CODE)

**File:** `src/services/message-processor.service.ts` (lines 350-353)

```typescript
const profile = await entityCacheService.getCustomerProfile(input.storeId, input.customerId);
const customerInfo: CustomerPresenceInfo = {
    avgResponseTimeMs: profile ? undefined : undefined,  // ← SELALU undefined
};
```

Kondisi ternary `profile ? undefined : undefined` — selalu mengembalikan `undefined` apapun nilai `profile`. Ini mungkin seharusnya `profile ? profile.avgResponseTimeMs : undefined`.

**Dampak:** Presence simulation tidak memanfaatkan data profil customer sama sekali. Fitur ini mungkin belum diimplementasikan.

---

### 11. In-Memory Cooldown Fallback Tidak Diperiksa (BUG)

**File:** `src/services/ai-key-router.service.ts` (lines 147-173)

`reportRateLimit()` menulis cooldown ke Redis, dan jika Redis gagal, menulis ke global in-memory fallback:
```typescript
(globalThis as any).__GROQ_MEM_COOLDOWN__[memKey] = Date.now() + ttl * 1000;
```

Tapi `isInCooldown()` hanya cek Redis:
```typescript
const ttl = await redis.ttl(redisCooldownKey(apiKey));
return ttl > 0;
```

**Dampak:** Jika Redis down, key yang dapat 429 tidak akan pernah diskip — semua request akan mencoba key yang sama dan dapat 429 berulang-ulang. In-memory fallback-nya sama sekali tidak dipakai.

---

### 12. `AIProviderManager` Circuit Breaker Reset pada 429 (INCONSISTENSI)

**File:** `src/adapters/ai/manager.ts` (line 212)

```typescript
if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
    triggerCooldown(error.provider || name, role, ...);
    this.breaker.openedAt = 0;  // ← mereset circuit breaker pada rate limit?!
}
```

Mereset `openedAt = 0` pada saat mendapatkan 429 justru **memungkinkan circuit breaker kembali ke state normal** justru pada saat provider sedang rate-limited. Ini bertentangan logika circuit breaker — seharusnya 429 juga dihitung sebagai "failure" yang meningkatkan kemungkinan circuit terbuka.

---

## 🟡 Severity 3 — Dead Code, Inconsistency, Kode Orphan

### 13. `GEMINI_ENDPOINT` Konstanta Dead Code

**File:** `src/adapters/ai/gemini.adapter.ts` (line 10)

```typescript
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
```

Konstanta ini **tidak pernah dipakai** — URL endpoint sebenarnya disusun inline pada line 111 dengan `this._model`. Juga, model `gemini-3.6-flash` kemungkinan besar bukan nama model Gemini yang valid (model saat ini adalah `gemini-2.0-flash`, `gemini-2.5-flash`, dll).

---

### 14. `_model` Selalu Di-override di `generate()` (BUG)

**File:** `src/adapters/ai/gemini.adapter.ts` (line 77) + `groq.adapter.ts` (line 116)

```typescript
this._model = defaults.primaryModel;  // overrides any model set via configureModel()
```

Setiap pemanggilan `generate()` Menimpa `_model` dari config DB/env. Ini berarti `configureModel()` (yang dipanggil dari `container.ts` atau admin) **tidak pernah berdampak** — nilainya selalu ditimpa pada pemanggilan berikutnya. Ini kontradiksi dengan dokumentasi `configureModel()`.

---

### 15. `console.log`/`console.warn` di Adapter AI dan Storage (INCONSISTENSI LOG)

**File:** `groq.adapter.ts`, `gemini.adapter.ts`, `manager.ts`, `cloudinary.adapter.ts`, `encryption.ts`, `ai-key-router.service.ts`

Banyak adapter menggunakan `console.log`, `console.warn`, `console.debug` langsung, **bukan** `adapters.logger` (Winston). Ini berarti:
- Log tidak terstrukur (bukan JSON)
- Tidak masuk ke log file PM2 yang dikonfigurasi di `ecosystem.config.js`
- Tidak memiliki request correlation ID
- Berbeda format dengan log dari business layer

---

### 16. Komentar `AIProviderResolver` Yang Sudah Usang (AMBIGUITAS)

**File:** `src/services/ai-provider-resolver.service.ts` (line 12)

Komentar berkata: *"NOT wired into LLMGateway yet (Unit 3b). This module has no production caller in 3a"*

Tapi sebenyatanya, `aiProviderResolver` **memang di-import** oleh `llm-gateway.ts` (line 34) dan dipakai di `resolveEffectiveProviders()`. Komentar ini menyesatkan — berpotensi menyebabkan developer menghapus modul yang sebenarnya masih dipakai.

---

### 17. `GroqAdapter.isHealthy()` Pakai `this.apiKey` Kosong (BUG MINOR)

**File:** `src/adapters/ai/groq.adapter.ts` (line 317)

```typescript
const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${this.apiKey}` },
});
```

Jika key dikonfigurasi via `configureKeys()` (multi-key mode), `this.apiKey` di-set ke `''` (empty string). Health check akan selalu gagal karena `Bearer ` (empty token). Seharusnya memakai `getApiKey()` untuk ambil key dari router.

---

### 18. `.ts.bak` File di Source Directory (KEBERSIHAN)

**File:** `src/index.ts.bak`

File backup `index.ts.bak` (5578 bytes) masih ada di direktori sumber. Ini bisa menyebabkan kebingungan, atau jika TypeScript compiler tiba-tiba menerima `.bak` file, bisa menyebabkan error kompilasi.

---

### 19. Multi-Type Message Support di Message Queue (DEAD CODE)

**File:** `src/services/message-queue.service.ts`

`MessageType` enum mendukung `'image' | 'video' | 'audio' | 'document'`, dan ada `bufferMedia()` + `mergeMediaMessages()` yang menangani semua tipe ini. Tapi:
- Webhook GOWA (line 45): hanya proses text (`if (!text) return`)
- Webhook Fonnte (line 183-187): hanya proses text
- `ProcessMessageInput` tidak punya field `type`/`mediaKey` — `raw.type` di `processMessage` selalu hardcode `'text'` (line 105)

Seluruh logika media coalescing di message-queue adalah **dead code** — fitur media belum diimplementasikan di webhook layer.

---

## 🟡 Severity 3 — Concurrency & Tenant Isolation

### 20. In-Memory Mutex Lock — Tidak Multi-Instance Safe

**File:** `src/services/message-queue.service.ts` (line 166-175)

`acquireLock()` menggunakan `Map` (in-memory), bukan Redis. Ini berfungsi untuk single-instance (fork mode, instances=1 di ecosystem.config.js) tapi **TIDAK berfungsi jika di-scale ke multi-instance** — dua instance bisa memproses pesan yang sama secara bersamaan (race condition), meskipun dedup Redis sudah menggunakan SET NX.

Ini konsisten dengan dokumentasi (single VPS MVP), tapi seharusnya dikelasifikasikan sebagai limitasi yang harus di-upgrade saat scaling.

---

### 21. Tenant Isolation di `GET /:storeId` Admin Engine Route (AMBIGUITAS KEAMANAN)

**File:** `src/routes/admin/engine.ts` (line 18)

```typescript
router.get('/:storeId', adminAuthMiddleware, async (req, ...) => {
```

Endpoint ini hanya memerlukan `adminAuthMiddleware` (bukan `requireAdminRole`), berarti **admin dari store A bisa baca konfigurasi engine store B**. Ini read-only dan data yang terpapar tidak sensitif (hanya engine config), tapi masih pelanggaran tenant isolation yang seharusnya ditutup.

---

### 22. Shadow Test Endpoint — Akses Admin Generik Tanpa Role Check (KEAMANAN)

**File:** `src/routes/internal/v2-engine-shadow-test.ts` + `index.ts` line 164

```typescript
app.use('/api/internal', adminAuthMiddleware, v2ShadowTestRouter);
```

Shadow test endpoint (yang memicu LLM calls ke V2 engine) hanya dilindungi `adminAuthMiddleware` — setiap admin terautentikasi bisa mengaksesnya, termasuk admin dari tenant lain. Kombinasi dengan issue #20, ini berpotensi untuk abuse (konsumsi kuota LLM).

---

### 23. `P2025` (Not Found) Diperlakukan Seperti `P2002` (Duplicate) → Kode HTTP Salah

**File:** `src/middleware/errorHandler.ts` (lines 33-34)

```typescript
if (prismaErr.code === 'P2002') message = 'Resource already exists';
if (prismaErr.code === 'P2025') message = 'Resource not found';
```

Tapi keduanya merespons dengan **HTTP 409** (Conflict):

```typescript
res.status(409).json({ ... });
```

`P2025` (record not found) seharusnya mengembalikan **404**, bukan 409. Ini bisa membingungkan klien yang mengharapkan 404 untuk resource yang tidak ada.

---

### 24. `updateUserIntent` — Update Non-atomik (RACE CONDITION MINOR)

**File:** `src/business/conversation-context.service.ts` (lines 144-154)

Method ini melakukan `prisma.conversationContext.update` langsung tanpa atomic CAS:

```typescript
await prisma.conversationContext.update({
    where: { conversationId },
    data: { userIntent: intent },
});
```

Ini hanya update kolom `userIntent`, jadi tidak menyebabkan lost-update pada `extractedEntities`. Tapi `update` tanpa `@updatedAt` condition akan bump `updatedAt`, yang bisa menyebabkan retry yang tidak perlu pada writer atomicCas lain. Ini minor, tapi inkonsisten dengan pola atomic CAS yang dipaksakan di tempat lain.

---

## 🟡 Severity 3 — Infrastructure & Initialization

### 25. `setInterval` untuk Key Refresh Tanpa Cleanup (MEMORY LEAK)

**File:** `src/infrastructure/prisma.ts` (line 44)

```typescript
setInterval(async () => {
    const { refreshEncryptionKey } = await import('../utils/encryption.js');
    await refreshEncryptionKey();
}, 10 * 60 * 1000);
```

Interval ini dibuat pada module load, tapi **tidak pernah di-clear** pada shutdown. Handler `SIGTERM`/`SIGINT` di `index.ts` hanya memanggil `messageProcessorService.shutdown()`, `realtimeService.shutdown()`, dan `prisma.$disconnect()` — tidak ada `clearInterval`. Di PM2 dengan `max_restarts: 5`, ini bisa bertumpuk. Ini minor karena interval hanya 10 menit, tapi prinsipnya leak.

---

### 26. Redis Connection Pada Module Load Sebelum `dotenv.config()` (CONFIG)

**File:** `src/adapters/cache/redis.adapter.ts` (line 4-9), `ai-key-router.service.ts` (line 16-22), `redis-rate-limit-store.ts` (line 17-22)

Ketiga file ini membuat koneksi Redis di **module load time** (top-level `new Redis({...})`), yang dieksekusi **sebelum** `dotenv.config({ path: '../../../.env', override: true })` dijalankan di `index.ts` line 77.

**Dampak:** Jika `REDIS_HOST`/`REDIS_PORT` hanya ada di `.env` file (bukan di shell env atau PM2 env), ketiga connection ini akan **menggunakan default `localhost:6379`** karena env var belum tersedia saat Redis constructor berjalan. Ini bisa menyebabkan Redis connection mengacung ke localhost yang salah.

**Fix:** Gunakan lazy initialization (baca env saat pertama kali koneksi dibutuhkan, bukan saat module load), atau pindakan `dotenv.config()` ke paling atas sebelum semua import.

---

### 27. Tiga Koneksi Redis Terpisah (RESOURCE WASTE)

**File:** `redis.adapter.ts`, `ai-key-router.service.ts`, `redis-rate-limit-store.ts`

Tiga modul berbeda masing-masing membuat instance `Redis` sendiri-sendiri. Ini berarti **3 koneksi TCP terpisah ke Redis server** yang sama. Di environment dengan connection limit (mis. Redis Cloud), ini bisa mendekati limit lebai.

**Fix:** Satu singleton Redis connection yang dishare semua modul.

---

### 28. `index.ts` — `.env` Path Hardcoded Relatif

**File:** `src/index.ts` (line 77)

```typescript
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });
```

Ini mengasumsikan struktur direktori yang sangat spesifik. Ketika aplikasi dijalankan dari `dist/index.js` (compiled), `__dirname` adalah `/home/ubuntu/garuda/apps/api/dist`, dan `../../../.env` = `/home/ubuntu/garuda/.env`. Ini berfungsi, tapi sangat rapuh terhadap perubahan struktur direktori.

---

## 🟡 Severity 3 — Concurrency di Conversation Service

### 29. V2 Path — Customer Message Tidak Disave Saat Post-Mutation Error (DATA LOSS RISK)

**File:** `src/business/conversation.service.ts` (lines 248-306)

Di V2 path, ketika outcome adalah `resolved` dengan `action: EXECUTE`:
1. Cart mutation dieksekusi (line 252) — `v2MutationExecuted = true`
2. `saveWorkspaceV2` (line 264) — bisa gagal
3. Jika gagal, `catch` (line 299) → `buildSafeReply` dikembalikan (line 302)
4. Tapi `saveMessage` untuk customer message (line 294) **belum pernah dieksekusi** — masih di dalam try block yang throw

**Dampak:** Customer message hilang dari conversation history, padahal cart sudah di-mutate. Ini bisa menyebabkan ketidakkonsistenan conversation history — customer melihat bot balas "Baik kak, pesanan Kakak sudah kami catat", tapi customer message aslinya tidak ada di history.

---

## 📊 Ringkasan &amp; Rekomendasi Prioritas

| Prioritas | Issue | File | Dampak |
|---|---|---|---|
| **🔴 P0** | Circuit breaker double-failure counting | message-processor.service.ts | Circuit terbuka setelah 1 failure, bukan 2 |
| **🔴 P0** | TOCTOU race di `transitionOrder` | order-transition.ts | State machine bisa dibypass → double stock decrement |
| **🔴 P0** | Dua sistem AI gateway duplikat | manager.ts vs llm-gateway.ts | Error handling & circuit breaker tidak konsisten |
| **🟠 P1** | `recordReconnect` menimpa `sendTimeouts` | health-monitor.service.ts | False positive safe mode |
| **🟠 P1** | In-memory cooldown tidak dishare | provider-cooldown.ts | Rate-limit cascade di multi-instance |
| **🟠 P1** | Webhook secret di query param | messages.ts, webhooks.ts | Secret leak via logs |
| **🟠 P1** | P2025 → 409 (harus 404) | errorHandler.ts | HTTP status keliru |
| **🟠 P2** | `drainChatBuffers` substring match bug | message-queue.service.ts | Buffer conversation salah di-drain |
| **🟠 P2** | Cooldown fallback in-memory tidak dipakai | ai-key-router.service.ts | Redis-down → tidak ada protection |
| **🟠 P2** | `_model` di-override setiap `generate()` | gemini/groq.adapter.ts | `configureModel()` tidak berfungsi |
| **🟡 P3** | Dead code `GEMINI_ENDPOINT` | gemini.adapter.ts | Kode mati |
| **🟡 P3** | `console.log` di adapter | groq/gemini/manager.ts | Log tidak terstrukr |
| **🟡 P3** | 3 Redis connections terpisah | redis.adapter, ai-key-router, rate-limit-store | Resource waste |
| **🟡 P3** | `.ts.bak` di source dir | index.ts.bak | Kebersihan |
| **🟡 P3** | Media message support = dead code | message-queue.service.ts | Fitur nggak lengkap |
| **🟡 P3** | Tenant isolation lemah di admin routes | engine.ts, shadow-test.ts | Admin bisa akses store lain |
| **🟡 P3** | `setInterval` key refresh tidak diclean-up | prisma.ts | Memory leak |
| **🟡 P3** | Redis init sebelum `dotenv.config()` | redis.adapter.ts | Env var belum loaded saat koneksi |
| **🟡 P3** | V2 path bisa kehilangan customer message | conversation.service.ts | Data loss risk |

---

## 🚧 Next Steps yang Direkomendasikan

1. **P0 — Perbaiki circuit breaker double-counting** (issue #1): Hapus `recordFailure()` eksplisit di `message-processor.service.ts:268`.
2. **P0 — Tambahkan optimistic lock / status guard di `transitionOrder`** (issue #2): Tambahkan `orderStatus: fromStatus` di `where` clause update, atau gunakan transaksi dengan `SELECT FOR UPDATE`.
3. **P0 — Unified AI gateway** (issue #4): Pilih `LLMGateway` sebagai satu-satunya gateway, migrasikan semua caller dari `AIProviderManager`.
4. **P1 — Perbaiki health monitor metric corruption** (issue #6): Hapus line 53 di `health-monitor.service.ts`.
5. **P1 — Migrasikan provider-cooldown ke Redis** (issue #3): Ganti in-memory Map dengan Redis SET/EXPIRE.
