# Laporan Task P5.0 — Audit Read-Only: Response Naturalness (composer-v2)

**Tanggal**: 2026-08-11  
**Scope**: Read-only audit — **tidak ada perubahan kode**  
**Target**: `apps/api/src/services/chat/composer-v2.ts` dan path reply composition terkait  

---

## Ringkasan Eksekutif

P5.0 mengekorkan seluruh mekanisme penyusunan reply (template vs LLM vs gabungan),
memverifikasi kembali I-1 (qty 0 di receipt) dan I-2 (reply "adari?" terpotong)
di source terbaru, lalu mencari pola reply yang **objektif rusak** (bukan sekadar
"terasa kaku"). Temuan diklasifikasikan menjadi **BUG** (obyektif rusak, fix jelas)
dan **GAYA** (subjektif, butuh keputusan owner).

**Tidak ditemukan string "adari" di seluruh repo** (source, log, test). I-2 harus
diperlakukan sebagai potensi BUG berdasarkan analisis kode, bukan reproduksi langsung.

---

## 1. Arsitektur Reply Composition

### 1.1 Dua mesin reply paralel

Sistem memiliki **dua path reply composition** yang selaras:

| Path | Engine | File utama | Post-processing |
|------|--------|------------|-----------------|
| **v1** | interpreter (Stage 4 LLM) | `conversation.service.ts:582-671` | `truncateTo2Sentences(llmResult.reply_draft)` (line 657) — dipaksakan ke ≤2 kalimat |
| **v2** | reasoning engine (Stage 4 LLM v3.2) | `composer-v2.ts:32-99` | **Tidak ada `truncateTo2Sentences`** — `reply_draft` dan `messages` digunakan apa adanya |

v2 path diaktifkan di `conversation.service.ts:291-357`. Reply dihasilkan oleh
`composeReply()` dan langsung disimpan via `buildResult()` → `saveMessage()`
tanpa post-processing lanjutan.

### 1.2 composer-v2.ts — struktur `composeReply()`

```
composeReply(params):
  A. Jika ada clarification → delegate ke composeClarification()  (line 42-44)
  B. Jika plannedActs kosong → kembalikan reply_draft || fallback        (line 47-48)
  C. Jika ada draft_cart_ops → render "🛒 Ditambahkan ke keranjang: ..."   (line 54-60)
    C2. Fallback (draft_cart_ops kosong) → render dari plannedActs        (line 62-77)
  D. Jika ada info_answer act + reply_draft → push reply_draft             (line 80-82)
  E. Jika topic_switch → push "Oh ya Kak, tadi masih lanjut pesan..."       (line 86-88)
  F. Gabung semua messages, POTONG KE 3 via slice(0, 3), join('\n')        (line 92)
```

**Hybrid**: reply composition adalah **gabungan template (hardcoded string) + LLM
output** (`reply_draft`). Template mengatur struktur (emoji, pemisah, fallback),
sementara isi utama berasal dari `reply_draft` yang dihasilkan LLM.

### 1.3 Prompt LLM (system prompt)

`prompts-v2.ts:61`:
```
b. JANGAN sertakan harga/stok di reply_draft; reply_draft maksimal 2 kalimat.
```

Ini **instruksi** ke LLM (bukan enforcement). Tidak ada post-processing di v2 path
yang memaksakan batasan ini. Berbeda dengan v1 path yang menerapkan
`truncateTo2Sentences` secara programatik.

---

## 2. Verifikasi I-1 — Qty 0 di Receipt ("Brambang (0x)")

**Status**: ⚠️ SEBAGIAN FIXED — display sudah di-filter, tapi subtotal masih BUG.

### 2.1 Apa yang sudah di-FIX

Filter `qty <= 0` sudah ada di dua lokasi display:

| File | Line | Kode | Commit |
|------|------|------|--------|
| `conversation.service.ts` | 965 | `.filter((i) => Number(i.qty || 0) > 0)` | `1370d945` (Aug 8, pandjiemadiun) |
| `fallback.service.ts` | 694 | `.filter((ci) => Number(ci.qty || 0) > 0)` | (pre-existing) |

