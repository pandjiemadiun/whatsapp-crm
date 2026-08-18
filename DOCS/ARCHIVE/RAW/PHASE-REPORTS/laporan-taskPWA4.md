# Laporan TASK P-PWA.4 — Hapus hardcode `channel` + validasi app-level (WA: customerPhone, Web: webUid)

Scope: **hanya logic channel** pada jalur create Conversation — `schema.prisma`/migration **tidak disentuh** (sudah selesai P-PWA.3). Tidak ada endpoint/route/UI/web-adapter baru (Fase 1). Berdasarkan desain yang **disetujui owner** (jawaban P-PWA.4):

- **(b)** hapus hardcode *di sumber asli*: `ProcessMessageInput` + field `channel`/`webUid`, `webhooks.ts` kirim `'whatsapp'` eksplisit, `conversation.service.ts` pakai param `channel` (default `'whatsapp'`).
- **(2-b)** validasi berada **sekali** di `message-processor.service.ts` (`processWithLock`), tepat sebelum create Conversation di `:238`.
- **(3)** `webUid` tidak butuh unique pre-check manual (constraint `@unique` P-PWA.3 cukup); guard hanya *required*.

Environment: `node` v24.19.0; TS compiler lokal `./node_modules/.bin/tsc`; dev DB `garuda_dev`.

---

## 0. Langkah 0 — Gate (git status, sebelum mulai)

```
On branch main
Your branch is ahead of 'origin/main' by 5 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	DOCS/05_PWA_IDENTITY_BLUEPRINT.md
	DOCS/laporan-taskPWA3.md

nothing added to commit but untracked files present (use "git add" to track)
```
Working tree **tidak ada perubahan source yang uncommitted** — hanya 2 file `DOCS/` non-source yang untracked (`05_PWA_IDENTITY_BLUEPRINT.md` diketahui P-PWA.0; `laporan-taskPWA3.md` deliverable P-PWA.3 yang belum dicommit). ✅ Lalui.

---

## 1. Langkah 1 — Hapus hardcode `channel` (desain (b))

Arsitektur akibat recon (semua via `nl -ba` discan, karena `read` tool menghasilkan data stale pada `conversation.service.ts`):

### Situs `channel: 'whatsapp'` di produksi (3 tempat — buka dari P-PWA.3)
| file:line (sebelum) | peran | penanganan P-PWA.4 |
|---|---|---|
| `conversation.service.ts:75` | upsert Conversation di `processCustomerMessage` (titik create utama, dipanggil dari pipeline) | **hapus literal** → pakai param `channel` (default `'whatsapp'`) |
| `conversation.service.ts:1184` | create Conversation di `createConversation` | **hapus literal** → pakai param `channel` (default `'whatsapp'`) |
| `webhooks.ts:249` (sebelumnya `:248`) | `conversation.upsert` channel-name update di route `/fonnte` | **dibiarkan** `channel: 'whatsapp'` — ini adalah **SUMBER (route Fonete = WA)** yang secara eksplisit menyatakan channel, bukan titik create generik. (`webhooks.ts:105/:246` pada petunjuk = nomor rader; posisi aktual `:249`.) |

> Filosofi (sesuai jawaban owner): "bukan lagi hardcode di **titik create**, tapi eksplisit dikirim dari **sumber yang jelas." Titik create *generik* (`:75`, `:1184`) diubah jadi menerima `channel`; route webhook yang **memang selalu WA** (GOWA/Fonete) eksplisit kirim `'whatsapp'`.

### Inventaris call-site (semua terpenuhi, tsc membukti tidak ada yang kelewat)

**`processMessage` — penerima `channel` lewat `ProcessMessageInput` (2 caller produksi, keduanya kini explicit `'whatsapp'`):**
| caller | file:line | sebelum | sesudah P-PWA.4 |
|---|---|---|---|
| POST `/gowa` webhook | `webhooks.ts:102` → `:110` | processMessage tanpa channel | `+ channel: 'whatsapp'` |
| POST `/fonnte` webhook | `webhooks.ts:260` → `:269` | processMessage tanpa channel | `+ channel: 'whatsapp'` |

