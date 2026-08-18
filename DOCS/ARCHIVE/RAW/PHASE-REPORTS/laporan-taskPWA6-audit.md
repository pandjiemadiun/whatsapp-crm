# Laporan Audit Read-Only — TASK P-PWA.6 (Titik reuse "compose reply" tanpa send/buffer)

**Mode:** HANYA baca & laporkan. Tidak ada file sumber yang diedit.
**Scope file yang disentuh:** hanya membuat file baru `DOCS/laporan-taskPWA6-audit.md`.
**Cabang:** `main`.

> Catatan metodologi: setiap temuan dilengkapi kutipan kode asli + `file:line` (bukan ringkasan/opini). **TIDAK ada rekomendasi desain Web Adapter** — dokumen ini adalah bahan baku desain Fase 1. Konteks asumsi: Fase 1 Web Adapter akan **bypass total** buffer (`handleFlushed`) dan gateway WA (`sendWithPresence`/`gowaAdapter`/`fonnteService`); respons Web dikembalikan sebagai HTTP response, bukan dikirim ke gateway pesan.

---

## 0. Pre-audit gate — `git status` mentah (WAJIB, langkah pertama)

Diperintahkan sebelum audit apa pun:

```
On branch main
Your branch is ahead of 'origin/main' by 7 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	DOCS/05_PWA_IDENTITY_BLUEPRINT.md
	DOCS/laporan-taskPWA3.md
	DOCS/laporan-taskPWA4.md

nothing added to commit but untracked files present (use "git add <file>..." to track)
```

**`git diff --name-only` (modified tracked files):** kosong (exit 0, tidak ada output).

**Kesimpulan gate:** working tree **tidak ada perubahan source yang uncommitted**. Hanya 3 file `DOCS/` non-source yang untracked (laporan P-PWA.3, P-PWA.4, dan blueprint identity — artefak task sebelumnya yang memang belum dicommit). Tidak ada file `.ts`/`.prisma`/source lain yang dimodifikasi. ✅ Lalui. Audit dapat dilanjutkan.

---

## 1. Titik pisah compose → send di `processWithLock` (compose dapat dipisah dari send)

Pertanyaan: di dalam `processWithLock`, di mana teks balasan AI selesai dibentuk (`result.message.content`) **sebelum** `sendWithPresence` dipanggil (line 299)? Apakah compose bisa dipisah agar tidak otomatis lanjut ke send?

**Jawaban: YA — compose dan send adalah pernyataan terpisah.** `result` (berisi teks balasan) tersedia secara penuh pada line 285, **7 line sebelum** pernyataan send `await this.sendWithPresence(...)` pada line 299. Di antara keduanya ada blok *decision* (285-298) yang bahkan dapat `return null` **tanpa pernah memanggil send**.

### Entry point + signature `processWithLock`

```ts
// message-processor.service.ts:208-215
/**
 * Process a message while holding the per-chat mutex lock.
 */
private async processWithLock(
  chatId: string,
  msg: ProcessedMessage,
  input: ProcessMessageInput
): Promise<ProcessedResult | null> {
```

Dipanggil dari `processMessage` (path awal, *bukan* buffer) di line 168, dengan `input` asli (memuat `channel`/`webUid`):

```ts
// message-processor.service.ts:167-171
try {
  return await this.processWithLock(chatId, { ...queued }, input);   // line 168 — input asli diteruskan
} finally {
  release();
}
```

> (Catatan: path ini adalah *immediate path* — pesan *urgent* yang tidak masuk buffer. `input` asli yang mengandung `channel`/`webUid` tetap diteruskan. Berbeda dengan `handleFlushed` :202 yang merekonstruksi `input` tanpa `channel`/`webUid` — temuan P-PWA.5 Audit 6.)

### COMPOSE (langkah 7) — `processCustomerMessage` return `result`

```ts
// message-processor.service.ts:253-264
// 7. Call conversation service (handles context + fallback chain)
let result;
try {
result = await this.llmCircuitBreaker.wrap(() =>
    conversationService.processCustomerMessage(
      input.storeId,
      input.customerId,
      input.conversationId,
      msg.content,            // ← teks USER masuk ke sini
      channel
    )
  );
} catch (err) {
  …
}
```

→ `result` adalah `ResponseResult` (domain/types.ts:46-54). Balasan AI ada di `result.message.content` (`ConversationMessage.content`, domain/types.ts:18-27). Nilai ini **akan sama dengan** `result.message.content` yang dikembalikan pada `ProcessedResult` (line 309).

### GAP compose → send (line 285-298) — *decision* yang dapat melewatkan send