**✅ "Brambang (0x)" tidak akan muncul di cart summary display.** Filter menghilangkan
item dengan qty <= 0 sebelum rendering.

### 2.2 BUG tersisa: `resolvedSubtotal` tidak konsisten dengan display filter

**File**: `conversation.service.ts:254`  
**Commit**: `fc394040` (Aug 9, pandjiemadiun — bagian dari P4.0)

```typescript
const resolvedSubtotal = resolvedCart.reduce(
    (sum, i) => sum + (Number(i.price) * Number(i.qty || 1)),   // ← BUG: qty=0 → 0||1 = 1
    0
);
```

**Root cause**: Operator `||` (logical OR) memperlakukan `0` sebagai falsy.
- `i.qty = 0` → `0 || 1` → hasil `1` → item dihitung sebagai qty=1 di subtotal.
- Sedangkan `renderCartSummary` (line 259→965) memfilter item qty=0 dari display.

**Akibat objektif**: Jika `confirmedItems` mengandung item dengan qty=0 (mis.
legacy data, edge case sync, atau manipulasi langsung):
- Display: item tidak muncul (difilter)
- Subtotal: harga item masih dihitung (qty=0 → diperlakukan sebagai qty=1)
- → **Total lebih tinggi dari yang ditampilkan** → mismatch antara "Rincian" dan "Total belanja"

**Fix yang disarankan**: Ganti `|| 1` menjadi filter konsisten sebelum reduce:
```typescript
const visibleItems = resolvedCart.filter((i) => Number(i.qty || 0) > 0);
const resolvedSubtotal = visibleItems.reduce(
    (sum, i) => sum + (Number(i.price) * Number(i.qty || 0)), 0
);
```

### 2.3 `tryTotal` (fallback) — sudah konsisten

`fallback.service.ts:694-712`:
```typescript
items = items.filter((ci) => Number(ci.qty || 0) > 0);         // filter qty > 0
const subtotal = items.reduce((sum, ci) => sum + ((ci.price || 0) * Number(ci.qty || 0)), 0);  // consistent
```

✅ Filter dan subtotal konsisten. Tidak ada BUG.

### 2.4 Apakah qty=0 pernah masuk ke `confirmedItems`?

`modifyCart` (`conversation-context.service.ts:287-351`):
- **'remove'**: item di-filter-out dari array (bukan diset qty=0). ✅
- **'add'/'swap'**: `opts.qty ?? 1` — default 1 jika undefined. Tapi jika `opts.qty = 0` diteruskan, item akan memiliki qty=0.

`validateCartOpsAgainstDb` (`interpreter.ts:171-174`):
```typescript
if (typeof op.qty !== 'number' || op.qty < 1) {
    invalid.push({ ...op, qty: 1, price: dbProduct.price });
    continue;  // qty < 1 → invalid, tidak dieksekusi
}
```
✅ Ops dengan qty < 1 ditandai invalid dan tidak dieksekusi. Jadi di **normal flow**, qty=0 tidak pernah masuk ke `confirmedItems`.

**Namun**: `draft_cart_ops` (used in composer-v2 reply composition, not execution)
tidak melalui `validateCartOpsAgainstDb`. Lihat §4.1.

---

## 3. Verifikasi I-2 — Reply "adari?" Terpotong

**Status**: ❓ TIDAK DAPAT DIREPRODUKSI — tidak ada bukti di log/test/source.

### 3.1 Pencarian bukti

```
$ grep -rn "adari" apps/api/  →  NOT FOUND (source, log, test, .aider history)
```

Log files (`combined.log` 8201 lines, `error.log` 50 lines, `exceptions.log` 16 lines)
hanya berisi **metrics/metadata** (replyLength=100, outcome, llmCalls), bukan reply
content asli. Log sudah di-reset ke HEAD sebelum commit P4.2.

ERROR log hanya berisi:
- "Engine v2 failed, fallback to v1" (2 occurrences)
- "Interpreter exhausted retries" (9 occurrences)