**`processCustomerMessage` — semua caller aman (param `channel` optional w/ default `'whatsapp'`):**
| caller | file:line | arg ke-5 `channel` |
|---|---|---|
| pipeline (via `processWithLock`) | `message-processor.service.ts:258` | `channel` (var, dari `input.channel ?? 'whatsapp'`) |
| route `/handle` | `messages.ts:39` | tak dikirim → default `'whatsapp'` (tidak disentuh; perilaku lama) |
| unit/integration | `golden-dataset.test.ts:235` | tak dikirim → default `'whatsapp'` (WA test) |

**`createConversation` — hanya 1 caller (test):**
| caller | file:line | arg ke-5 `channel` |
|---|---|---|
| integration test | `order-context.integration.test.ts:291` | tak dikirim → default `'whatsapp'` |

### Perubahan kode (3 file)

**`message-processor.service.ts`**
```
export interface ProcessMessageInput {
  …
  gateway: 'gowa' | 'fonnte';
  channel?: 'whatsapp' | 'web';   // ← baru (opsional)
  webUid?: string;                // ← baru (opsional, wajib bila channel 'web')
  deviceId?: string;
  …
}
```
`processWithLock` (:209) — **guard sebelum create** (lihat Langkah 2 + diagram):
```
    // Channel-aware validation (P-PWA.4) — before creating/upserting Conversation.
    const channel = input.channel ?? 'whatsapp';
    if (channel === 'whatsapp' && !input.customerPhone) {
      throw new Error(`customerPhone required for whatsapp channel (storeId=${input.storeId}, conversationId=${input.conversationId})`);
    }
    if (channel === 'web' && !input.webUid) {
      throw new Error(`webUid required for web channel (storeId=${input.storeId}, conversationId=${input.conversationId})`);
    }
    …
    result = await this.llmCircuitBreaker.wrap(() =>
        conversationService.processCustomerMessage(
          input.storeId,
          input.customerId,
          input.conversationId,
          msg.content,
          channel          // ← threaded
        )
    );
```

**`conversation.service.ts`**
```
  async processCustomerMessage(
    storeId: string,
    customerId: string,
    conversationId: string,
    customerMessage: string,
    channel: 'whatsapp' | 'web' = 'whatsapp',   // ← baru (default defensif)
  ): Promise<ResponseResult | null> {
    …
    const conversation = await prisma.conversation.upsert({
      …
      create: {
        id: conversationId,
        storeId: storeId,
        customerId: customerId,
        customerPhone: customerId, // Fallback nilai phone dengan customerId
        channel,                   // ← WAS: 'whatsapp'
        status: 'open',
      },
    });
```
```
  async createConversation(
    storeId: string,
    customerId: string,
    customerPhone: string,
    customerName?: string,
    channel: 'whatsapp' | 'web' = 'whatsapp',   // ← baru
  ): Promise<ConversationWithContext> {
    const conv = await prisma.conversation.create({
      data: {
        storeId, customerId, customerPhone, customerName: customerName ?? null,
        channel,                  // ← WAS: 'whatsapp'
        status: 'open',
      },
    });
```

**`webhooks.ts`** (2 caller WA kirim `channel: 'whatsapp'` eksplisit):
```
// POST /gowa  (webhooks.ts:102-112)
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  …
  gateway: 'gowa',
  channel: 'whatsapp',   // ← baru (eksplisit dari sumber)
  deviceId,
  storeTimezone: store.timezone,
});
// POST /fonnte (webhooks.ts:260-271)
const result = await messageProcessorService.processMessage({
  storeId: store.id,
  …
  gateway: 'fonnte',
  channel: 'whatsapp',          // ← baru
  token: store.fonnteToken,
  inboxId: inboxId ? Number(inboxId) : undefined,
  storeTimezone: store.timezone,
});
```