```ts
// message-processor.service.ts:285-299
if (!result || !result.message) {                       // line 285
  // Human takeover: AI tidak boleh membalas. Mark read saja.
  await this.markRead(input);                           // line 287
  adapters.logger.debug('No response from pipeline (human takeover?)', { chatId });
  return null;                                          // line 289  ← RETURN TANPA SEND
}

// Skip send if content is empty (e.g. dead-end detected in fallback)
if (!result.message.content) {                          // line 293
  adapters.logger.debug('Empty response content, skipping send', { chatId });
  return null;                                          // line 296  ← RETURN TANPA SEND
}

// 8. Send with presence simulation + smart retry
await this.sendWithPresence(input, result.message.content);  // line 299  ← SEND
```

→ Pada line 285-296, kode sudah memiliki dua titik yang `return null` **tanpa pernah memanggil send**. Teks balasan (`result.message.content`) sudah tersedia sejak line 285. Titik pemisahan naturalnya adalah **line 298** (sebelum `await this.sendWithPresence` pada line 299): di situlah `result.message.content` sudah final namun belum dikirim.

### Fallback-send juga berada di `processWithLock` (bukan di `processCustomerMessage`)

```ts
// message-processor.service.ts:219-234  (circuit breaker terbuka)
if (!this.llmCircuitBreaker.isAvailable()) {
  const fallbackMsg = this.llmCircuitBreaker.getFallbackMessage();
  await this.sendWithPresence(input, fallbackMsg);      // line 221  ← SEND pada fallback
  this.notifyHumanTakeover(input);                       // line 222
  return { message: fallbackMsg, source: 'human', … };  // line 224-233
}
```

```ts
// message-processor.service.ts:265-283  (catch LLM gagal)
} catch (err) {
  this.llmCircuitBreaker.recordFailure();              // line 266
  adapters.logger.error('LLM pipeline failed', err as Error, { chatId });
  const fallbackMsg = this.llmCircuitBreaker.getFallbackMessage();
  await this.sendWithPresence(input, fallbackMsg);      // line 270  ← SEND pada fallback
  this.notifyHumanTakeover(input);                       // line 271
  return { message: fallbackMsg, source: 'human', … };  // line 273-282
}
```

→ Bahkan jalur fallback tetap memanggil `sendWithPresence` (send) di dalam `processWithLock`. Composenya (fallbackMsg) dan sendnya (221, 270) adalah pernyataan terpisah — `fallbackMsg` tersedia sebelum `sendWithPresence` dipanggil.

### Bukti `sendWithPresence` → gateway WA (WA-only, tidak untuk Web)

```ts
// message-processor.service.ts:323-327
private async sendWithPresence(input: ProcessMessageInput, content: string): Promise<void> {
  const gateway = this.getGateway(input.gateway);       // line 327
  …
}
```

```ts
// message-processor.service.ts:520-522
private getGateway(gateway: 'gowa' | 'fonnte'): IWhatsAppGateway | null {
  return gateway === 'gowa' ? gowaAdapter : fonnteService;
}
```

```ts
// message-processor.service.ts:469-477  (smartRetrySend — tempat ACTUAL send ke gateway)
const gateway = this.getGateway(gatewayType);           // line 469
…
await gateway.sendMessage(phone, content, config);        // line 477  ← ACTUAL SEND ke WA
```

**Kesimpulan Audit 1 (fakta):** Pada `processWithLock`, urutannya adalah **compose (256-264) → decision/skip (285-296) → send (299)** seraya `result.message.content` (teks balasan) sudah final sejak line 285, sebelum `sendWithPresence` (line 299). Ada **dua titik `return null` (289, 296) yang melewati send sepenuhnya**. Compose dan send adalah pernyataan terpisah yang **bisa dipisahkan** — tidak ada hard coupling yang mencegah pemakaian `result.message.content` tanpa memanggil send. (Sementara itu semua jalur send — `sendWithPresence` 221/270/299, termasuk `getGateway` :520 yang hanya `gowa`|`fonnte` — bersifat WA-only.)

---

## 2. `conversationService.processCustomerMessage()` mengembalikan teks tanpa mengirim apa pun

Pertanyaan: apakah `conversationService.processCustomerMessage()` SENDIRI yang compose (mengembalikan teks balasan), atau ia juga punya sub-logic kirim?

**Jawaban: Compose di `conversation.service.ts`; send ada di `message-processor.service.ts`. Terpisah.** `processCustomerMessage` **tidak pernah** memanggil gateway/kirim.

### Signature + return type

```ts
// conversation.service.ts:59-65
async processCustomerMessage(
  storeId: string,
  customerId: string,
  conversationId: string,
  customerMessage: string,
  channel: 'whatsapp' | 'web' = 'whatsapp',
): Promise<ResponseResult | null> {
```