Tidak ada reply mentah yang terpotong.

### 3.2 STATUS-V2.md:21 & BUG-BELUM-DIBERESKAN.md I-2

Dokumentasi asli mencatat I-2 sebagai **kosmetik (Low)**:
> "Reply resolved terpotong ('adari?') - kosmetik"

Deskripsi asli menunjukkan ini pernah terjadi di produksi, tapi bukti log
tidak tersedia di environment ini (log sudah dirotasi/reset).

### 3.3 Analisis kode — potensi root cause

Ada **3 mekanisme** yang dapat menyebabkan reply terpotong:

#### 3.3.1 LLM `maxTokens = 250` truncation (v2 path) — **BUG**

**File**: `reasoning.ts:41` — `LLM_MAX_TOKENS = 250`  
**Penggunaan**: `callLlm` (reasoning.ts:106) menerima `maxTokens: 250`  
**Impact di v2 path**: `reply_draft` langsung dipakai di `composeReply` (composer-v2.ts:48,82)
tanpa post-processing. Jika LLM output terpotong di tengah kata/kalimat, `reply_draft`
berisi teks tidak lengkap → reply customer terpotong.

**Contoh**: LLM sedang menghasilkan "Apakah ada yang lain?" → terpotong jadi "Ap" →
di dalam JSON valid (string masih lengkap secara JSON, tapi isi terpotong).
Atau: "Saya saran..." → "Saya sar" → customer melihat reply yang tidak lengkap.

**Contrast dengan v1 path**: v1 path menerapkan `truncateTo2Sentences(llmResult.reply_draft)`
(conversation.service.ts:657) yang setidaknya memastikan reply terpotong di batas
kalimat yang "bersih" (setelah `.!?` diikuti spasi). Tapi ini juga punya limitasi —
lihat §3.3.3.

#### 3.3.2 `truncateTo2Sentences` regex (v1 path) — **GAYA / edge case**

**File**: `interpreter.ts:230-237`

```typescript
export function truncateTo2Sentences(text: string): string {
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.!?])\s+/)    // ← split on . ! ? followed by whitespace
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, 2).join(' ');
}
```

**Edge case bahasa Indonesia**: Karakter `?` sering dipakai sebagai interjeksi
bukan akhir kalimat. Contoh:
- "iya?" — konfirmasi singkat
- "ya?" — seruan
- "nggak?" — konfirmasi

Jika LLM menghasilkan contoh seperti:
> "Keranjang sudah diupdate ya? Silakan lanjut pesan lain?"

Regex akan memecah menjadi:
1. "Keranjang sudah diupdate ya?" 
2. "Silakan lanjut pesan lain?"

→ `slice(0, 2).join(' ')` → "Keranjang sudah diupdate ya? Silakan lanjut pesan lain?" ✅ benar.

Tapi jika LLM menghasilkan:
> "Totalnya Rp 36.000, ya? Mau tambah?"

Regex memecah:
1. "Totalnya Rp 36.000, ya?" 
2. "Mau tambah?"

→ Benar. Tapi jika ada pola di mana `?` muncul di tengah satu kalimat yang seharusnya
not dianggap sebagai akhir kalimat, split bisa salah.

**Ini GAYA, bukan BUG**: regex bekerja dengan benar untuk batas kalimat standar.
Perilaku `?` sebagai interjeksi adalah keputusan linguistik yang mempengaruhi
pemilihan regex — ini butuh keputusan owner, bukan fix teknis yang jelas.

#### 3.3.3 `messages.slice(0, 3)` di composer-v2 — **BUG (silent data loss)**

**File**: `composer-v2.ts:92`
```typescript
const finalReply = messages.slice(0, 3).join('\n');
```

Jika ada **4+ messages** (mis. 2 cart ops + reply_draft + topic_switch),
pesan ke-4+ **dihilangkan tanpa pemberitahuan**. Ini bisa menyebabkan:
- Reply terasa "tidak lengkap" — info penting hilang
- Topic switch reminder (line 88) bisa terhapus jika ada 3+ cart ops sebelumnya
- Tidak ada warning/error log tentang truncation

