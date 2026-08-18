# Laporan TASK P-PWA.3 — Nullable `Customer.phone` / `Customer.webUid` + `Conversation.customerPhone` (+ null-safety 5 titik BERISIKO)

Scope: `schema.prisma` + migration Prisma (author manual + `prisma migrate deploy`, karena `prisma migrate dev` diblokir non-interactive — pola sama P-PWA.2) + 5 perbaikan null-safety pada titik BERISIKO laporan P-PWA.1. **Tidak ada** endpoint/route/UI/web-adapter baru (itu Fase 1, task terpisah). `Customer`/`Conversation` model logic (assignment/penulisan nilai) **tidak** diubah — hanya constraint kolom jadi nullable + null-handling defensif.

Environment: `node` v24.19.0; Prisma CLI lokal `./node_modules/.bin/prisma` = **5.22.0** (jangan pakai `npx prisma` = 7.9.1, mismatch dengan `@prisma/client@5.22.0` — lihat poin P-PWA.2). Dev DB `garuda_dev` (PostgreSQL 127.0.0.1:5432).

---

## 0. Langkah 0 — Gate (git status, sebelum mulai)

```
On branch main
Your branch is ahead of 'origin/main' by 4 commits.
  (use "git push to publish your commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	DOCS/05_PWA_IDENTITY_BLUEPRINT.md

nothing added to commit but untracked files present (use "git add" to track)
```
Working tree **bersih** kecuali dok non-source `DOCS/05_PWA_IDENTITY_BLUEPRINT.md` (diketahui, Option A owner). `git diff --stat` kosong (tidak ada source uncommitted). ✅ Lalui.

---

## 1. Langkah 1 — Schema changes (`apps/api/prisma/schema.prisma`)

Tiga perubahan kolom (hanya nullable constraint, tidak data, tidak default otomatis):

**`model Conversation`** (`schema.prisma:140`):
```
144	  customerName          String?
145	  customerPhone         String?          // sebelumnya: String
146	  status                String   @default("open")
```

**`model Customer`** (`schema.prisma:394`):
```
396	  storeId       String
397	  phone         String?                  // sebelumnya: String
398	  webUid        String?  @unique          // ← baru (nullable, unique, tidak ada default)
399	  name          String?
```

`prisma validate` → `The schema at prisma/schema.prisma is valid 🚀` (VALIDATE_EXIT=0).

---

## 2. Langkah 2 — Migration (pola P-PWA.2: migrate dev diblokir)

`npx prisma migrate dev --name ...` **diblokir Prisma 5** di environment ini (non-interactive), sama seperti P-PWA.2:
> `Error: Prisma Migrate has detected that the environment is non-interactive, which is not supported.`

Jalankan alternatif non-interaktif: author `migration.sql` manual (dialek Postgres Prisma — diverifikasi dari `20260725160640_init` untuk `DROP NOT NULL` dan `20260801151606_add_store_payment_fields` untuk `ADD COLUMN … TEXT;` + `CREATE UNIQUE INDEX …` nullable), lalu `prisma migrate deploy`.

**Sync-check DB** (cek dulu DB in-sync dengan folder migration, agar deploy HANYA menerapkan migration baru):
```
applied_count=15 folders_count=16
pending (in folders, not applied):
  20260811103440_add_customer_webuid_nullable_phones   ← satu-satunya
```
DB sudah in-sync (15 folder lama = 15 record `migration_name` applied; hanya migration baru yang pending).

**`migration.sql` yang diciptakan** — `apps/api/prisma/migrations/20260811103440_add_customer_webuid_nullable_phones/migration.sql`:
```sql
-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "customerPhone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "webUid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "customers_webUid_key" ON "customers"("webUid");
```
(Dialek sama: kolom `text` nullable, index unique terpisah → Postgres unique index membolehkan banyak NULL, jadi tidak conflict dengan baris existing `webUid IS NULL`. `customerPhone`/`phone` hanya DROP NOT NULL — **tak mengubah DATA**.)

