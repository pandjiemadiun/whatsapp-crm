# Laporan Task P6.0 — Audit Read-Only: Golden Dataset as Architecture Gate

**Tanggal**: 2026-08-11  
**Scope**: Read-only audit — **DILARANG mengubah kode apa pun**  
**Target**: `apps/api/src/tests/golden-dataset.test.ts` + mekanisme test:chat / CI / hooks  

---

## 1. Inventaris Invarian I8–I15

Definisi invarian diekstrak dari komentar source (RAILS.md §2, interpreter.ts,
conversation.service.ts, validator-v2.ts, fast-path.ts, setops.ts) dan
dicatat di STATUS-V2.md / BUG-BELUM-DIBERESKAN.md.

| Kode | Definisi (file:line) | Ada di golden-dataset.test.ts? | Line | Ada unit test lain? (file:line) |
|------|----------------------|-------------------------------|------|----------------------------------|
| **I8** | Maks 1 LLM call per message (`interpreter.ts:7`; `conversation.service.ts:620`; `fast-path.ts:351,403`). **Catatan RAILS.md:84**: sudah diturunkan jadi "guideline efisiensi", bukan hard constraint. | ✅ Ya | Case 8:548 `assert.equal(calls, 1, 'interpreter must call LLM exactly once (I8)')` | `interpreter.test.ts:197` (`truncateTo2Sentences` test) |
| **I9** | **Tidak terdefinisi di mana pun** — tidak ada di RAILS.md, source komentar, STATUS-V2.md, BUG-BELUM-DIBERESKAN.md | ❌ Tidak ada | — | ❌ |
| **I10** | Afirmatif/negasi menutup klarifikasi (0 LLM) (`fast-path.ts:13,404`; `conversation.service.ts:414`). Resolve pending clarification via deterministic resolver, bukan LLM. | ✅ Ya | Case 1:321, Case 3:380, Case 7:522 — semua `assert.equal(calls, 0)` | `fast-path-v2.test.ts` (resolver logic) |
| **I11** | Kamus slang normalizer (e.g. `toralin`→`total`) (`STATUS-V2.md:42`). Typo/normalisasi kata harus dipetakan ke intent yang tepas. | ✅ Ya | Case 2:341 `normalize('toralin brp')` → `'total berapa'` | `normalizer.test.ts` |
| **I12** | Guard nama produk — produk DULU cek (fuzzy match) sebelum dimutasi normalizer (`conversation.service.ts:591`). Nama produk tidak boleh berubah saat normalisasi. | ✅ Ya | Case 6:471-475 `normInput.includes('berasss')` — "berasss" must NOT be mutated to "beras" | `normalizer.test.ts` |
| **I13** | Harga cart selalu dari DB, bukan LLM (`conversation.service.ts:609,481`; `conversation.service.ts:632`). Validate `validateCartOpsAgainstDb` memaksa harga DB. | ✅ Ya | Case 5:449-451 `/Rp\s*12[.,]000/`, Case 10:650, Case P2-I13:775 `assert.equal(berasItem.price, 12000)` | — (hanya di golden dataset) |
| **I14** | **Tidak terdefinisi di mana pun** — tidak ada di RAILS.md, source komentar, STATUS-V2.md, BUG-BELUM-DIBERESKAN.md | ❌ Tidak ada | — | ❌ |
| **I15** | cart_ops dari LLM wajib divalidasi terhadap DB (`interpreter.ts:142`; `validator-v2.ts:15`; `fast-path.ts:14`). Produk tidak ada di DB → missing, tidak dieksekusi. | ✅ Ya | Case 10:623 comment: "validateCartOps verifies product existence against storeProducts (I15)" | `validator-v2.test.ts` |

### Temuan inventaris:
- **I9 dan I14 tidak didefinisikan** — gap dokumentasi. RAILS.md §2 hanya
  mencantumkan I8 dan I13 secara eksplisit, sementara I9–I15 disebut secara
  implisit di komentar kode. I9 dan I14 tidak pernah diimplementasi. Biarkan
  ini tercatat di laporan ini, **jangan dibuatkan definisi baru** (out of scope
  read-only audit).
- **I8 sudah "dilemahkan"** — RAILS.md:84 dan §3 trade-off principle: I8 adalah
  "guideline efisiensi", bukan hard constraint. Golden dataset Case 8 (line 548)
  masih asserting `calls == 1`, tapi assertion ini **bisa gagal jika I8 dilanggar**
  (e.g. retry transport di interpreter.ts:83 `const maxRetries = 1`).
  Ini bukan bug — ini adalah konsekuensi I8 menjadi soft guideline.

---

## 2. Status: "Architecture Gate" vs "Regression Test Kosmetik"

### Bukti — golden-dataset.test.ts **TIDAK** tercakup oleh `test:chat`