**Fix yang disarankan**: `messages.join('\n')` (hilangkan slice) atau
`messages.slice(0, N).join('\n')` dengan N yang lebih besar / konfigurabel.

### 3.4 Kesimpulan I-2

**"adari?" paling mungkin** disebabkan oleh kombinasi:
1. LLM `maxTokens=250` memotong `reply_draft` (v2 path, reasoning.ts:41)
2. v2 path **tidak** menerapkan `truncateTo2Sentences` (berbeda dengan v1 path)
3. `composeReply` menggunakan `reply_draft` langsung (composer-v2.ts:48,82)

Ini adalah **BUG** di v2 path — tidak ada guard/validasi post-LLM untuk memotong
atau memastikan kelengkapan `reply_draft`. Sistem prompt hanya berisi instruksi
"maksimal 2 kalimat" (prompts-v2.ts:61), tapi instruksi tidak dipertihandepan.

---

## 4. Pola Lain Reply yang Objektif Rusak

### 4.1 BUG — `draft_cart_ops.qty` tidak divalidasi (composer-v2.ts:59)

```typescript
return `🛒 Ditambahkan ke keranjang: ${op.product} x${op.qty}`;  // line 59
```

`DraftCartOp.qty: number` (types-v2.ts:70) — tidak ada validasi `qty >= 1`
di `validator-v2.ts`. Jika LLM mengeluarkan `qty: 0`, reply akan menampilkan
"Ayam goreng x0" — tidak masuk akal dan membingungkan customer.

**Root cause**: `draft_cart_ops` diproses langsung ke `composeReply` tanpa
validasi kuantitas, berbeda dengan `cart_ops` (ActV2.entities) yang melewati
`validateCartOpsAgainstDb` (interpreter.ts:171-174) yang memfilter qty < 1.

**Fix**: Tambahkan guard di composer-v2.ts:59:
```typescript
const displayQty = op.qty && op.qty > 0 ? op.qty : 1;
return `🛒 Ditambahkan ke keranjang: ${op.product} x${displayQty}`;
```

### 4.2 BUG — `reply_draft` kosong di v2 path fallback (composer-v2.ts:48)

```typescript
return reasoningResult.reply_draft || "Maaf kak, saya kurang paham.";  // line 48
```

Jika `reply_draft` adalah string spasi "   " (bukan null/undefined), `||` 
akan menganggapnya truthy dan mengembalikan "   " (balasan hanya spasi).

**Fix**: `reasoningResult.reply_draft?.trim() || "Maaf kak, saya kurang paham."`

### 4.3 BUG — `slice(0, 3)` silently drops messages (composer-v2.ts:92)

Lihat §3.3.3. `messages.slice(0, 3).join('\n')` — pesan ke-4+ hilang tanpa warning.

### 4.4 GAYA — Topic switch message generic (composer-v2.ts:87-88)

```typescript
const pendingProduct = workspace.pendings.length > 0 ? 'pesanan' : 'pembicaraan';
messages.push(`Oh ya Kak, tadi masih lanjut pesan ${pendingProduct} atau mau batal?`);
```

Pesan ini selalu generic ("pesanan" atau "pembicaraan"), tidak menyebutkan
produk/spesifik pending. **Ini GAYA** — keputusan apakah ingin pesan lebih spesifik
atau tetap generic.

### 4.5 GAYA — Tidak ada `truncateTo2Sentences` di v2 path

Di v2 path, `reply_draft` dan `messages` apa adanya tanpa pembatasan kalimat.
Ini bisa menjadi fitur (reply lebih natural) atau bug (reply terlalu panjang /
terpotong). **Ini GAYA / desain** — perlu keputusan owner apakah v2 path harus
menerapkan `truncateTo2Sentences` seperti v1 path.

### 4.6 GAYA — `reply_draft` tidak mencakup harga (prompts-v2.ts:61)