> `messages.ts:39` (route `/handle`) **tidak disentuh** — ia memanggil `processCustomerMessage` langsung (bypass `processMessage`/guard) dengan `customerId` yang sudah divalidasi (`:35`). `channel` default `'whatsapp'` → `customerPhone: customerId` (selalu terisi) → ` :75` create `channel:'whatsapp'`. **Perilaku lama terjaga.** (`domain/types.ts:223` `channel: string` = tipe *read* response, tidak create — tidak disentuh.)

---

## 2. Langkah 2 — Validasi app-level (single-point guard)

Guard diletakkan **sekali** di `processWithLock` (funnel tunggal ke create Conversation — dipanggil dari path initial `:166` dan retry `handleFlushed:200`), **sebelum** `processCustomerMessage` `:258`:

| channel | wajib | guard |
|---|---|---|
| `'whatsapp'` | `Customer.customerPhone` (atau `Conversation.customerPhone` via `customerId`) | `if (channel === 'whatsapp' && !input.customerPhone) throw …` |
| `'web'` | `Customer.webUid` | `if (channel === 'web' && !input.webUid) throw …` |

```
channel === 'web'   ──→ webUid wajib  (throw 'webUid required for web channel')
channel === 'whatsapp' ──→ customerPhone wajib (throw 'customerPhone required for whatsapp channel')
```
Channel default: `const channel = input.channel ?? 'whatsapp'` — semua caller yang belum kirim `channel` (messages.ts, test, retry-buffer) otomatis WA. Tidak throw untuk mereka.

**Kenapa satu tempat cukup & menumbang retry:** `processWithLock(:209)` adalah funnel tunggal yang memanggil `processCustomerMessage(:258)`. Dipanggil dari `processMessage→:166` (path awal) dan `handleFlushed→:200` (retry buffer). Jadi guard di sini menumbang **baik path initial maupun retry** — tidak perlu diduplikat ke `processCustomerMessage`. (Retry-buffer `:185` merekonstruksi `ProcessMessageInput` tanpa `channel` → default `'whatsapp'` → WA retry aman; *thread* `channel`/`webUid` ke buffer types (`QueuedMessage`/`ProcessedMessage`) diserahkan ke Fase 1 karena belum ada caller `'web'`.)

---

## 3. Alur (diagram singkat) — WA path tidak berubah

```
webhooks /gowa  (:102)  --processMessage{ channel:'whatsapp', customerPhone --}
webhooks /fonnte (:260) --processMessage{ channel:'whatsapp', customerPhone --}
         └─► processMessage(:94) ► processWithLock(:166, input)
                  └─► [guard :241] channel='whatsapp', !customerPhone==false → PASS (customerPhone dari fromJid/sender, non-empty)
                       └─► processCustomerMessage(:258, …,'whatsapp')
                           └─► prisma.conversation.upsert create { channel:'whatsapp', customerPhone }   ← :75, sama kirim channel: 'whatsapp' sebelum
retry: queue flush ► handleFlushed(:176) ► input{ channel undef→'whatsapp', customerPhone=msg.customerId } ► processWithLock(:200) ► [guard PASS] ► :258 …
```
→ `channel` WA **selalu `'whatsapp'`** (eksplisit dari webhook ATAU default param); `customerPhone` **selalu terisi** (`fromJid.replace` :49 / `sender` :199 / `customerId` :74 / `msg.customerId` :188). Guard tidak pernah trigger untuk WA. ✅

---

## 4. Acceptance — RAILS.md §5 (verbatim)

### 1) tsc --noEmit
```
(empty)
TSC_PWA4_EXIT=0
```
**0 error.** (Semua caller 4-arg tetap compile karena `channel` param bersifat optional w/ default `'whatsapp'`; guard type-check; tidak ada call-site yang pecah.)

### 2) npm run build
```
> garuda-api@0.0.1 build
> tsc

BUILD_PWA4_EXIT=0
```

### 3) Full test suite (baseline TETAP 2 failed suites / 1 failed test, TIDAK BOLEH nambah)