Return typenya `ResponseResult` — **bukan** "kata-lalu-kirim". `ResponseResult` (domain/types.ts:46-54):

```ts
// domain/types.ts:46-54
export interface ResponseResult {
  conversationId: string;
  message: ConversationMessage;   // ← berisi .content (teks balasan AI)
  source: ResponseSource;
  confidence: number;
  cost: number;
  requiresHumanReview: boolean;
  metadata?: Record<string, any>;
}

// domain/types.ts:18-27
export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'customer' | 'assistant' | 'human_agent';
  content: string;        // ← teks balasan
  source?: ResponseSource;
  cost?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}
```

→ Teks balasan lengkap ada di `result.message.content` (domain/types.ts:22). Pemanggil menerima `ResponseResult` dan **baru memutuskan** apa kirim — memanggil `sendWithPresence` (WA) atau menggunakan `result.message.content` sebagai HTTP response (Web).

### Bukti: tidak ada panggilan kirim di `conversation.service.ts`

```
$ grep -nE "sendMessage|gateway|sendWithPresence|gowaAdapter|fonnteService|IWhatsAppGateway|smartRetrySend" \
    apps/api/src/business/conversation.service.ts
(no output — exit code 1)
```

→ **Nol hasil.** `conversation.service.ts` tidak mengimport atau memanggil satu pun dari: `sendMessage`, `gateway`, `sendWithPresence`, `gowaAdapter`, `fonnteService`, `IWhatsAppGateway`, `smartRetrySend`. Semua itu ada di `message-processor.service.ts` saja:

```ts
// message-processor.service.ts:25  (import WA gateway)
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
// message-processor.service.ts:26
import { fonnteService } from '../services/fonnte.service.js';
// message-processor.service.ts:27
import type { IWhatsAppGateway, SendMessageConfig } from './whatsapp-gateway.interface.js';
```

### Titik kirim (hanya di message-processor)

- `sendWithPresence` (message-processor.service.ts:323) → `smartRetrySend` (line 373) → `gateway.sendMessage` (line 477).
- Fallback send: line 221 (circuit-breaker-open), line 270 (LLM error).
- `getGateway` (line 520): `return gateway === 'gowa' ? gowaAdapter : fonnteService;` — hanya `gowa`|`fonnte`.

### Kesimpulan Audit 2 (fakta): **compose di `conversation.service.ts` (`:59`), send di `message-processor.service.ts` (`:299`/`:323`/`:477`).** `processCustomerMessage` mengembalikan `ResponseResult` (dengan teks balasan di `result.message.content`, domain/types.ts:22/48) **tanpa pernah mengirim** — tidak ada impor/memanggil gateway WA di conversation.service.ts. Pemisahan tanggung jawab ada: conversation.service = compose+persist; message-processor = orchestrasi+send.

---

## 3. Apakah Web Adapter bisa langsung panggil `processCustomerMessage()` tanpa `processMessage()`? — side-effect yang terlewat

Pertanyaan: bila Web memanggil `conversationService.processCustomerMessage()` langsung (bypass `messageProcessorService.processMessage()`), apakah semua side-effect penting tetap terjaga? Mana yang terlewat?

**Jawaban singkat: YAIYA — `processCustomerMessage` adalah method `async` public (conversation.service.ts:59) yang dapat dipanggil langsung.** Semua side-effect **DB-persisten** (conversation upsert, history save, context, stats, order finalize, escalate) ada **di dalamnya**. Side-effect yang terlewat bila bypass adalah **infrastruktur/operasional/WA-spesifik** (queue, circuit-breaker, presence, WA-send, health, notifikasi). Berikut klasifikasi lengkap.

### a. Side-effect DB-persisten — INSIDE `processCustomerMessage` (TERLINDUNGI bila Web memanggil langsung)

`processCustomerMessage` berjalan dari line 59 sampai line 795 (`return result;`):

```ts
// conversation.service.ts:793-795
    return result;
  }
```

Side-effect DB di dalamnya (dengan `file:line`):