**`apps/api/package.json` scripts** (verified live):
```
test:chat: node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs
```

**`apps/api/jest.config.cjs` testMatch** (baca langsung, line 27-30):
```javascript
testMatch: [
  '<rootDir>/src/services/chat/__tests__/**/*.test.ts',
  '<rootDir>/src/services/chat/tests/**/*.test.ts'
],
```

**`apps/api/src/tests/golden-dataset.test.ts`** berada di `src/tests/` — **DI LUAR**
testMatch Jest (`<rootDir>/src/services/chat/__tests__/` dan
`<rootDir>/src/services/chat/tests/`).

**Bukti langsung** — Jest `--listTests` tidak menemukan golden-dataset:
```
$ npx jest --config jest.config.cjs --listTests
# Output: 20 file .ts di src/services/chat/__tests__/ dan src/services/chat/tests/
# golden-dataset.test.ts di src/tests/ — TIDAK ADA di list
```

golden-dataset.test.ts memakai **`node:test` runner** (header file, line 4):
```
Runner: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts
```
Ini berarti golden-dataset **harus dijalankan manual** dengan `tsx --test`,
bukan melalui `npm run test:chat` (Jest).

### Bukti — tidak ada CI/CD gate

| Mechanism | Status | Bukti |
|-----------|--------|-------|
| `.github/` workflows | ❌ **Tidak ada** | `find .github -type f` → output kosong. Tidak ada direktori `.github` sama sekali. |
| `.git/hooks/` active hooks | ❌ **Tidak ada** | `ls .git/hooks/` → hanya `.sample` files (pre-commit.sample, pre-push.sample, commit-msg.sample, dll). **Tidak ada** hook aktif. |
| `.pre-commit-config.yaml` | ❌ **Tidak ada** | `cat .pre-commit-config.yaml` → "no pre-commit config" |
| `ecosystem.config.js` (PM2) | ❌ Tidak referensi golden | ecosystem.config.js:5-25 — hanya mengelola proses `api` dan `dashboard`, **tidak ada** script test/golden. |
| `package.json scripts` | ❌ Tidak ada script golden | Tidak ada `test:golden` atau `test:integration` di package.json. Script `test` hanya menjalankan `date-range.test.ts`. |
| Manual runner | ✅ Satu-satunya jalan | Header file golden-dataset.test.ts:4: `npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts` |

### Kesimpulan eksplisit

> **golden-dataset.test.ts saat ini adalah "regression test manual", BUKAN
> architecture gate.**

Buktinya:
1. **Tidak tercakup** di `test:chat` (Jest testMatch tidak mencakup `src/tests/`)
2. **Tidak ada CI** (.github/ tidak ada) — tidak pernah dijalankan otomatis di commit/push/deploy
3. **Tidak ada pre-commit hook** (.git/hooks/ hanya .sample) — tidak ada gate mekanis
4. **Tidak ada script npm khusus** — harus dijalankan manual dengan perintah spesifik
5. **Harus dijalankan manual** — hanya ada di header file sebagai "Runner"

---

## 3. Re-verifikasi 2 Gap Lama (STATUS-V2.md, dicatat 10 Agu 2026)

### 3.1 Case 1 — II-4: Seed woltel/brambang (store-golden-test)

**Status catat lama** (STATUS-V2.md:135-139, BUG-BELUM-DIBERESKAN.md:37):
> "seed store-golden-test tidak punya woltel/brambang, hanya beras. Di bawah
> validasi DB (P2) produk tak ada diskipping → case 'pass' lama jadi 'fail'."
> Owner: "butuh woltel/brambang ditambah ke seed atau BASE_PRODUCTS".

**Re-verifikasi saat ini** — golden-dataset.test.ts:41-43:
```typescript
const BASE_PRODUCTS = [
  { id: 'prod-beras', name: 'beras', price: 12000, stock: 50 },
] as const;
```
✅ **woltel/brambang TIDAK ada di BASE_PRODUCTS** — hanya `beras`.

Case 1 (line 298-334) menggunakan `setPendingInDb` untuk menset
`pendingClarification` dengan `cartOps` untuk woltel dan brambang
(line 308-309), lalu memanggil `processMsg('dua duanya')` yang masuk ke
**resolver EXECUTE path**.

Resolver path (conversation.service.ts:486):
```typescript
const { valid: dbValid } = await validateCartOpsAgainstDb(resolved.ops, storeId);
```

`validateCartOpsAgainstDb` (interpreter.ts:144-180):
- Line 148-150: Query semua produk aktif dari DB
- Line 163: `productMap.get(op.product.toLowerCase().trim())`
- Line 164-169: Jika produk tidak ada di DB → `invalid` + `missing`, **tidak dieksekusi**