`prisma migrate deploy`:
```
16 migrations found in prisma/migrations

Applying migration `20260811103440_add_customer_webuid_nullable_phones`

The following migration(s) have been applied:
migrations/
  └─ 20260811103440_add_customer_webuid_nullable_phones/
    └─ migration.sql

All migrations have been successfully applied.
DEPLOY_EXIT=0
```

`prisma generate` (binary lokal 5.22.0, bukan `npx`):
```
✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client
GEN_EXIT=0
```
Client regenerate — `Customer.phone: string | null`, `Customer.webUid: string | null`, `Conversation.customerPhone: string | null`.

---

## 3. Langkah 3 — Fix 5 titik BERISIKO (dari tabel BERISIKO laporan P-PWA.1)

Tabel BERISIKO P-PWA.1 (`DOCS/laporan-taskPWA1-grep.md` §3, baris 154–155, 163, 187–188, dan "Daftar semua situs BERISIKO" 190–196 + ringkasan 239) mengidentifikasi tepat **5 titik** yang akan pecah `tsc` bila `Conversation.customerPhone → String?`. Perbaikan HANYA null-safety minimal; **perilaku lama untuk channel WA (customerPhone selalu terisi) tidak berubah** — guard hanya `skip + log warning`, tidak `throw`.

| # | Titik BERISIKO (P-PWA.1) | file:line | Mekanisme break | Fix P-PWA.3 | file:line (setelah fix) | Status |
|---|---|---|---|---|---|---|
| 1 | conversations.ts:147 | routes/conversations.ts:147 | `fonnteService.sendMessage(phone: string)` diberi `conversation.customerPhone: string\|null` | guard `if (!conversation.customerPhone)` → skip + `adapters.logger.warn` | :148 (guard) | ✅ FIXED (compile+runtime) |
| 2 | conversations.ts:157 | routes/conversations.ts:157 | `gowaAdapter.sendMessage(phone: string)` diberi `conversation.customerPhone: string\|null` | guard `if (!conversation.customerPhone)` → skip + warn | :161 (guard) | ✅ FIXED (compile+runtime) |
| 3 | conversation.service.ts:1355 | business/conversation.service.ts:1355 | assign `conv.customerPhone (string\|null)` ke `ConversationDetail.customerPhone: string` (turunan interface `:41`) | interface `ConversationListItem.customerPhone` (`:41`) → `string \| null` (ConversationDetail mewarisi) | :41 | ✅ FIXED (compile) |
| 4 | conversation.service.ts:1317 | business/conversation.service.ts:1317 | `findAllByStore` return `findMany` (customerPhone `string\|null`) sebagai `ConversationListItem[]` (`customerPhone: string` `:41`) | interface `ConversationListItem.customerPhone` (`:41`) → `string \| null` | :41 | ✅ FIXED (compile) |
| 5 | scheduleFollowUps.ts:157 | bootstrap/scheduleFollowUps.ts:157 | arg `conv.customerPhone (string\|null)` → `IdleConversation.customerPhone: string` (`:169`); turunan `:206`/`:213` `sendMessage(phone: string)` | interface `:169` → `string \| null`; guard `:206`/`:213` → skip + warn | :169, :207, :217 | ✅ FIXED (compile+runtime) |

> **"5 file dari langkah 3" = 5 titik di atas, tersebar di 3 file sumber.** Titik 1+2 di `conversations.ts`; titik 3+4 di `conversation.service.ts` (1 edit interface `:41` menutup ke-empat break turunan `:1355`+`:1317`); titik 5 di `scheduleFollowUps.ts`. `git diff --stat` commit = 5 entry (schema.prisma + migration.sql + 3 .ts). — daurasikan ke tabel BERISIKO P-PWA.1: `|20| conversations.ts:147`, `|21| conversations.ts:157`, `|29| conversation.service.ts:1355`, catatan turunan `:1317`, catatan `:157` (ringkasan baris 239).