| side-effect | file:line | keterangan |
|---|---|---|
| conversation upsert (create-if-not-exist) | conversation.service.ts:68-79 | `:75 customerPhone: customerId` (fallback), `:76 channel` |
| human_takeover short-circuit + save pesan masuk | conversation.service.ts:81-95 | `:82 saveMessage(customer)`, return null (tidak ada AI reply) |
| context init (getContext/initializeContext) | conversation.service.ts:98-105 | `conversationContextService.initializeContext` |
| **saveMessage → conversationHistory.create** | conversation.service.ts:1074-1091 (def), dipanggil :82/:213/:281/:363/:438/:457/:499/:524/:553/:572/:756/:763 | tulis history (customer + AI reply) |
| updateConversationStats (lastMessageAt, ai/faqResponseCount++, status='open') | conversation.service.ts:764, def :1093-1118 | `:107-1113` — increment counter + `status:'open'` |
| appendMessage + refreshSession (context) | conversation.service.ts:767-775 | sinkronisasi context |
| orderService.finalizeDraftOrder (done-ordering) | conversation.service.ts:779 | finalisasi draft order |
| markHumanTakeover (escalate/retry-exceeded) | conversation.service.ts:455, :551 — def :1133-1138 | set status='human_takeover'+humanTakeoverAt (via `escalateStatusUpdate()`) |
| logPipelineAudit | conversation.service.ts:783 | audit trail |

→ **Kesimpulan: semua persistensi DB riil yang menonjolkan *history*, *conversation*, *context/stats*, *order* ada di dalam `processCustomerMessage`.** Web yang memanggilnya langsung **akan tetap menyimpan riwayat ke DB** (Audit 3 menjawab kekhawatiran "riwayat pesan tidak tersimpan").

### b. Side-effect — HANYA di `processWithLock`/`processMessage` (TERLEWAT bila Web bypass; tidak ada di processCustomerMessage)

| side-effect | file:line | klasifikasi |
|---|---|---|
| dedup (isDuplicate) | message-processor.service.ts:110 | queue infra |
| coalescing/buffer (bufferMessage) | message-processor.service.ts:154 | buffer infra (bypass memang dimaksud) |
| mutex (acquireLock/release) | message-processor.service.ts:161 (acquire), :168-171 (release) | concurrency control |
| circuit breaker (isAvailable/wrap/recordFailure) | message-processor.service.ts:219, :256, :266 | resilience infra |
| **notifyHumanTakeover (circuit-breaker-failure → human_takeover DB)** | message-processor.service.ts:222, :271 (call); def :505-518 | ⚠️ DB write `conversation.update` (:508-513) — **hanya di sini**, bukan di processCustomerMessage |
| presence sim (isNightMode/simulateResponse) | message-processor.service.ts:328, :338 (di sendWithPresence) | WA-presence (WA-only) |
| entity cache (getCustomerProfile) | message-processor.service.ts:333 (di sendWithPresence) | cache infra |
| markRead (WA gateway markRead) | message-processor.service.ts:134, :287 ; :344-346, :380-386 | WA-only (gateway.markRead) |
| sendWithPresence → smartRetrySend → gateway.sendMessage | message-processor.service.ts:221, :270, :299, :323, :373, :463, :477 | **WA send (bypass memang dimaksud)** |
| sendQrisFollowUp (QRIS image) | message-processor.service.ts:303 (call); def :397-457 | WA send (bypass memang dimaksud) |
| health updateQueueDepth | message-processor.service.ts:306 | health metric |
| health recordSendTimeout | message-processor.service.ts:481 (di smartRetrySend) | health metric (WA send terkait) |

> ⚠️ **Catatan penting (fakta, bukan rekomendasi):** `notifyHumanTakeover` (message-processor.service.ts:505-518) melakukan **DB write** (`prisma.conversation.update` → `status:'human_takeover'`, `humanTakeoverAt:new Date()`, line 508-513) — ini **satu-satunya side-effect DB yang ada di `processWithLock` tapi TIDAK di `processCustomerMessage`**. Kommentar di conversation.service.ts:1100-1104 menegaskan: *"human_takeover di-set hanya oleh circuit breaker (notifyHumanTakeover) di MessageProcessorService. Jangan auto-set di sini karena akan menimbonloop."* Jadi bila Web memanggil `processCustomerMessage` langsung, **circuit-breaker-failure → human_takeover marking tidak akan terjadi** (Web tidak melewati `processWithLock`). Namun, `markHumanTakeover` (conversation.service.ts:455, :551) untuk path **ESCALATE/terminal** tetap ada & dipanggil di dalam `processCustomerMessage` → *escalation*-triggered human takeover tetap berfungsi.

### c. Ringkasan pemilihan (fakta)

