# Laporan Audit Read-Only — Task P-PWA.7

**Scope:** HANYA baca & laporkan. Tidak ada edit file source.
**Tanggal:** 2026-08-11
**Status kerja lokal:** `git status` bersih untuk file ter-*track* (tidak ada perubahan tracked). Hanya ada file *untracked* dokumentasi di `DOCS/` yang tidak mengganggu `git diff`/`git diff --stat`.

---

## 1. Mekanisme mutex/lock di message-processor.service.ts (acquireLock, ~line 161)

### Di mana lock dilakukan
`MessageProcessorService` tidak menerapkan lock sendiri. Ia **memanggil** `messageQueueService.acquireLock(...)`:

**`apps/api/src/services/message-processor.service.ts:161`**
```ts
    // 5. Mutex lock per chat — prevent concurrent processing
    const release = messageQueueService.acquireLock(chatId);
    if (!release) {
      adapters.logger.debug('Chat locked, skipping', { chatId });
      return null;
    }
```

`chatId` berasal dari `input.conversationId` (definisi 1 langkah di atas):

**`apps/api/src/services/message-processor.service.ts:96-98`**
```ts
  async processMessage(input: ProcessMessageInput): Promise<ProcessedResult | null> {
    const startTime = Date.now();
    const chatId = input.conversationId;
```

Lock yang sama juga dipakai oleh *flush handler* (jalur *coalescing buffer*):

**`apps/api/src/services/message-processor.service.ts:181`**
```ts
    const release = messageQueueService.acquireLock(chatId);
    if (!release) {
      adapters.logger.debug('Chat locked when processing flushed batch', { chatId });
      return;
    }
```

### Implementasi acquireLock
Didefinisikan di `MessageQueueService` (bukan di `MessageProcessorService`):

**`apps/api/src/services/message-queue.service.ts:152` (state) dan `166-176` (method)**
```ts
  private processingLocks: Map<string, boolean> = new Map();
  ...
  /** Acquire mutex for a chat — returns release function or null if locked */
  acquireLock(chatId: string): (() => void) | null {
    const key = `lock:${chatId}`;
    if (this.processingLocks.get(key)) {
      return null; // sedang diproses
    }
    this.processingLocks.set(key, true);
    return () => {
      this.processingLocks.delete(key);
    };
  }
```

### Fakta teknis
- **In-memory Map, bukan Redis.** State lock adalah `private processingLocks: Map<string, boolean>` (line 152). `grep -in "redis" apps/api/src/services/message-queue.service.ts` → **tidak ada referensi Redis/Redis adapter** di file ini (`redis.adapter.ts` ada di `apps/api/src/adapters/ai/...`, tidak dipakai lock). Catatan: header file (line 5) menyebut "Set-based" padahal implementasinya pakai `Map<string, boolean>` — ada diskrepansi komentar vs kode.
- **Key lock:** `lock:${chatId}` (line 168), dimana `chatId` = `input.conversationId` (lihat di atas). Jadi secara praktis lock **dikunci per `conversationId`** (dinamai juga `chatId` di kode).
- **Tidak ada mekanisme expiry/lock TTL.** Setelah `acquireLock` mengembalikan release fn, lock hanya lepas ketika release fn dipanggil di blok `finally` (line 169-171):
  ```ts
    try {
      return await this.processWithLock(chatId, { ...queued }, input);
    } finally {
      release();
    }
  ```
- **Statistik** `getStats()` (line 397-412) menghitung `activeLocks` dari `this.processingLocks.size`.
- **`acquireLock` diekspor via singleton instance**, bukan langsung sebagai fungsi utility:
  **`apps/api/src/services/message-queue.service.ts:415`**
  ```ts
  export const messageQueueService = new MessageQueueService();
  ```

### Bolehkah dipanggil dari luar? (reusable?)
`acquireLock` adalah **public method** (tidak ada modifier `private`) pada **class `MessageQueueService`** yang diekspor, dan class ini di-instance-kan menjadi singleton `messageQueueService` (line 415). `MessageProcessorService` dan panggil lain cukup `import { messageQueueService }` lalu panggil `messageQueueService.acquireLock(chatId)`.

- **Bukan** private method di dalam `MessageProcessorService` → tidak tertutup dalam class itu.
- **Tapi juga bukan** fungsi utility *standalone* yang diekspor (mis. `export function acquireChatLock(...)`). Ia **method pada singleton instance** yang terikat state in-memory `processingLocks` milik instance itu.