`npm test` (date-range):
```
tests 9
pass 9
fail 0
TEST_PWA4_EXIT=0
```

`npm run test:chat` (jest, env di-source):
```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 260 passed, 261 total
Time:        7.336 s
CHAT_PWA4_EXIT=1

failing suites (PRE-EXISTING, tidak berkaitan channel):
  ✗ src/services/chat/__tests__/engine-config-v2.test.ts   (ReferenceError: Cannot access 'redisAdapter' before initialization @ src/adapters/container.ts:38)
  ✗ src/services/chat/__tests__/reasoning-v2.test.ts       (TDZ sama)
failing test  (PRE-EXISTING, tidak berkaitan):
  ✕ reasoning-v2 › Validator reject terminal (low confidence) → fallback
```
Perbandingan PRE (P-PWA.3) vs POST (P-PWA.4):
```
PRE : Test Suites: 2 failed, 21 passed, 23 total | Tests: 1 failed, 260 passed, 261 total
POST: Test Suites: 2 failed, 21 passed, 23 total | Tests: 1 failed, 260 passed, 261 total
```
**Identical — tidak nambah.** Suite WA yang relevan tetap **passed**: `golden-dataset.test.ts` (memanggil `processCustomerMessage(:235)`, channel default `'whatsapp'` → create `:75`), `order-context.integration.test.ts` (memanggil `createConversation(:291)`, default `'whatsapp'` → create `:1184`).

### 4) git diff --stat (commit `feat(PWA.4)` = HANYA file yang menyentuh logic channel)
```
 apps/api/src/business/conversation.service.ts      | 12 +++++++-----
 apps/api/src/routes/webhooks.ts                    |  2 ++
 apps/api/src/services/message-processor.service.ts | 22 +++++++++++++++++++++-
 3 files changed, 30 insertions(+), 6 deletions(-)
```
Daftar 3 file yang tersentuh (beserta perannya):
1. `apps/api/src/services/message-processor.service.ts` — +`channel`/`webUid` ke `ProcessMessageInput`; guard channel-aware + thread `channel` ke `processCustomerMessage`.
2. `apps/api/src/business/conversation.service.ts` — param `channel` (default `'whatsapp'`) pada `processCustomerMessage(:59)` + `createConversation(:1172)`; pakai `channel` di create `:75`/`:1184` (hapus literal `'whatsapp'`).
3. `apps/api/src/routes/webhooks.ts` — `channel: 'whatsapp'` eksplisit pada panggilan `processMessage` route `/gowa(:102)` + `/fonnte(:260)`.

*Catatan scope:* file di atas membesar dari "≈3 file perkiraan" awal karena (b) menuntut `ProcessMessageInput` (di `message-processor.service.ts`) dibawa `channel` — sehingga panggilannya (`webhooks.ts`) + definisi create (`conversation.service.ts`) ikut. `schema.prisma`/migration, `domain/types.ts`, `messages.ts`, test — **tidak disentuh**.

### 5) pm2 restart confirmation
```
[PM2] Applying action restartProcessId on app [api](ids: [ 0 ])
[PM2] [api](0) ✓
│ 0 │ api │ default │ 0.0.1 │ fork │ 271152 │ 2m │ 69 │ online │ 0% │ 165.5mb │ root │ disabled │

Describing process 0 - name api:
  status         │ online
  pid            │ 271152
  restarts       │ 69
  unstable restarts │ 0
  uptime         │ 2m
```
`api` **online**, `unstable restarts: 0` — **tidak crash-loop**. (Proses restart **sebelum** `git restore dist/` sehingga pid 271152 sudah memuat build baru P-PWA.4 ke memori; restore hanya file disk, tidak memengaruhi proses berjalan — pola P-PWA.3.)

### 6) Test manual / trace — konfirmasi webhook WA (gowa & fonnte) tetap berhasil create Conversation