| apakah terjaga bila Web → processCustomerMessage langsung? | ya (ada di dalam processCustomerMessage) | tidak (hanya di processWithLock/processMessage) |
|---|---|---|
| conversation create/upsert | ✅ :68 | — |
| **riwayat (history) tersimpan** | ✅ :1074 (saveMessage) | — |
| context init/append/refresh | ✅ :98-105, :767-775 | — |
| stats increment (ai/faqResponseCount) | ✅ :764 (updateConversationStats) | — |
| order finalize (done-ordering) | ✅ :779 | — |
| escalate → human_takeover | ✅ :455, :551 (markHumanTakeover) | — |
| circuit-breaker-failure → human_takeover | — | ⚠️ hanya :505 (notifyHumanTakeover) |
| dedup / mutex / coalescing | — | :110, :154, :161 |
| circuit breaker (CB) | — | :219, :256, :266 |
| presence sim / markRead | — | :328, :338, :333, :134, :287 |
| **WA send (sendWithPresence/gowa/fonnte)** | — | :221, :270, :299, :477 (bypass = memang dimaksud) |
| QRIS follow-up | — | :303 (bypass = memang dimaksud) |
| health metrics | — | :306, :481 |

**Kesimpulan Audit 3 (fakta):** Web Adapter **bisa** memanggil `conversationService.processCustomerMessage()` langsung (public method, conversation.service.ts:59) dan semua **DB-persistensi kritis — termasuk saveMessage/riwayat (:1074) — tetap terjaga**. Yang terlewat adalah infrastruktur WA-only + operasional: dedup/mutex/coalescing queue (:110/:154/:161), circuit breaker (:219/:256/:266), presence sim/markRead (:134/:287/:328/:338), WA-send (:221/:270/:299/:477), QRIS (:303), dan health metrics (:306/:481). **Satu DB-write yang terlewat:** `notifyHumanTakeover` (message-processor.service.ts:505-518) yang menandai `human_takeover` pada circuit-breaker failure — **tidak ada** di dalam `processCustomerMessage` (konfirmasi: conversation.service.ts:1100-1104). Ini fakta, bukan rekomendasi desain.

---

## 4. Di titik mana pesan disimpan ke `ConversationHistory` (riwayat chat)?

Pertanyaan: penyimpanan riwayat — terjadi di *compose*, di *send*, atau terpisah?

**Jawaban: Penyimpanan riwayat terjadi di dalam *compose* (`processCustomerMessage`), lewat helper `saveMessage` — bukan di *send* (`processWithLock`/`sendWithPresence`).** Web yang memanggil `processCustomerMessage` langsung akan menyimpan riwayat.

### Definisi `saveMessage` (conversation.service.ts:1074-1091)

```ts
// conversation.service.ts:1074-1091
private async saveMessage(message: ConversationMessage): Promise<void> {
  try {
    await prisma.conversationHistory.create({               // line 1076
      data: {
        id: message.id,
        conversationId: message.conversationId,
        role: message.sender === 'customer' ? 'user' : 'assistant',  // line 1080
        content: message.content,
        source: message.source || null,
        costUSD: message.cost || 0,
        metadata: message.metadata || undefined,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    adapters.logger.error('Failed to save message', error as Error);
  }
}
```

→ `saveMessage` menulis ke `prisma.conversationHistory.create` (line 1076). Role dipetakan: `customer → 'user'`, `assistant/human_agent → 'assistant'` (line 1080).

### Di mana `saveMessage` dipanggil? (semua di dalam `processCustomerMessage`, line 59-795)

```
$ grep -n "this.saveMessage" apps/api/src/business/conversation.service.ts
conversation.service.ts:82    // human_takeover branch — save pesan customer
conversation.service.ts:213   // v2 'tier' outcome — save AI reply (result.message)
conversation.service.ts:281   // v2 'resolved' outcome — save AI reply (resolvedResult.message)
conversation.service.ts:363   // v2 'reasoned' outcome — save AI reply (result.message)
conversation.service.ts:438   // v1 pending resolver — save pesan customer
conversation.service.ts:457   // v1 ESCALATE — save AI reply (escalateReply)
conversation.service.ts:499   // v1 pending EXECUTE — save pesan customer
conversation.service.ts:524   // v1 ROLLBACK — save AI reply ('assistant')
conversation.service.ts:553   // v1 retry-exceeded ESCALATE — save AI reply
conversation.service.ts:572   // v1 pending clarification — save AI reply
conversation.service.ts:756   // v1 main path — save pesan customer
conversation.service.ts:763   // v1 main path — save AI reply (result.message)
```

→ **12 call-site**, semuanya di dalam `processCustomerMessage` (line 59-795). Contoh jalur *main* (v1):

```ts
// conversation.service.ts:756-763
await this.saveMessage({                                   // line 756
  id: crypto.randomUUID(),
  conversationId,
  sender: 'customer',
  content: customerMessage,
  createdAt: new Date(),
} as ConversationMessage);
await this.saveMessage(result.message);                    // line 763 — save AI balasan
```