**Verdik: sudah reusable** — `acquireLock` sudah dapat dipanggil dari modul luar melalui singleton `messageQueueService` (public method, exported). Namun ia **bukan** utility fungsi bebas; ia terikat pada instance singleton dan state Map in-memory-nya. (Fakta saja, tanpa saran desain.)

---

## 2. Fallback `customerPhone: customerId` (conversation.service.ts:75)

### Kode di sekitar line 75
**`apps/api/src/business/conversation.service.ts:68-79`**
```ts
    const conversation = await prisma.conversation.upsert({
      where: { id: conversationId },
      update: {},
      create: {
        id: conversationId,
        storeId: storeId,
        customerId: customerId,
        customerPhone: customerId, // Fallback nilai phone dengan customerId
        channel,
        status: 'open',
      },
    });
```

Signature `processCustomerMessage` — **tidak ada parameter `customerPhone`**:

**`apps/api/src/business/conversation.service.ts:59-65`**
```ts
  async processCustomerMessage(
    storeId: string,
    customerId: string,
    conversationId: string,
    customerMessage: string,
    channel: 'whatsapp' | 'web' = 'whatsapp',
  ): Promise<ResponseResult | null> {
```

### Trace: apakah `customerPhone` terisi dengan webUid bila `channel='web'`?
Ya. Langkah fakta:

1. `processCustomerMessage()` **tidak menerima** parameter `customerPhone` (lihat signature di atas). Jadi di dalam body, satu-satunya nilai yang tersedia adalah `customerId`.
2. Di line 75, pada cabang `create` (upsert membuat baru karena conversation belum ada), `customerPhone: customerId` — artinya `customerPhone` **selalu berisi nilai `customerId`** pada pembuatan percakapan pertama.
3. Caller utama di dalam *pipeline* (`message-processor.service.ts:256-263`) **tidak meneruskan** `input.customerPhone` ke `processCustomerMessage`; ia hanya meneruskan 5 argumen berikut:
   **`apps/api/src/services/message-processor.service.ts:256-263`**
   ```ts
   result = await this.llmCircuitBreaker.wrap(() =>
     conversationService.processCustomerMessage(
       input.storeId,
       input.customerId,
       input.conversationId,
       msg.content,
       channel
     )
   );
   ```
   Artinya `input.customerPhone` (yang memang ada di `ProcessMessageInput`, lihat `message-processor.service.ts:48`) **tidak pernah sampai** ke `processCustomerMessage`, jadi tidak ada cara bagi method ini "melihat" nomor telepon asli WA pun. Ia bergantung nilainya pada `customerId`.

4. Akibatnya, **untuk `channel='web'` bila `customerId` = `webUid`** (bukan nomor telepon asli), pada `create` upsert line 75 **`customerPhone` memang akan terisi dengan `webUid`** — karena inilah satu-satunya nilai yang dipakai. Jadi jawaban atas pertanyaan: **YA**, baris 75 akan mengisi `customerPhone` dengan nilai `webUid`.

   Konteks tambahan: untuk channel `whatsapp`, `customerId` memang di-set sama dengan nomor telepon (lihat `webhooks.ts:104` `customerId: customerPhone` dan `webhooks.ts:263` `customerId: customerPhone`), sehingga fallback `customerPhone: customerId` secara kebetulan sesuai. Untuk `web`, `customerId` = `webUid`, jadi fallback ini menaruh `webUid` ke kolom `customerPhone`.

5. `update: {}` (line 70) berarti pada pemanggilan *berikutnya* (conversation sudah ada), upsert tidak menulis ulang `customerPhone` — nilainya persisten dari `create` pertama kali.

### Logic LAIN di file yang SAMA yang membaca `customerPhone`?
Pencarian `grep -in "phone" apps/api/src/business/conversation.service.ts` → hanya 6 baris (41, 75, 1176, 1184, 1278, 1326, 1357). Rangkuman semua referensi `customerPhone` di dalam file ini:

- **Line 41** — deklarasi tipe `interface ConversationListItem`: `customerPhone: string | null;` (hanya tipe).
- **Line 75** — fallback `customerPhone: customerId` (di bahas).
- **Line 1176 & 1184** — method `createConversation(...)` (terpisah, **tidak** dipanggil oleh `processCustomerMessage`) yang menerima `customerPhone: string` sebagai parameter dan memakainya saat `prisma.conversation.create`.
- **Line 1278** — `customerPhone: conv.customerPhone,` di `mapConversationWithContext()` (membaca dari row DB, meneruskan ke output `ConversationWithContext`).
- **Line 1326** — `customerPhone: true,` di `select` `findAllByStore()`.
- **Line 1357** — `customerPhone: conv.customerPhone,` di `findByIdWithHistory()` (membaca dari row DB, meneruskan ke output).