Karena `woltel` dan `brambang` tidak ada di `BASE_PRODUCTS` (hanya `beras`),
maka `validateCartOpsAgainstDb` akan mengembalikan `valid=[], missing=['woltel','brambang']`
→ `cartOpsExecuted = 0` (bukan 2 yang di-assert di line 325):
```typescript
assert.equal(audit.cartOpsExecuted, 2);
```

**VERDICT: II-4 MASIH BLOCKING.** Case 1 **akan gagal** kecuali woltel/brambang
ditambahkan ke `BASE_PRODUCTS` atau seed data. Ini adalah gap yang belum ter-resolve.

### 3.2 Case B3-b — II-3: `assert.equal` strict pada array `stagesReached`

**Status catat lama** (STATUS-V2.md:145-151, BUG-BELUM-DIBERESKAN.md:36):
> "assert.equal (strict ===) dipakai pada array audit.stagesReached, selalu
> gagal karena reference inequality. Owner: 'skip (b), jangan fix'."

**Re-verifikasi saat ini** — golden-dataset.test.ts, Case B3-b (line 706-728):
```typescript
// Line 721:
assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
```

✅ **Gap sudah FIXED di kode** — sekarang memakai `assert.deepEqual` (bukan
`assert.equal`). Line B3-b **geser** dari line 726 (STATUS-V2.md:145) ke
**line 706–728** (file berkembang seiring penambahan test case sebelumnya).

Tapi **dokumentasi belum di-update**:
- STATUS-V2.md:145 masih mencatat "golden-dataset.test.ts:726" dengan deskripsi
  bug `assert.equal` — sudah tidak akurat (line 726 sekarang adalah `});` penutup)
- BUG-BELUM-DIBERESKAN.md:36 masih terbuka — belum ditandai RESOLVED

**VERDICT: II-3 sudah FIXED di kode, tapi dokumentasi STATUS-V2.md dan
BUG-BELUM-DIBERESKAN.md belum di-update.** Ini adalah dokumentasi debt,
bukan logic bug.

---

## 4. Coverage Gap: P2/P3/P4/P5 di Golden Dataset

| Fix Task | Invarian/Tema | Ada golden dataset case? | Line | Gap? |
|----------|---------------|--------------------------|------|------|
| **P2** | I13 truth boundary (harga dari DB) | ✅ **Ada** | Case P2-I13:756 — raw DB readback, price=12000 bukan 99999 | — |
| **P2** | I13 (umum, via tryProduct) | ✅ **Ada** | Case 5:449-451 — `/Rp\s*12[.,]000/` | — |
| **P3.1** | WorkspaceV2 persist (`updateWorkspaceV2`) | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P3.2** | Migrasi legacy extractedEntities → workspace_v2 | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P4.2** | activeOrder/tryTotal draft vs pending diskriminasi | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P5.1 I-1a** | Subtotal qty=0 tidak termasuk di total | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P5.1 I-2** | reply_draft truncate v2 path | ⚠️ **Parsial** | Case 8:529 — hanya check reply_draft ≤ 2 kalimat via v1 path, tidak verifikasi v2 path truncate | ✅ **GAP** |
| **P5.1 #3/#4/#5** | slice(0,3) warning, qty guard, trim fallback | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P5.2** | Regex truncate (interjeksi BI `?`) | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P5.2** | ESCALATE_REPLY (tanpa emoji) | ❌ **Tidak ada** | — | ✅ **GAP** |
| **P5.2** | Qty symbol konsisten (`x` ASCII) | ❌ **Tidak ada** | — | ✅ **GAP** |

### Detail gap:

**P3.1/P3.2 GAP**: `workspace-v2.test.ts` ada (26 test) tapi hanya unit test
pure pada `workspace.js` (0-LLM, 0-DB per I8 komentar file:8). **Tidak ada**
golden dataset case yang memverifikasi persistensi WorkspaceV2 ke DB via
`updateWorkspaceV2` (conversation.service.ts:337). Jika persist gagal diam-diam,
golden dataset tidak akan menangkapnya.

**P4.2 GAP**: Tidak ada golden dataset case yang membaut draft + pending order
di conversationId yang sama dan memverifikasi bahwa `tryTotal`/`activeOrder`
memilih draft. Ini adalah inti dari P4.2 fix — **tanpa golden dataset case,
fix bisa revert tidak disadari**.

**P5.1/P5.2 GAP**: Hampir semua fix reply composition (truncate, qty guard,
substr, qty symbol) tidak ada di golden dataset. Case 8 (line 529) hanya
memverifikasi `reply_draft ≤ 2 kalimat` di v1 path (interpreter.ts) —
**tidak verifikasi** bahwa v2 path (composeReply + conversation.service.ts:350)
juga truncate. Ini berarti I-2 fix (P5.1) bisa revert tanpa golden dataset yang
menangkapnya.

---

## 5. Relevansi II-4 ke P6