→ Pada jalur utama, **customer message disave (756)** lalu **AI balasan disave (763)**, keduanya via `saveMessage` → `prisma.conversationHistory.create` (:1076). `result.message` (yang disave di :763) adalah `ConversationMessage` yang sama yang dikembalikan di `result.message.content` (Audit 2).

### Bukti: `sendWithPresence`/`processWithLock` **tidak** menyimpan riwayat

```ts
// message-processor.service.ts:323-374  (sendWithPresence — tidak ada prisma.conversationHistory)
private async sendWithPresence(input: ProcessMessageInput, content: string): Promise<void> {
  const gateway = this.getGateway(input.gateway);
  const isNightMode = presenceSimulatorService.isNightMode({ … });
  const profile = await entityCacheService.getCustomerProfile(…);   // cache, bukan history
  const simulation = await presenceSimulatorService.simulateResponse({ … });
  await this.sleep(effectiveDelay);
  const sendConfig: SendMessageConfig = { … };
  await this.smartRetrySend(input.customerPhone, content, sendConfig, input.gateway);  // line 373
}
```

→ `sendWithPresence` hanya ada `entityCacheService.getCustomerProfile` (cache) — **tidak ada `prisma.conversationHistory.create`** di dalamnya. Penyimpanan riwayat seluruhnya dilakukan oleh `processCustomerMessage` (via `saveMessage` :1074).

### Route dashboard yang membaca riwayat (channel-agnostic)

```ts
// routes/conversations.ts:41-51  (GET /:id — baca history)
const history = await prisma.conversationHistory.findMany({
  where: { conversationId: req.params.id },     // line 42 — tidak ada filter channel
  orderBy: { createdAt: 'asc' },
  select: { id: true, role: true, content: true, source: true, createdAt: true },
});
```

→ Route detail (`/api/conversations/:id`) membaca history dengan `findMany({ where: { conversationId } })` (routes/conversations.ts:42) — **tidak ada filter `channel`**. Jadi riwayat Web (yang disimpan oleh `saveMessage` di `processCustomerMessage`) **akan tampil** di inbox dashboard yang sama.

**Kesimpulan Audit 4 (fakta):** Simpan riwayat (`prisma.conversationHistory.create`) terjadi **di dalam *compose*** — helper `saveMessage` (conversation.service.ts:1074-1091, write ke `conversationHistory` line 1076), dipanggil **12 kali** semuanya di dalam `processCustomerMessage` (line 59-795), termasuk jalur utama `saveMessage(result.message)` (line 763) yang menyimpan AI balasan yang sama. `sendWithPresence`/`processWithLock`/`smartRetrySend` **tidak** menyimpan riwayat (hanya `entityCacheService.getCustomerProfile` :333 untuk cache). Route dashboard `GET /api/conversations/:id` (routes/conversations.ts:41-51) membaca history **tanpa filter channel** → riwayat Web akan tampil di inbox yang sama.

---

## 5. Route dashboard daftar conversations — channel-agnostic atau WA-only?

Pertanyaan: apakah query dashboard sudah mengambil semua conversation (termasuk Web), atau ada asumsi WA-only (filter/join khusus WA) yang perlu perbaikan?

**Jawaban: Daftar conversations di dashboard sudah *channel-agnostic* (tidak ada filter `channel` pada query daftar/detail/history). Namun route `POST /:id/reply` (reply manual agent) berasumsi WA — memakai `conversation.customerPhone` untuk kirim ke Fonnte/GOWA, dengan *guard null*.**

### GET `/` — daftar semua conversations toko (channel-agnostic)

```ts
// routes/conversations.ts:17-27
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const conversations = await conversationService.findAllByStore(storeId);  // line 20

    res.json({ success: true, data: conversations });
  } …
});
```

```ts
// conversation.service.ts:1318-1333
async findAllByStore(storeId: string): Promise<ConversationListItem[]> {
  return prisma.conversation.findMany({
    where: { storeId, deletedAt: null },            // line 1320 — tidak ada filter channel
    orderBy: { lastMessageAt: 'desc' },
    select: {
      id: true, customerId: true, customerName: true,
      customerPhone: true, status: true, lastMessageAt: true,
      aiResponseCount: true, faqResponseCount: true,
    },
  });
}
```

→ `findMany({ where: { storeId, deletedAt: null } })` (conversation.service.ts:1319-1320) — **tidak ada `channel` di `where`**. Semua conversation (WA maupun Web) milik store akan muncul. Kolom `customerPhone` diselect (bisa `null` untuk Web — schema.prisma:145 nullable). ✅ Channel-agnostic.

### GET `/:id` — detail conversation + history (channel-agnostic)