**Jawaban: tidak ada.** Di dalam `conversation.service.ts` sendiri, `customerPhone` **tidak pernah dipakai untuk matching/lookup**. Satu-satunya pembacaannya (line 1278, 1326, 1357) hanyalah: memilih kolom, dan meneruskan (memetakan) nilai yang sudah tersimpan ke struktur output. Tidak ada query/lookup berdasarkan `customerPhone` di dalam file ini, sehingga isi `customerPhone = webUid` tidak langsung menyebabkan *perilaku salah* di dalam file inihalaman pembacaannya hanyat propagasi. (Perlu dicatat faktanya saja: nilai ini tetap konsumsi ke file lain melalui `ProcessMessageInput`/`input.customerPhone`, tapi itu di luar file yang sama — lihat `message-processor.service.ts:333, 356, 383, 415, 423, 431, 443, 451` yang memakai `input.customerPhone` untuk send/markRead/retry — tidak di bahas di sini karena scope "file yang sama".)

---

## 3. Apakah `processCustomerMessage()` punya cara untuk eksplisit mengirim `customerPhone: null` (web, lewati fallback)?

**Tidak ada.** Fakta:

- Signature method (line 59-65) hanya memiliki parameter `storeId, customerId, conversationId, customerMessage, channel`. **Tidak ada parameter `customerPhone`** (baik eksplisit maupun nullable).
- Di dalam body, tidak ada cabang/logika perbedaan channel `whatsapp` vs `web` untuk `customerPhone`. Fallback `customerPhone: customerId` (line 75) **selalu dieksekusi pada `create`** secara tunggal; tidak ada kode yang mengabaikannya (`null`) untuk channel web.
- Semua situs pemanggilan (3 situs) **tidak pernah meneruskan** `customerPhone`:
  - `apps/api/src/services/message-processor.service.ts:257` → 5 argumen, tidak ada `customerPhone`. (Meski `input.customerPhone` tersedia di sini, lihat line 48, tetap tidak diteruskan — seperti ditunjukkan point 2.)
  - `apps/api/src/routes/messages.ts:39` → 4 argumen (`storeId, customerId, conversationId, message`), tidak ada `customerPhone`.
  - `apps/api/src/tests/golden-dataset.test.ts:235` → 4 argumen, tidak ada `customerPhone`.
- `update: {}` (line 70) tidak menyertakan `customerPhone`, jadi juga tidak ada mekanisme *set* `null` pada path update maupun create.

**Jawaban: signature saat ini tidak memiliki jalan untuk mengirim `customerPhone: null` (atapiunomor telepon asli) untuk channel web.** Fallback `customerPhone: customerId` (line 75) adalah satu-satunya penulisan, dan selalu terpaksa dipaksakan ketika conversation dibuat baru — tanpa modifikasi kode tidak ada cara untuk lewatinya.

---

## Ringkasan fakta kunci (tanpa rekomendasi desain)

| Poin | Temuan fakta | Lokasi (file:line) |
|------|--------------|--------------------|
| 1 | `acquireLock` = **public method** `MessageQueueService`, state in-memory `Map<string, boolean>` (bukan Redis); key lock `lock:${chatId}` dengan `chatId = conversationId`; diekspor lewat singleton `messageQueueService` | `message-queue.service.ts:152, 166-176, 415`; `message-processor.service.ts:96-98, 161, 181` |
| 1 | Verdik: **sudah reusable** (bisa dipanggil dari luar lewat singleton), tapi bukan fungsi utility bebas — method pada singleton instance | — |
| 2 | `processCustomerMessage` tidak terima param `customerPhone`; line 75 menulis `customerPhone: customerId`. Untuk web, `customerId` = `webUid` → `customerPhone` = `webUid` pada create | `conversation.service.ts:59-65, 68-79 (line 75)`; pemanggil tidak meneruskan `customerPhone` | `message-processor.service.ts:256-263` |
| 2 | Di file yang sama, `customerPhone` tidak dipakai matching/lookup; hanya propgate/select (line 1278, 1326, 1357) + `createConversation` terpisah (1176, 1184) | `conversation.service.ts` |
| 3 | Tidak ada parameter/cara untuk kirim `customerPhone: null` lewat `processCustomerMessage`; fallback `customerId` tidak dapat dilewati tanpa edit kode | `conversation.service.ts:59-65, 68-79`; pemanggil semua 3 tidak meneruskan | `conversation.service.ts:256-263`; `routes/messages.ts:39`; `tests/golden-dataset.test.ts:235` |