### II-4 (seed woltel/brambang untuk Case 1) adalah **BLOCKING** untuk P6

**Alasan:**
1. P6 bertujuan membuat golden dataset menjadi "architecture gate" — semua
   10+ case harus **selalu loluh** sebagai syarat merge/deploy.
2. Case 1 (resolver EXECUTE — "dua duanya") adalah salah satu 10 case permanen.
3. Karena `validateCartOpsAgainstDb` (conversation.service.ts:486) kini memvalidasi
   produk terhadap DB (I13 fix dari P2), Case 1 **akan gagal** kecuali
   woltel/brambang ada di `BASE_PRODUCTS`.
4. Jika satu case gagal, keseluruhan golden dataset tidak bisa dijadikan gate —
   gate akan "false alarm" atau setengah-setengah.

**Jika tidak di-resolve**: P6 tidak bisa membangun gate yang reliable. Setiap
run test akan ada 1 case (Case 1) yang gagal, membuat gate tidak berguna.

### Rekomendasi urutan sub-task P6

| Sub-task | Deskripsi | Risiko | Bisa dipecah? |
|----------|-----------|--------|---------------|
| **P6.1** | Seed woltel/brambang ke BASE_PRODUCTS (II-4 fix) — tambahkan 2 produk ke `BASE_PRODUCTS` di golden-dataset.test.ts | **RENDAH** | ✅ Ya — 1 file, 2 baris data |
| **P6.2** | Pindahkan golden-dataset.test.ts ke testMatch Jest (`jest.config.cjs`) atau buat script npm `test:golden` | **SEDANG** | ⚠️ Ya, tapi perlu keputusan: Jest ESM support untuk node:test API (shim) — sudah ada `jest.node-test-shim.mjs`, tapi file golden pakai `node:test` native runner bukan Jest. **Butuh keputusan owner** apakah mau migrasi ke Jest atau tetap `tsx --test`. |
| **P6.3** | Tambahkan CI workflow (`.github/workflows/test.yml`) — run `test:chat` + golden dataset setiap PR | **TINGGI** | ✅ Ya — file terpisah, bisa incremental |
| **P6.4** | Tambahkan golden dataset case untuk P3/P4/P5 fixes (workspace_v2 persist, draft vs pending, reply composition) | **TINGGI** | ✅ Ya — 1 case per fix, bisa dipecah |
| **P6.5** | Tambahkan pre-commit hook (husky atau .git/hooks) — run test:chat otomatis sebelum commit | **SEDANG** | ⚠️ Ya, tapi butuh keputusan tooling (husky vs manual) |
| **P6.6** | Update dokumentasi STATUS-V2.md/BUG-BELUM-DIBERESKAN.md — tandai II-3 RESOLVED, II-4 resolved setelah P6.1 | **RENDAH** | ✅ Ya — dokumen terpisah |

> **Priority order**: P6.1 (BLOCKING) → P6.3 (CI gate) → P6.4 (coverage) → P6.2 (test runner) → P6.5 (hook) → P6.6 (docs)
> P6.1 harus selesai **terlebih dahulu** — tanpa ini, gate tidak bisa berfungsi.

---

## 6. Evidence & Verification Method

| Check | Metode | Result |
|-------|--------|--------|
| golden-dataset.test.ts dibaca penuh | `read` tool, 780 lines | ✅ Selesai |
| jest.config.cjs testMatch | `cat` + `--listTests` | ✅ `src/tests/` tidak tercakup |
| package.json scripts | `python3 json` parse | ✅ tidak ada `test:golden` |
| `.github/` CI | `find .github -type f` | ✅ **kosong** — tidak ada CI |
| `.git/hooks/` | `ls .git/hooks/` | ✅ hanya `.sample` files |
| `.pre-commit-config.yaml` | `cat` | ✅ tidak ada |
| ecosystem.config.js | `cat` | ✅ tidak referensi test |
| I8-I15 definisi | `grep -rn` di source + docs | ✅ I9/I14 tidak ditemukan |
| RAILS.md §2/§3 konteks | `sed -n` | ✅ I8 = soft guideline, I13 = non-negotiable |
| II-4 re-verifikasi | `read` BASE_PRODUCTS (line 41-43) + `validateCartOpsAgainstDb` (interpreter.ts:144-180) + resolver path (conversation.service.ts:486) | ✅ MASIH BLOCKING |
| II-3 re-verifikasi | `grep -n` + `read` golden-dataset.test.ts:721 | ✅ sudah pake deepEqual (FIXED) |
| git grep "woltel\|brambang" di golden dataset | `grep` | ✅ hanya di setPendingInDb cartOps, tidak di BASE_PRODUCTS |

---

*Report ini bersifat read-only. Tidak ada kode yang dimodifikasi.  
Hanya laporan-taskP6-audit.md yang dibuat (dokumen baru).*