**Bukti runtime:** `npm run test:chat` → 260 passed (termasuk `golden-dataset` & `order-context` yang mengeksekusi create Conversation via `processCustomerMessage`/`:75` dan `createConversation`/`:1184` dengan `channel` default `'whatsapp'`).

**Bukti trace kode (WA tidak pernah melewati guard sebagai `null`/`'web'`):**

| WA inlet (webhooks) | `customerPhone` sumber | `channel` | guard hasil |
|---|---|---|---|
| `/gowa` :102 | `fromJid.replace(/@.*$/, '')` (:49, non-empty bila ada `from`) | `'whatsapp'` (eksplisit :110) | `!customerPhone` → `false` → **PASS**; create `:75` `channel:'whatsapp'` |
| `/fonnte` :260 | `sender` (:199, divalidasi `!sender` di :169) | `'whatsapp'` (eksplisit :269) | **PASS**; create `:75` `channel:'whatsapp'` |
| retry (queue flush) | `msg.customerId` | `undefined`→default `'whatsapp'` (:185 recon → `:241 ?? 'whatsapp'`) | `customerPhone=msg.customerId` (non-empty) → **PASS**; create `:75` `channel:'whatsapp'` |

→ `customerPhone` WA **selalu `string` non-empty** di ketiga jalur; guard WA (`!input.customerPhone`) **tidak pernah trigger**. `channel` WA **selalu `'whatsapp'`** (eksplisit webhook **atau** default param). **Perilaku lama (create `channel:'whatsapp'`) 100 % terjaga.**

> Verifikasi `throw` untuk channel tidak Valid: logika guard (`channel === 'web' && !input.webUid`) diverifikasi via **tsc (type-check, 0 error)** + code review (semantik if-trivial). **Tidak** ditambahan test-file baru untuk kasus `'web'`, karena: (i) tidak ada caller `'web'` di fase ini (Fase 1), dan (ii) menambah file test berisiko memicu TDZ yang sama pada `src/adapters/container.ts:38` seperti `engine-config-v2.test.ts`/`reasoning-v2.test.ts` — yang akan **menambah** failing suite, melanggar "baseline tidak boleh nambah". (Kebutuhan ini akan terpenuhi pada Fase 1 bila ada caller Web nyata.)

---

## 5. Acceptance tambahan — apakah validasi baru bisa PECAH jalur WA existing?

**Tidak.** Bukti:

1. **Guard WA hanya memicu bila `!input.customerPhone`** — di semua jalur WA, `customerPhone` berasal dari `fromJid.replace` (:49), `sender` (:199), `customerId` (:74), atau `msg.customerId` (:188); keempatnya `string` non-empty (dari payload WA yang valid). Guard `!input.customerPhone` → `false` → tidak throw. ✅
2. **`channel` WA selalu `'whatsapp'`** (eksplisit dari `webhooks.ts:110/:269`, **atau** default param `'whatsapp'` untuk caller yang tak kirim — `messages.ts:39`, test, retry-buffer). Jadi guard `'web'` (webUid) tidak pernah sampai di-evaluate untuk WA. ✅
3. **Existing call-site yang *bypass* guard** (`messages.ts:39` → `processCustomerMessage` langsung): tidak terpengaruh karena `customerId` divalidasi `:35` + `customerPhone: customerId` di `:74` (selalu string). ✅
4. **Test suite**: `260 passed` termasuk `golden-dataset` (WA path `processCustomerMessage`) + `order-context` (WA path `createConversation`) — semua lolos setelah perubahan. ✅

**Edge case yang dilaporkan ke owner (bukan direspons/dipaksa lulus — belum berdampak karena tidak ada caller `'web'`):**