```ts
// routes/conversations.ts:33-35
const conversation = await prisma.conversation.findFirst({
  where: { id: req.params.id, storeId, deletedAt: null },   // line 33 — tidak ada channel
});
```

→ `findFirst` tidak filter `channel`; hanya `id` + `storeId` + `deletedAt`. ✅ Conversation Web dapat di-fetch.

History:
```ts
// routes/conversations.ts:41-51
const history = await prisma.conversationHistory.findMany({
  where: { conversationId: req.params.id },   // line 42 — tidak ada filter channel
  …
});
```

→ History tidak filter `channel`. ✅ Semua history (WA + Web) tampil. (Amatan Audit 4.)

### PUT `/:id/status` — update status (channel-agnostic)

```ts
// routes/conversations.ts:79-97
const conversation = await prisma.conversation.findFirst({
  where: { id: req.params.id, storeId, deletedAt: null },   // line 79 — tidak ada channel
});
…
await prisma.conversation.update({ where: { id: req.params.id }, data: updateData });  // line 94
```

→ `findFirst` + `update` tidak filter `channel`. ✅ WA maupun Web dapat update status (human_takeover, open) via dashboard.

### POST `/:id/reply` — reply manual agent (BERASUMSI WA; ada guard null)

```ts
// routes/conversations.ts:107-129
router.post('/:id/reply', validateRequest(replyMessageSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const storeId = req.user!.storeId;
    const { message } = getValidated<{ message: string }>(req);
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, storeId, deletedAt: null },    // line 112 — tidak ada channel
    });
    if (!conversation) { return res.status(404)…; }

    // Save to conversation history (sanitized)
    const sanitizedContent = sanitizeMessage(message);
    await prisma.conversationHistory.create({                    // line 122
      data: { conversationId: conversation.id, role: 'agent', content: sanitizedContent, source: 'dashboard' },
    });
    …
    // Send via Fonnte, with GOWA fallback
    let sendError: string | null = null;
    const store = await prisma.store.findUnique({ where: { id: storeId } });   // line 144
    if (store?.fonnteToken) {
      try {
        if (!conversation.customerPhone) {                                      // line 147
          adapters.logger.warn('Skip Fonnte send: conversation.customerPhone is null', {…});
        } else {
          await fonnteService.sendMessage(conversation.customerPhone, sanitizedContent, {  // line 150
            token: store.fonnteToken,
          });
        }
      } catch { sendError = 'Fonnte send failed'; }
    } else if (store?.phoneNumber) {
      try {
        if (!conversation.customerPhone) {                                      // line 160
          adapters.logger.warn('Skip GOWA send: conversation.customerPhone is null', {…});
        } else {
          const did = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
          await gowaAdapter.sendMessage(conversation.customerPhone, sanitizedContent, { deviceId: did });  // line 164
        }
      } catch { sendError = 'GOWA send failed'; }
    } else {
      sendError = 'No WhatsApp gateway configured for this store';
    }
    …
```