System prompt melarang LLM menyertakan harga di `reply_draft`:
> "b. JANGAN sertakan harga/stok di reply_draft"

Ini berarti LLM tidak bisa menyertakan informasi harga dalam `reply_draft`, yang
harusnya disampaikan oleh template/renderCartSummary terpisah. **Ini GAYA / desain** —
keputusan arsitektural, bukan bug.

### 4.7 GAYA — Format "×" vs "x" diqty display

- `renderCartSummary` (conversation.service.ts:969): `×${qty}` — memakai `×` (Unicode multiply)
- `composer-v2.ts:59`: `x${op.qty}` — memakai `x` (ASCII)
- `composer-v2.ts:74`: `x${qtyPerEntity}` — memakai `x` (ASCII)  
- `fallback.service.ts:722`: `(${ci.qty || 0}x)` — memakai `x` (ASCII)

Inkonsistensi format ini **GAYA** — keputusan owner untuk standarisasi.

---

## 5. Ringkasan Temuan (BUG vs GAYA)

### BUG — Fix wajib (objektif, jelas)

| # | ID | File:Line | Deskripsi | Prioritas | Fix |
|---|----|-----------|-----------|----------|-----|
| 1 | I-1a | `conversation.service.ts:254` | `Number(i.qty || 1)` → qty=0 dihitung sebagai qty=1 di subtotal, padahal display memfilter qty=0. **Subtotal > total yang ditampilkan.** | **TINGGI** | Ganti `|| 1` → filter dulu, pakai `Number(i.qty \|\| 0)` |
| 2 | I-2  | `reasoning.ts:41` + `composer-v2.ts:48,82` | LLM maxTokens=250 bisa truncation `reply_draft`; v2 path tidak apply `truncateTo2Sentences`, jadi reply terpotong langsung dipakai. **Root cause "adari?".** | **TINGGI** | Tambahkan post-processing: `truncateTo2Sentences(reply_draft)` di v2 path, atau validasi panjang |
| 3 | —    | `composer-v2.ts:92` | `messages.slice(0, 3)` — silently drops messages ke-4+, informasi hilang. | **MEDIUM** | Hapus slice atau naikkan limit + log warning |
| 4 | —    | `composer-v2.ts:59` | `${op.qty}` — DraftCartOp.qty tidak divalidasi ≥1, bisa "x0". | **MEDIUM** | Guard: `op.qty > 0 ? op.qty : 1` |
| 5 | —    | `composer-v2.ts:48` | `reply_draft || "..."` — spasi saja ("   ") dianggap truthy, balasan hanya spasi. | RENDAH | `.trim()` guard |

### GAYA — Perlu keputusan owner (subjektif)

| # | ID | File:Line | Deskripsi |
|---|----|-----------|-----------|
| 1 | I-2  | `interpreter.ts:233` | `truncateTo2Sentences` regex `/(?<=[.!?])\s+/` — `?` sebagai interjeksi di Bahasa Indonesia bisa salah split. Perlu keputusan: regex engine linguistik vs rule-based. |
| 2 | —    | `composer-v2.ts:87-88` | Topic switch message generic ("pesanan"/"pembicaraan"), tidak spesifik ke produk. |
| 3 | —    | `conversation.service.ts:657` vs `composer-v2.ts:48,82` | v1 path truncate ke 2 kalimat; v2 path tidak. Konsistensi antar path — perlukan keputusan. |
| 4 | —    | `composer-v2.ts:59,74` vs `conversation.service.ts:969` | Format qty display: `x` (ASCII) vs `×` (Unicode). Standarisasi. |
| 5 | —    | `prompts-v2.ts:61` | System prompt larang harga di `reply_draft`. Ini desain — tapi berarti reply_draft harus dipisah dari rincian harga. Perlu keputusan owner. |
| 6 | —    | `composer-v2.ts:14-15` | `ESCALATE_REPLY` tone/emoji ("Baik kak, ... 🙏"). Preferensi gaya bahasa. |

---

## 6. Rekomendasi Urutan Fix (BUG saja)

