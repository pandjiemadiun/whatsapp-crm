# Laporan TASK P3.0 — Audit read-only: Context boundary (WorkspaceV2 vs legacy ExtractedEntities)

**Tanggal:** 10 Agu 2026
**Mode:** READ-ONLY — tidak ada perubahan kode. Tujuan audit: peta semua titik
baca/tulis `WorkspaceV2` dan `ExtractedEntities`, verifikasi kembali klaim NO-OP
`updateExtractedEntities` di jalur v2, temukan semua titik timpa/memori-lose,
klasifikasi risiko.

**Verdict utama (terbukti di source, bukan dugaan):** Klaim audit lama (RAILS.md
§2: "updateExtractedEntities di jalur v2 adalah NO-OP (type mismatch) — v2
kehilangan memori antar-turn") — **TERCONFIRM. Mekanisme typenya persis seperti
klaim, bukan eksagerasi.** Bukti verbatim ada di §3 "Bukti NO-OP".

---

## 1. Tabel: semua titik READ/WRITE `WorkspaceV2` (v2 context)

WorkspaceV2 adalah struktur in-memory (types-v2.ts:111) yang **tidak ada kolom
DB khusus** — sengaja dan tidak sengaja disimpan ke kolom JSON yang SAMA dengan
legacy `ExtractedEntities` (lihat §2).

| file:line | akses | simbol / bentuk akses | verbatim | konteks |
|---|---|---|---|---|
| `src/services/chat/types-v2.ts:111` | def | `export interface WorkspaceV2` | `{schema_version, conversation_summary, pendings:PendingV2[], draft_cart:DraftCartOp[], resolved_facts, last_bot_message_type?, options_presented:string[][]}` | shape v2 — TIDAK punya `.length` |
| `src/services/chat/workspace.ts:47` | write (serde) | `saveWorkspace(ws)` | `export function saveWorkspace(ws: WorkspaceV2): string { return JSON.stringify(ws); }` | **hanya serialize ke string; persist TIDAK di sini** |
| `src/services/chat/workspace.ts:29` | read (serde) | `loadWorkspace(json)` | `const parsed = JSON.parse(json) as Partial<WorkspaceV2>; return { schema_version: parsed.schema_version ?? '' ... pendings: parsed.pendings ?? [], draft_cart: parsed.draft_cart ?? [], ... }` | **load dari kolom extractedEntities, default [] bila field v2 tidak ada** |
| `src/services/chat/workspace.ts:59,70,79,91,103,115,143,165,184,200,211,224,227,240,247` | in-mem | `getPendings/parkPending/findPending/addToDraft/getFact/setFact/setSummary/...setLastBotMessageType` | semua mutasi IN-MEMORY pada `ws: WorkspaceV2` | tidak persist langsung |
| `src/business/conversation.service.ts:111` | branch | `if (engine === 'v2') {` | — | entry v2 (canary `store-f7140b5c:engine=v2`) |
| `src/business/conversation.service.ts:141` | **read** | `const workspace = loadWorkspace(JSON.stringify(ctxRow?.extractedEntities || {}));` | verbatim di atas | **LOAD workspace dari kolom legacy `extractedEntities` tiap turn** |
| `src/business/conversation.service.ts:172` | call | `const reasoningOutcome = await understand(customerMessage, workspace, catalog, history, fallbackService, storeId, conversationId);` | — | workspace dikirim ke reasoning engine |
| `src/business/conversation.service.ts:232-233` | **write (NO-OP!)** | path v2 `resolved` | `const resolvedContextEntities = saveWorkspace(workspace); await conversationContextService.updateExtractedEntities(conversationId, JSON.parse(resolvedContextEntities));` | **WorkspaceV2 object dikirim ke fn yang ekspek array → NO-OP** |
| `src/business/conversation.service.ts:316-317` | **write (NO-OP!)** | path v2 `reasoned` | `const updatedContextEntities = saveWorkspace(workspace); await conversationContextService.updateExtractedEntities(conversationId, JSON.parse(updatedContextEntities));` | sama — NO-OP |
| `src/services/chat/reasoning.ts:176,226` | read | `understand(..., workspace: WorkspaceV2, ...)` | — | engine v2 hanya baca/mutasi di memori, persistnya tetap ke 233/317 |
| `src/services/chat/composer-v2.ts:35`, `prompts-v2.ts:91`, `fast-path.ts:258/354/408` | read | `workspace: WorkspaceV2` param | — | pure helpers, tidak persist |

**Catatan penting:** tidak ada `prisma.<table>.update({ data: { workspace: ... } })`.
kolom DB untuk state conversation hanya `extractedEntities` (lihat §2). Jadi
semua "persist v2" harus lewat `updateExtractedEntities` — yang justru NO-OP.

## 2. Tabel: semua titik READ/WRITE `ExtractedEntities` (legacy, kolom DB)

Kolom DB yang dipakai **oleh kedua jalur** (v1 legacy + v2): `conversationContext.extractedEntities`
(berjenis JSON). Shape legacy (domain/types.ts:257):

```
export interface ExtractedEntities {
  discussedItems: DiscussedItem[];
  confirmedItems: ConfirmedItem[];
  lastAmbiguousPrompt: string | null;
  recipientName?: string | null;
  shippingAddress?: string | null;
  pendingClarification?: PendingClarification | null;
  previousMutation?: { cartSnapshot: ConfirmedItem[]; message: string } | null;
}
```

| file:line | akses | simbol | verbatim (potongan kunci) | konteks |
|---|---|---|---|---|
| `src/domain/types.ts:109` | def | schema | `extractedEntities: ExtractedEntity[];` | kolom di `ConversationContext` |
| `src/domain/types.ts:257` | def | `export interface ExtractedEntities` | (lihat §2 di atas) | shape legacy object |
| `src/business/conversation-context.service.ts:44` | write | initializeContext create | `data: { ..., extractedEntities: [] }` (atau default) | pembuatan context baru |
| `src/business/conversation-context.service.ts:116` | **write** | updateExtractedEntities | `data: { extractedEntities: merged as unknown as Prisma.InputJsonValue }` | merge array `ExtractedEntity[]` → kolom |
| `src/business/conversation-context.service.ts:199` | write | updateShippingInfo | `data: { extractedEntities: entities ... }` | legacy object |
| `src/business/conversation-context.service.ts:318` | **write** | setPendingClarification | `data: { extractedEntities: entities ... }` | legacy object + pendingClarification |
| `src/business/conversation-context.service.ts:358` (clearPendingClarification) | write | clearPending | `extractedEntities: { ...entities, pendingClarification: null }` | legacy |
| `src/business/conversation-context.service.ts:1397` | **write** | modifyCart | `data: { extractedEntities: entities as ...InputJsonValue }` (entities = parseExtractedEntities, confirmedItems updated) | **legacy object** — cart mutation persisted di sini |
| `src/business/conversation-context.service.ts:415` | write | clearPreviousMutation | `extractedEntities: { ...entities, previousMutation: null }` | legacy |
| `src/business/conversation-context.service.ts:210` | **read** | parseExtractedEntities | `if (raw && typeof raw === 'object' && !Array.isArray(raw)) { ...return {discussedItems, confirmedItems, ...} }` | parse legacy object |
| `src/business/conversation-context.service.ts:457` | **read** | parseEntities (private) | `if (Array.isArray(raw)) return raw as ExtractedEntity[]; return [];` | parse ARRAY — dibedakan parseExtractedEntities |
| `src/business/conversation-context.service.ts:467` | read | mergeEntities | `for (const e of incoming) { key = \`${e.type}:${e.value}\` }` | expect `ExtractedEntity[]` |
| `src/business/conversation-context.service.ts:441` | read | mapToContextData | `extractedEntities: this.parseEntities(raw.extractedEntities)` | legacy array |
| `src/business/conversation-context.service.ts:69,193,266,337,367,386,408` | read | select extractedEntities | `select: { extractedEntities: true }` | baca kolom |
| `src/business/conversation.service.ts:233,317,394,808,888,902,908,1392,1397` | read/write | v1/v2 paths | baca/memodifikasi `extractedEntities` | gabungan |
| `src/business/fallback.service.ts:383,641,896` | read | tier tries | `select: { extractedEntities: true }` | fallback baca context |
| `src/business/fallback.service.ts:997,1003` | write | (fallback tier) | `extractedEntities: entities as unknown as Prisma.InputJsonValue` | fallback menulis |
| `src/business/order.service.ts:426` | write | extractAndSaveOrder→updateExtractedEntities | `await conversationContextService.updateExtractedEntities(conversationId, entities);` | legacy array (order ref) |
| `src/business/product.service.ts:389,617,1106` | typedef | `extractedEntities: Record<string, unknown>` | lokal product-service shape, beda domain | tidak kolom conversation |
| `src/routes/analytics.ts:62` | read | query | `extractedEntities: true` | analytics saja |

## 3. Bridge symbols (yang menghubungkan v2 ↔ legacy)

| simbol | file:line | signature | peran bridge |
|---|---|---|---|
| `loadWorkspace` | workspace.ts:29 | `(json: string): WorkspaceV2` | parse kolom `extractedEntities` (legacy) → WorkspaceV2 (default []/{} bila field v2 tak ada) |
| `saveWorkspace` | workspace.ts:47 | `(ws: WorkspaceV2): string` | serialize WorkspaceV2 → string (persistnyatakan lewat NO-OP di bawah) |
| `updateExtractedEntities` | conversation-context.service.ts:100 | `(conversationId, entities: ExtractedEntity[]): Promise<void>` | **satu-satunya gerbang persist kolom `extractedEntities`** |
| `parseExtractedEntities` | conversation-context.service.ts:210 | `(raw: unknown): ExtractedEntities` | parse legacy object (v1/caller utama) |
| `parseEntities` (private) | conversation-context.service.ts:457 | `(raw: unknown): ExtractedEntity[]` | parse ARRAY — dipakai `updateExtractedEntities` merge |
| `mergeEntities` (private) | conversation-context.service.ts:467 | `(existing: ExtractedEntity[], incoming: ExtractedEntity[])` | expect ARRAY |
| `modifyCart` | conversation-context.service.ts:253 | `(conversationId, action, opts)` | **persist `confirmedItems` (legacy object)** — satu-satunya cara v2 reasoned-path menulis ke cart |
| `setPendingClarification` | conversation-context.service.ts:330 | persist `pendingClarification` (legacy) | v1 resolver |

## 4. Bukti NO-OP (klaim lama diverifikasi — bukan dugaan)

Kontrak `updateExtractedEntities` mensyaratkan **array** `ExtractedEntity[]` dan
memakai guard berikut (conversation-context.service.ts:100-101) — **verbatim**:

```ts
async updateExtractedEntities(conversationId: string, entities: ExtractedEntity[]): Promise<void> {
  if (!entities.length) return;                       // <-- (1) guard untuk ARRAY
  try {
    const raw = await prisma.conversationContext.findUnique({ where: { conversationId } });
    ...
    const existing = this.parseEntities(raw.extractedEntities);   // parseEntities:457 ISI ARRAY
    const merged = this.mergeEntities(existing, entities);         // mergeEntities:467 expect ARRAY
    await prisma.conversationContext.update({ where: { conversationId },
      data: { extractedEntities: merged as unknown as Prisma.InputJsonValue } });
```

Call site v2 (conversation.service.ts:232-233) — **verbatim**:

```ts
const resolvedContextEntities = saveWorkspace(workspace);
await conversationContextService.updateExtractedEntities(conversationId, JSON.parse(resolvedContextEntities));
```

Rantai tipe:
- `saveWorkspace(workspace)` (workspace.ts:47) = `JSON.stringify(ws)` → string JSON
  dari `WorkspaceV2` → `"{\"schema_version\":...,\"pendings\":[],\"draft_cart\":[],...}"`.
- `JSON.parse(...)` → kembali ke objek **`WorkspaceV2`** (object murni, tidak array).
- `entities.length` pada `WorkspaceV2` = **`undefined`** (WorkspaceV2 tidak punya
  properti `length`; types-v2.ts:111 tidak mendefinisikan `length`).
- `!undefined === true` → **return pada (1) adalah NO-OP.** Sampai ke `parseEntities`/
  `mergeEntities` pun tidak sampai (yang juga melempar/ mengembalikan `[]` karena
  `Array.isArray(WorkspaceV2) === false`).

Bukti bahwa `WorkspaceV2` memang tak punya `.length`:

```ts
// types-v2.ts:111
export interface WorkspaceV2 {
  schema_version: string;
  conversation_summary: string;
  pendings: PendingV2[];
  draft_cart: DraftCartOp[];
  resolved_facts: Record<string, unknown>;
  last_bot_message_type?: string;
  options_presented: string[][];
}
```

**Kesimpulan:** setiap turn v2, `saveWorkspace` → `updateExtractedEntities`
**selalu NO-OP**. WorkspaceV2 **tidak pernah tersimpan**. Di turn berikutnya,
conversation.service.ts:141 memuat workspace dari kolom `extractedEntities`
yang sama — yang hanya berisi jejak **legacy** (atau kosong) — lalu
`loadWorkspace` (workspace.ts:29) me-default-kan semua field v2 ke `[]`/`{}`:
`pendings: []`, `draft_cart: []`, `resolved_facts: {}`. **Memori antar-turn v2
hilang secara total.** Klaim audit lama TERCONFIRM, termasuk alasan typenya
("type mismatch").

## 5. Titik-titik tempihan (timpa / race) v2 ↔ v1/legacy

Beberapa observasi penting (semua di kolom `extractedEntities` yang SAMA, row
`conversationContext` yang SAMA per conversationId):

1. **Load v2 baca kolom legacy (141):** `loadWorkspace(JSON.stringify(ctxRow?.extractedEntities || {}))`.
   Jika kolom berisi legacy `ExtractedEntities` (v1) → `loadWorkspace` mengembalikan
   `WorkspaceV2` kosong (`pendings:[], draft_cart:[]`) karena field `pendings`/
   `draft_cart`/`schema_version` tidak ada di legacy object. **v2 tidak pernah
   melihat data v1 (confirmedItems/pendingClarification) yang tersimpan.**

2. **v2 reasoned path tetap persist cart via `modifyCart` (conversation-context.ts:1397):**
   `executeCartOps` (conversation.service.ts:839) dipanggil dari v2 resolved
   (216) dan v2 reasoned (300), dan akhirnya `modifyCart` menulis
   `extractedEntities` (legacy object, confirmedItems). Jadi **cart ops v2
   tersimpan** — tapi **hanya confirmedItems**, bukan `draft_cart`/`pendings`/
   `resolved_facts`/`options_presented` v2. **Selectif memori hilang.**

3. **`updateExtractedEntities` (legacy, 116) memakai `parseEntities` (array) +
   `mergeEntities`**, sedangkan `setPendingClarification`/`modifyCart` memakai
   `parseExtractedEntities` (object). Ini berarti kolom `extractedEntities`
   **bisa berupa ARRAY atau OBJECT** tergantung penulis terakhir → konsumsi
   campuran: `getContext/mapToContextData` (441) memakai `parseEntities`
   (array), sementara `updateExtractedEntities` dan `modifyCart` memakai
   `parseExtractedEntities` (object). **Tidak konsisten shape** di kolom yang
   sama. Jika penulis terakhir = array, `parseExtractedEntities` (object-check,
   210) me-reset ke `{discussedItems:[], confirmedItems:[]}` → **data hilang.**

4. **`fallback.service.ts:997/1003`** (tier fallback) juga menulis
   `extractedEntities` ke kolom yang sama — berpotensi menimpa state v1/v2.

5. **Race/cross-turn engine:** tidak ada lock pada row `conversationContext`.
   Dua turn bersamaan (mis. dua pesan WA hampir simultan untuk conversation
   yang sama) → `findUnique` → `update` tanpa transaksi → **last-write-wins**
   pada `extractedEntities`. RAILS §2 sudah mencatat `modifyCart`
   read-modify-write tidak transaksional (race condition). Tetap berlaku.

## 6. Temuan + klasifikasi risiko

| # | risiko | aksi/letak | klasifikasi | alasan + skenario |
|---|---|---|---|---|
| T1 | WorkspaceV2 tidak pernah persisten → **memori antar-turn v2 hilang total** (pendings, draft_cart, resolved_facts, options_presented, conversation_summary) | v2 save 233/317 (NO-OP) → load 141 | **TINGGI** | Turn 1 v2 minta klarifikasi → set pending di WorkspaceV2 (in-mem). Turn 2 customer jawab "iya" → v2 loadWorkspace baca kolom (hanya legacy/kosong) → `pendings:[]` → pending hilang → customer disuruh ulang dari awal. Untuk canary (`engine=v2`) ini bug data-nyata tiap sesi berkelanjutan. |
| T2 | Kolom `extractedEntities` bentuknya tidak konsisten (ARRAY di updateExtractedEntities/mergeEntities vs OBJECT di parseExtractedEntities/setPendingClarification/modifyCart) → **parseEntity kosongkan data** | conversation-context.service.ts:116 (array) vs :199/:318/:1397/:210 (object) | **TINGGI** | Penulis terakhir berupa array → `parseExtractedEntities` (object-guard, 210) `return {discussedItems:[], confirmedItems:[]}` → confirmedItems/pendingClarification hilang. Saling eksklusi antar penulis. |
| T3 | v2 membaca kolom legacy sebagai WorkspaceV2 → **v2 tidak melihat data v1** (confirmedItems, pendingClarification, recipientName, shippingAddress) | conversation.service.ts:141 loadWorkspace | **SEDANG** | Jika engine beralih v2 (atau canary) setelah v1 mengumpulkan state → v2 "buta" state lama → bisa menanyakan ulang / kehilangan cart yang sudah dikonfirmasi v1. |
| T4 | Race condition last-write-wins pada kolom `extractedEntities` (read-modify-write tanpa transaksi) | conversation-context.service.ts:modifyCart/setPendingClarification/updateExtractedEntities — semua `findUnique`→`update` | **SEDANG** | Dua pesan hampir bersamaan → satu update menimpa pending/cart lain → klarifikasi/cart customer termutation. (Dokumen RAILS §2 sudah mencatat `modifyCart` non-transaksional.) |
| T5 | Fallback tier (fallback.service.ts:997/1003) menulis `extractedEntities` ke kolom yang sama → **bisa menimpa state** v1/v2 secara diam-diam | fallback.service.ts:938/949/997/1003 | **RENDAH** | Hanya berlaku bila fallback mengembalikan entitas; dampak lokal & sudah dikelola catch. Tapi memperparah ketidakkonsistenan shape (T2). |

## 7. Rekomendasi urutan fix (bukan bagian P3 — untuk TASK berikutnya)

Urutan didasarkan pada Risiko × Dampak produksi (canary v2 aktif):

1. **(TINGGI) T1 — Persist WorkspaceV2 secara terpisah.** Pilihan arsitektur:
   - (a) kolom `extractedEntities` diperlakukan sebagai **union** — persist
     `{...legacyFields, schema_version, pendings, draft_cart, resolved_facts,
     options_presented}` sehingga v1 dan v2 coexistence, atau
   - (b) kolom baru `workspace_v2` khusus v2; `loadWorkspace`/`saveWorkspace`
     pindah ke kolom itu.
   Setidaknyaya: `updateExtractedEntities` perlu menerima & menulis `workspace`
   (object) bukan hanya `ExtractedEntity[]`.
2. **(TINGGI) T2 — Satukan shape kolom.** Salah satu: `parseExtractedEntities`
   atau `parseEntities`/`mergeEntities` konsisten (semua object, atau semua
   array). Hapus cabang parsing ganda yang saling timpa.
3. **(SEDANG) T3 — v2 loadWorkspace harus mampu memetakan legacy→v2**
   (map confirmedItems→draft_cart, pendingClarification→pendings) agar transisi
   v1→v2 tak buta.
4. **(SEDANG) T4 — Wrap read-modify-write (`modifyCart`,
   `setPendingClarification`, `updateExtractedEntities`) dalam transaksi Prisma
   (`$transaction` / `prisma.$transaction([read, write])`) atau optimistic
   locking (`updatedAt` compare) untuk cegah race.
5. **(RENDAH) T5 — Fallback tier tidak menulis shape baru ke kolom yang sama
   tanpa koordinasi.**

## 8. Checklist read-only (apa yang TIDAK diubah di task ini)

- [x] Tidak ada file sumber di-`import`/diedit.
- [x] `npm run test:chat` dan `npm run build` tidak dijalankan (tidak perlu
      untuk audit read-only — tidak ada change).
- [x] Semua kutipan di atas adalah verbatim; file:line diverifikasi lewat
      `grep`/`sed` langsung pada pohon sumber.