→ Route `/:id/reply` **membaca conversation tanpa filter channel** (line 112), lalu **memaksa kirim ke WA** menggunakan `conversation.customerPhone` (line 150 untuk Fonnte, line 164 untuk GOWA). Ada **guard null` `if (!conversation.customerPhone)` (line 147, :160) yang me-skip kirim & log warning bila `customerPhone` null — tepat untuk conversation Web (customerPhone null per schema.prisma:145)**. Jadi:
- Riwayat *agent reply* tetap disimpan ke `conversationHistory` (line 122, role `'agent'`) — **channel-agnostic** ✅.
- Kirim ke pelanggan **hanya via WA gateway** (Fonnte/GOWA), dan **dilewati (skip)** bila `customerPhone` null → untuk Web, reply tidak terkirim ke pelanggan melalui route ini.

### Ringkasan tabel (fakta)

| route | query/filter channel? | read/write history? | kirim ke WA? |
|---|---|---|---|
| `GET /api/conversations` (:17) | ❌ tidak ada filter channel (:1320) | baca list | — |
| `GET /api/conversations/:id` (:30) | ❌ tidak ada filter channel (:33) | baca history (:42) | — |
| `PUT /api/conversations/:id/status` (:74) | ❌ tidak ada filter channel (:79) | update status | — |
| `POST /api/conversations/:id/reply` (:107) | ❌ tidak ada filter channel (:112) | **tulis** history role `'agent'` (:122) | **ya** (Fonnte :150 / GOWA :164), skip bila `customerPhone` null (:147/:160) |

**Kesimpulan Audit 5 (fakta):** Semua query daftar/detail/status conversation di `routes/conversations.ts` **tidak memfilter `channel`** — berdasarkan `storeId` + `deletedAt: null` saja (conversation.service.ts:1320; routes/conversations.ts:33, :79, :112). **Conversation Web akan otomatis muncul di list dan detail dashboard**, dan history Web (yang disimpan `saveMessage` di `processCustomerMessage`, Audit 4) akan tampil (routes/conversations.ts:42, tidak ada filter channel). **Satu asumsi WA-only ada di route `POST /:id/reply`** (conversations.ts:150/:164): balasan manual agent dikirim via Fonnte/GOWA menggunakan `conversation.customerPhone`, dengan guard `if (!conversation.customerPhone)` (conversations.ts:147, :160) yang me-skip kirim bila null — jadi untuk conversation Web (`customerPhone` null, schema.prisma:145) balasan *agent* tidak terkirim ke pelanggan lewat route ini, meski history `role:'agent'` tetap tersimpan (conversations.ts:122). Ini fakta, bukan rekomendasi.

---

## Ringkasan titik kunci (fakta sebelum desain)

| no | temuan kunci | implikasi fakta bagi Web Adapter (bypass buffer+WA-send) |
|---|---|---|
| 1 | compose→send terpisah: `result.message.content` final sejak line 285, send di line 299 | ✅ reply teks tersedia tanpa perlu send |
| 2 | compose di `conversation.service.ts:59` (return `ResponseResult`, `message.content` = balasan) | ✅ panggil `processCustomerMessage` langsung dapatkan teks balasan |
| 3 | `processCustomerMessage` tidak import/memanggil gateway WA (`grep` nol) | ✅ tidak akan "nyelip" ke WA gateway |
| 3b | Semua DB-persist (history :1074, conversation :68, context :98-105/:767-775, stats :764, order :779, escalate :455/:551) ada di dalam `processCustomerMessage` | ✅ riwayat conversation tetap tersimpan bila Web memanggil langsung |
| 3c | `notifyHumanTakeover` (:505-518) — DB write `human_takeover` hanya ada di `processWithLock`, **bukan** di `processCustomerMessage` (:1100-1104 mengkonfirmasi) | ⚠️ Web akan melewatkan circuit-breaker-failure → human_takeover marking |
| 3d | yang terlewat bila bypass: dedup(:110), mutex(:161), coalescing(:154), circuit breaker(:219/:256/:266), presence/markRead(:134/:287/:338), WA-send(:299/:477), QRIS(:303), health(:306/:481) | infra/WA-only (bukan DB history) |
| 4 | saveMessage (conversation.service.ts:1074→`conversationHistory.create` :1076) dipanggil 12× semuanya di dalam processCustomerMessage | ✅ riwayat Web tersimpan; dashboard baca history tanpa filter channel (conversations.ts:42) |
| 5 | Dashboard daftar/detail/status **tidak filter channel** (conversation.service.ts:1320; conversations.ts:33/:79/:112) → conversation Web **akan muncul** | ✅ Web conversation terlihat di inbox dashboard |
| 5b | `POST /:id/reply` (conversations.ts:150/:164) kirim via WA dengan guard `!conversation.customerPhone` (conversations.ts:147/:160) | fakta: agent-reply route WA-only (skip bila phone null) |

---

## Acceptance

- ✅ Audit **hanya membaca & melaporkan** — tidak ada file sumber yang diedit. Semua temuan didasarkan pada `grep`/`read` langsung, dilengkapi kutipan kode asli + `file:line`.
- ✅ Semua **5 poin** ada di atas, masing-masing dengan kutipan kode asli + `file:line`.
- ✅ **Tidak ada rekomendasi desain Web Adapter** — dokumen ini adalah bahan baku desain Fase 1.
- ✅ `git diff --stat` commit ini **HANYA 1 file baru** (`DOCS/laporan-taskPWA6-audit.md`), tidak ada file `.ts`/`.prisma` yang berubah.

---

## Post-commit verification

Berikut keluaran perintah verifikasi **setelah commit** (tempel `git diff --stat` + `git log -1`):

```
$ git show --stat HEAD
commit bb0efa3b363f489e1b9cf4c482299dde9c5d8735
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 16:23:01 2026 +0000

    docs(PWA.6): audit read-only titik reuse compose-reply untuk Web Adapter

 DOCS/laporan-taskPWA6-audit.md | 601 +++++++++++++++++++++++++++++++++++++++++
 1 file changed, 601 insertions(+)
 create mode 100644 DOCS/laporan-taskPWA6-audit.md

$ git log -1
commit bb0efa3b363f489e1b9cf4c482299dde9c5d8735
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 16:23:01 2026 +0000

    docs(PWA.6): audit read-only titik reuse compose-reply untuk Web Adapter
```