**Prioritas 1 (TINGGI)** — bisa menyebabkan informasi salah/kebingungan serius:
1. **I-1a** — `conversation.service.ts:254`: Ganti `Number(i.qty || 1)` menjadi konsisten dengan display filter. Ini menyelesaikan mismatch subtotal vs display yang bisa menyesatkan customer tentang total belanja.
2. **I-2** — `composer-v2.ts`: Terapkan post-processing serupa `truncateTo2Sentences` pada `reply_draft` di v2 path (seperti v1 path yang sudah ada di conversation.service.ts:657). Ini mencegah reply terpotong seperti "adari?".

**Prioritas 2 (MEDIUM)** — kualitas reply dan data:
3. **`composer-v2.ts:92`** — Hapus `slice(0, 3)` atau ganti dengan logika yang tidak silently drop messages. Tambahkan warning log jika jumlah messages melebihi batas.
4. **`composer-v2.ts:59`** — Tambahkan guard `qty > 0` pada `DraftCartOp.qty` sebelum render, sama seperti `validateCartOpsAgainstDb` yang sudah ada untuk `cart_ops`.

**Prioritas 3 (RENDAH)**:
5. **`composer-v2.ts:48`** — Tambahkan `.trim()` pada `reply_draft` sebelum `||` fallback untuk menghindari balasan hanya berisi spasi.

> **GAYA tidak disertakan rekomendasi fix urut** — menunggu keputusan owner pada tiap item.

---

## 7. Apa yang TIDAK dilaporkan (terkait dokumentasi)

Berikut catatan untuk STATUS-V2.md tentang temuan di luar scope reply composition:

- **II-4** (seed test data woltel/brambang): dicatat di `BUG-BELUM-DIBERESKAN.md` I-3 bagian II-4, ditunda owner.
- **III-1 / III-2** (dist + logs ter-track di git): dicatat di `BUG-BELUM-DIBERESKAN.md`, ditunda investigasi alur deploy.

Temuan-temuan ini tidak berkaitan dengan reply composition dan tidak dimasukkan
ke dalam klasifikasi BUG/GAYA di atas.

---

## 8. Evidence & Verification Method

| Check | Metode | Result |
|-------|--------|--------|
| composer-v2.ts dibaca penuh | `read` tool, 100 lines | ✅ Selesai |
| clarification-composer.ts dibaca penuh | `read` tool, 101 lines | ✅ Selesai |
| interpreter.ts (truncateTo2Sentences, validateCartOps, etc.) | `read` tool, 238 lines | ✅ Selesai |
| conversation.service.ts (v2 path, v1 path, renderCartSummary, resolvedSubtotal) | `read` tool, 1061 lines | ✅ Selesai |
| fallback.service.ts (tryTotal) | `read` tool, 703 lines | ✅ Selesai |
| planner.ts (planActs) | `read` tool, 126 lines | ✅ Selesai |
| validator-v2.ts (validate) | `read` tool, 296 lines | ✅ Selesai |
| types-v2.ts (InterpreterResultV2, DraftCartOp, ActV2) | `read` tool, 166 lines | ✅ Selesai |
| prompts-v2.ts (system prompt, FEW_SHOTS) | `read` tool, 261 lines | ✅ Selesai |
| conversation-context.service.ts (modifyCart) | `read` tool, 351 lines | ✅ Selesai |
| composer-v2.test.ts | `read` tool, 194 lines | ✅ Selesai |
| golden-dataset.test.ts Case 8 | `read` tool, line 529-567 | ✅ Selesai |
| Log files (combined.log, error.log, exceptions.log) | `read` + `grep` | ✅ Dibaca |
| String "adari" di seluruh repo | `grep -rn` | ❌ NOT FOUND |
| git blame (filter qty, resolvedSubtotal) | `git blame` | ✅ Verifikasi commit |
| tsc --noEmit | `npx tsc --noEmit` | ✅ 0 error (baseline, tidak berubah) |

---

*Report ini bersifat read-only. Tidak ada kode yang dimodifikasi.  
Commit terpisah untuk laporan dokumentasi.*