**A. Titik BERISIKO lain yang *tidak* break (AMAN* boundary, turunan `:157` dari P-PWA.1 baris 182–184):** `scheduleFollowUps.ts:186` (destructure), `:206`, `:213` (sendMessage) — ditandai AMAN\* berkat "boundary `:157`". Setelah interface `:169` jadi `string | null`, ketiga titik ini *akan* pecah kecuali ditambahi guard. Fix titik 5 di atas (`:169` + guard `:206`/`:213`) justru menutup AMAN\* boundary ini.

**B. Situs lain yang *diverifikasi tak perlu di‑edit* (tsc 0 error membukti):**
- `orders.ts:64` `conversation?.customerPhone || order.customerId` — null-safe via `||`, tetap `string`. (P-PWA.1 `|2| AMAN`.)
- `conversations.ts:59` `customerPhone: conversation.customerPhone` ke `res.json({...})` — objek response tidak bertipe, nilai `string | null` aman di JSON. (P-PWA.1 `|19| AMAN`.)
- `conversation.service.ts:1276` `customerPhone: conv.customerPhone` di `mapConversationWithContext` — `conv: any`, tak terpengaruh kolom. (P-PWA.1 `|27| AMAN`.)
- `webhooks.ts:49/199` `const customerPhone = fromJid.replace(...)` / `= sender` — local `string`, bukan bacaan kolom.
- `message-processor.service.ts` (`:48/:188/:336/:353/:363/:395/:403/:411/:416/:423/:431`) — pakai `input.customerPhone: string` (interface), isi selalu `msg.customerId` (`string`), bukan bacaan Prisma. (P-PWA.1 grep #2: "0 BERISIKO terhadap Customer.phone".)
- `domain/types.ts:221` `ConversationWithContext.customerPhone: string` — *tidak disentuh* (bukan salah satu dari 5 titik; populasi melalui `conv: any` jadi aman). Mempertahankan diff hanya 3 file .ts.
- `prisma.ts:19/29` (komentar + array nama kolom enkripsi) — literal string runtime, tidak type-sensitive; `customerPhone`/`phone` tetap dienkripsi (nullable tidak mengubah enkripsi).

### Snippet kode (before → after)

**conversations.ts:147 (fonnte) + :157 (gowa)** — guard agar tidak passing `string | null` ke `phone: string`:
```ts
// SEBELUM (P-PWA.1 :147 / :157)
if (store?.fonnteToken) {
  try {
    await fonnteService.sendMessage(conversation.customerPhone, sanitizedContent, { token: store.fonnteToken });
  } catch { sendError = 'Fonnte send failed'; }
} else if (store?.phoneNumber) {
  try {
    const did = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
    await gowaAdapter.sendMessage(conversation.customerPhone, sanitizedContent, { deviceId: did });
  } catch { sendError = 'GOWA send failed'; }
}

// SESUDAH (P-PWA.3 :148 / :161)
if (store?.fonnteToken) {
  try {
    if (!conversation.customerPhone) {
      adapters.logger.warn('Skip Fonnte send: conversation.customerPhone is null', { conversationId: conversation.id, storeId });
    } else {
      await fonnteService.sendMessage(conversation.customerPhone, sanitizedContent, { token: store.fonnteToken });
    }
  } catch { sendError = 'Fonnte send failed'; }
} else if (store?.phoneNumber) {
  try {
    if (!conversation.customerPhone) {
      adapters.logger.warn('Skip GOWA send: conversation.customerPhone is null', { conversationId: conversation.id, storeId });
    } else {
      const did = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
      await gowaAdapter.sendMessage(conversation.customerPhone, sanitizedContent, { deviceId: did });
    }
  } catch { sendError = 'GOWA send failed'; }
}
```

**conversation.service.ts:41** (tutup titik 3 `:1355` + titik 4 `:1317`):
```
// SEBELUM
  customerName: string | null;
  customerPhone: string;
  status: string;
// SESUDAH
  customerName: string | null;
  customerPhone: string | null;   // ConversationDetail (extends ConversationListItem) mewarisi
  status: string;
```

**scheduleFollowUps.ts:169 + :206/:213** (tutup titik 5 + boundary :186/:206/:213):
```ts
// SEBELUM interface (:169) / send (:206,:213)
interface IdleConversation { /* … */ customerPhone: string; /* … */ }
…
if (store.fonnteToken) {
  try { await fonnteService.sendMessage(customerPhone, followUpText, { token: store.fonnteToken }); } catch { sendError = 'Fonnte send failed'; }
} else if (store.phoneNumber) {
  try { const deviceId = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`; await gowaAdapter.sendMessage(customerPhone, followUpText, { deviceId }); } catch { sendError = 'GOWA send failed'; }
}
// SESUDAH
interface IdleConversation { /* … */ customerPhone: string | null; /* … */ }
…
if (store.fonnteToken) {
  try {
    if (!customerPhone) { adapters.logger.warn('Skip Fonnte follow-up: customerPhone is null', { conversationId }); }
    else { await fonnteService.sendMessage(customerPhone, followUpText, { token: store.fonnteToken }); }
  } catch { sendError = 'Fonnte send failed'; }
} else if (store.phoneNumber) {
  try {
    if (!customerPhone) { adapters.logger.warn('Skip GOWA follow-up: customerPhone is null', { conversationId }); }
    else { const deviceId = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`; await gowaAdapter.sendMessage(customerPhone, followUpText, { deviceId }); }
  } catch { sendError = 'GOWA send failed'; }
}
```
Guard di `:206`/`:213` tidak `throw`, tidak `continue` — hanya melewatkan kirim WA + `warn` agar scheduler tidak crash-loop (per constraint task).

---

## 4. Acceptance — RAILS.md §5 (verbatim)

### 1) tsc --noEmit
```
(empty)
TSC3_EXIT=0
```
**0 error.** (Satu-satnya bukti bahwa 5 titik fix menutup semua break yang diprediksi P-PWA.1; `strictNullChecks` lulus.)

### 2) npm run build
```
> garuda-api@0.0.1 build
> tsc

BUILD3_EXIT=0
```

### 3) Full test suite (baseline HARUS tetap 2 failed suites / 1 failed test, TIDAK BOLEH nambah)

`npm test` (date-range, pure-logic):
```
tests 9
pass 9
fail 0
DATE_TEST_EXIT=0
```

`npm run test:chat` (jest, +env):
```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 260 passed, 261 total
Snapshots:   0 total
Time:        11.625 s
CHAT3_EXIT=1
```
Perbandingan PRE (P-PWA.2) vs POST P-PWA.3:
```
PRE : Test Suites: 2 failed, 21 passed, 23 total | Tests: 1 failed, 260 passed, 261 total
POST: Test Suites: 2 failed, 21 passed, 23 total | Tests: 1 failed, 260 passed, 261 total
```
**Identical — tidak nambah.** 2 suite yang sama gagal load (`engine-config-v2`, `reasoning-v2` — `ReferenceError: Cannot access 'redisAdapter' before initialization` di `src/adapters/container.ts:38`), 1 test sama gagal (`reasoning-v2` `Validator reject terminal … → fallback`). Kedua kegagalan **tidak berkaitan** dengan `Customer`/`Conversation`. (Catatan: `npm run test:all` tanpa `--env-file` → 18 fail `DATABASE_URL` — *bukan* baseline logika; tidak dipakai, sama P-PWA.2.)

### 4) git diff --stat (commit `feat(PWA.3)` = HANYA schema.prisma + migration baru + 3 file .ts dari langkah 3)
```
 .../migration.sql                                  | 11 +++++++++++
 apps/api/prisma/schema.prisma                      |  5 +++--
 apps/api/src/bootstrap/scheduleFollowUps.ts        | 16 ++++++++++++----
 apps/api/src/business/conversation.service.ts      |  2 +-
 apps/api/src/routes/conversations.ts               | 22 +++++++++++++++-------
 5 files changed, 42 insertions(+), 14 deletions(-)
```
(daeri `git show --stat HEAD` / `git diff --stat HEAD~1`.)

### 5) pm2 restart confirmation
```
[PM2] Applying action restartProcessId on app [api](ids: [ 0 ])
[PM2] [api](0) ✓
│ 0 │ api │ default │ 0.0.1 │ fork │ 269101 │ 8s │ 68 │ online │ 0% │ 165.9mb │ root │ disabled │

Describing process 0 - name api:
  status             │ online
  pid                │ 269101
  restarts           │ 68
  unstable restarts  │ 0
  uptime             │ 8s
```
`api` **online**, `unstable restarts: 0` → **tidak crash-loop**. (dist/ yang direbuild oleh `npm run build` sudah dimuat proses lama via pm2; `--update-env` hanya hint pm2, DB env tetap dari `.env` yang sama.)

### 6) DB readback (dev DB `garuda_dev`)

`is_nullable` (information_schema — otoritatif):
```
 table        | column        | is_nullable | udt_name
 conversations| customerPhone | YES         | text     ← sebelumnya NO
 customers    | phone         | YES         | text     ← sebelumnya NO
 customers    | webUid        | YES         | text     ← baru
```

`customers` — `phone` tetap terisi semua (data preserved), `webUid` semua NULL (kolom baru):
```
cust_total | phone_null | phone_filled
214        | 0          | 214

webuid_null | webuid_filled
214         | 0
```
`customers_webUid_key` unique index:
```
customers_webUid_key | CREATE UNIQUE INDEX "customers_webUid_key" ON public.customers USING btree ("webUid")
```
(Postgres unique index → banyak NULL diperbolehkan, sehingga 214 baris NULL tidak bersinggungan.)

`conversations` — `customerPhone` nullable, **semua baris existing TETAP TERISI** (tidak ada yang jadi NULL akibat migration — migration hanya DROP NOT NULL, bukan UPDATE data):
```
conv_total | cp_null | cp_filled
147        | 0       | 147
```
→ **`customerPhone` kolom hanya constraint yang berubah (YES), DATA tidak berubah (`cp_null=0`).** Persis kaku kaya P-PWA.2.

---

## 5. Acceptance tambahan — konfirmasi perubahan perilaku (jalur WA yang bisa menerima null)

**Ya.** Ada **4 titik WA-produkksi (message‑sender)** yang *sekarang bisa diterjangi* `customerPhone: null` padahal sebelumnya **tidak mungkin**:

| WA send path (produksi) | sebelumnya | sekarang | penanganan |
|---|---|---|---|
| `conversations.ts:147` — `fonnteService.sendMessage` (reply agent) | tidak mungkin (NOT NULL) | bisa null (kolom nullable) | guard `:148` skip+warn |
| `conversations.ts:157` — `gowaAdapter.sendMessage` (reply agent) | tidak mungkin | bisa null | guard `:161` skip+warn |
| `scheduleFollowUps.ts:206` — `fonnteService.sendMessage` (follow-up) | tidak mungkin | bisa null | guard `:207` skip+warn |
| `scheduleFollowUps.ts:213` — `gowaAdapter.sendMessage` (follow-up) | tidak mungkin | bisa null | guard `:217` skip+warn |

**Ini bukan bug — perilaku disengaja untuk Fase 1 (PWA Web channel).** Penjelasan:
- **WA ingest (penciptaan nilai) TIDAK pernah menghasilkan null**: `webhooks.ts:49/199` `const customerPhone = fromJid.replace(...)` / `= sender` (string), `webhooks.ts:105/246/263` assign ke `Conversation.customerPhone`; `webhooks.ts:91/223/245` assign `phone: customerPhone` ke `Customer.phone`; `message-processor.ts:188` `customerPhone: msg.customerId` (string); `conversation.service.ts:74/1182` `customerPhone: customerId`/param `string`. → Semua channel WA selalu nyuplai `string`. DB readback memastikan: `cp_null=0` (147), `phone_null=0` (214) — tidak ada baris WA dengan phone null.
- **Constraint yang berubah hanyalah di DB** (NOT NULL → nullable) sebagai *enabler* forward-compatible untuk channel Web (yang memang tak selalu punya nomor WA). Guard di 4 send-point melompati kirim + `warn` bila null, **tidak throw, tidak crash**. Untuk channel WA existing (customerPhone selalu terisi) guard **tidak pernah trigger** → **perilaku lama terjaga**.
- Customer.service.ts createConversation (`:1172`, param `customerPhone: string`) dan message-processor.ProcessMessageInput (`:48`, `string`) **tidak disentuh** — tetap mensyaratkan `string`, jadi WA ingest tetap type-safe & tidak akan pernah push null secara kode.

Ringkasnya: migrasi ini **membuka kemungkinan null di level DB** (yang ditangkap guard 5 titik), **bukan menambahkan path WA yang menghasilkan null**. Perilaku WA eksisting 100 % tidak berubah; satu-satunya perilaku baru adalah "jika suatu hari ada baris dengan customerPhone null (misal dari Web channel Fase 1), WA send akan dilewati + ter-log warn" alih-alih crash.

---

## 6. Bukti cakupan (akhir)

```
$ git log --oneline -3
7af725a feat(PWA.3): nullable Customer.phone/Conversation.customerPhone Customer.webUid + null-safety 5 titik berisiko
d37d5d3 feat(PWA.2): migration Store.slug nullable unique
3478731 docs(PWA.1): audit grep customerPhone/Customer.phone usage
```
```
$ git show --stat HEAD
commit 7af725a876934a7cd71ad79e24aa1b71c49dfe6f
feat(PWA.3): nullable Customer.phone/Conversation.customerPhone Customer.webUid + null-safety 5 titik berisiko

 .../migration.sql                                  | 11 +++++++++++
 apps/api/prisma/schema.prisma                      |  5 +++--
 apps/api/src/bootstrap/scheduleFollowUps.ts        | 16 ++++++++++++----
 apps/api/src/business/conversation.service.ts      |  2 +-
 apps/api/src/routes/conversations.ts               | 22 +++++++++++++++-------
 5 files changed, 42 insertions(+), 14 deletions(-)
```
```
$ git status --short
?? DOCS/05_PWA_IDENTITY_BLUEPRINT.md
```
→ HEAD = `feat(PWA.3)` (pesan persis), tree bersih kecuali dok non-source yang sudah diketahui.

> `git diff --stat` (poin aksep #4) merujuk commit `feat(PWA.3)` di atas — **5 file**: `schema.prisma` + `migration.sql` (baru) + 3 file .ts dari Langkah 3 (`conversations.ts`, `conversation.service.ts`, `scheduleFollowUps.ts`). Tidak ada file source lain. `build` (dist/) dan log runtime (logs/) sengaja **tidak** dimasukkan (karena artefak build/runtime; proses api tetap `online` karena modul sudah dimuat ke memori — pm2 `watching: disabled`).

### Catatan scope file laporan ini
Laporan ini (`DOCS/laporan-taskPWA3.md`) disajikan sebagai **file working-tree (belum di-commit)**, karena TASK P-PWA.3 tidak menyertakan pesan commit `docs(PWA.3):…` (berbeda P-PWA.0 yang eksplisit: `Commit terpisah, pesan commit: docs(PWA.0)`). Sehingga HEAD (`feat(PWA.3)`) tetap menjadi *commit comunil* yang dapat diverifikasi = 5 file per acceptance poin 4. Jika Anda menginginkan laporan ini juga tercatat di riwayat commit (mis. `docs(PWA.3): laporan migration nullable Customer.phone …`), beri tahu — akan kudorong sebagai commit terpisah.