| # | edge case | potensi dampak | mitigasi | status |
|---|---|---|---|---|
| 1 | `handleFlushed` (:185) merekonstruksi `ProcessMessageInput` **tanpa** `channel`/`webUid` | Pada Fase 1, pesan retry channel `'web'` akan terlompat jadi `'whatsapp'` (channel hilang di buffer) | thread `channel`/`webUid` ke tipe buffer (`QueuedMessage`/`ProcessedMessage`) | **terbuka, Fase 1** (sekarang: tidak berdampak, tidak ada caller `'web'`) |
| 2 | `messages.ts:39` (`/handle`) memanggil `processCustomerMessage` **langsung**, melewati guard | Bila `/handle` dipakai untuk channel `'web'` di masa depan, guard tidak akan menangkal (tapi `channel` tetap default `'whatsapp'` & `customerPhone=customerId` required) | tambahkan guard/param channel ke `/handle` bila kebutuhan ada | **terbuka, Fase 1** (sekarang: WA-only, aman) |

→ **Tidak ada skenario WA existing yang diketahui akan pecah.** Dua edge case di atas bersifat *forward-looking* (hanya relevan bila ada caller `'web'` di Fase 1) dan didokumentasikan, tidak dipaksa.

---

## 6. Bukti cakupan (akhir)

```
$ git log --oneline -2
5c07db2 feat(PWA.4): channel parameter (hak hardcode) + validasi app-level phone/webUid per channel
7af725a feat(PWA.3): nullable Customer.phone/Conversation.customerPhone Customer.webUid + null-safety 5 titik berisiko

$ git show --stat HEAD
commit 5c07db24ba7965ed04730f848b173d5ccae7f4c8
feat(PWA.4): channel parameter (hapus hardcode) + validasi app-level phone/webUid per channel

 apps/api/src/business/conversation.service.ts      | 12 +++++++-----
 apps/api/src/routes/webhooks.ts                    |  2 ++
 apps/api/src/services/message-processor.service.ts | 22 +++++++++++++++++++++-
 3 files changed, 30 insertions(+), 6 deletions(-)

$ git status --short
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md
?? DOCS/laporan-taskPWA3.md
```
→ HEAD = `feat(PWA.4)` (pesan persis mentereng acceptance). `git show --stat HEAD` = **3 file** (scope logic channel). Tree bersih kecuali dok `DOCS/` non-source yang sudah diketahui.

> `git diff --stat` (aksep #4) merujuk commit `feat(PWA.4)` (`5c07db2`) = 3 file di atas. `dist/`+`logs/` (tracked tapi artefak build/runtime) **dikecualikan** dari commit via `git restore apps/api/dist apps/api/logs` sebelum commit — pola sama P-PWA.3 — supaya `git diff --stat HEAD` murni mencerminkan perubahan *source logic*.

### Catatan file laporan ini
Laporan ini (`DOCS/laporan-taskPWA4.md`) disajikan **working-tree (belum dicommit)**, konsisten P-PWA.3: `feat(PWA.4)` tetap HEAD sehingga `git show --stat HEAD` = persis 3 file per acceptance. Jika Anda kehendaki ini dicommit terpisah (`docs(PWA.4): laporan …`) — beri tahu, saya akan `git add DOCS/laporan-taskPWA4.md` (hanya file ini) dan commit terpisah, sehingga `feat(PWA.4)` tetap 3-file.

---

## Ringkasan akhir P-PWA.4
- **Schema/migration: tidak disentuh** (P-PWA.3 sudah menyiapkan `Customer.webUid`/`phone` nullable + `Conversation.customerPhone` nullable).
- `channel` **dihapus dari hardcode create generik** (`:75`, `:1184` → param `channel` default `'whatsapp'`); **eksplisit `'whatsapp'`** dikirim dari sumber webhook (`webhooks.ts:110/:269`).
- **Guard sekali** di `processWithLock` (sebelum `:258`), menumbang path initial + retry; WA (`customerPhone` selalu terisi, `channel='whatsapp'`) **tidak akan pernah throw**; Web (`channel='web'`) mengharuskan `webUid`.
- **tsc 0 error · build 0 · test:chat baseline 2/1 tidak nambah · pm2 online 0 unstable-restart · WA trace lolos.** Commit `5c07db2` (3 file). Siap Fase 1 (Web adapter / route PWA).
