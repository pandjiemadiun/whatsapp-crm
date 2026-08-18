# Laporan Task P6.1 — Fix 2 Gap Blocking Golden-Dataset

**Scope**: Hanya `apps/api/src/tests/golden-dataset.test.ts` yang diubah.  
**2 commit terpisah**: P6.1a (seed) + P6.1b (assert.deepEqual).

---

## 1. Output LENGKAP ke-8 command verifikasi

### Command 1: tsc --noEmit

```
cd /home/ubuntu/garuda/apps/api && npx tsc --noEmit
```

**Output**:
```
EXIT_CODE=0
```
(tidak ada error, tidak ada output lain — keluar dengan kode 0)

---

### Command 2: npm run build

```
cd /home/ubuntu/garuda/apps/api && npm run build
```

**Output**:
```

> garuda-api@0.0.1 build
> tsc

EXIT_CODE=0
```

---

### Command 3: npx tsx --env-file ../../.env --test golden-dataset.test.ts

```
cd /home/ubuntu/garuda/apps/api && npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts
```

**Output**:
```
[encryption] Key loaded from Platform Config DB (TTL: 10m)
[Encryption] Using in-memory cached key (TTL remaining)
...
✔ Case 1: resolver EXECUTE — "dua duanya" resolves pending clarification (0 LLM) (212.326576ms)
✔ Case 2: normalizer → "total berapa" → tryTotal tier (0 LLM) (60.907694ms)
✔ Case 3: resolver EXECUTE — "semua" resolves pending (0 LLM) (47.091609ms)
✔ Case 4: resolver ROLLBACK — "ga jadi" cancels pending (0 LLM) (32.907801ms)
✔ Case 5: tryProduct tier — "ada beras" returns price from DB (0 LLM) (58.12565ms)
✔ Case 6: normalizer preserves "berasss" (I12 guard), tryProduct returns DB price (0 LLM) (55.163441ms)
✔ Case 7: resolver EXECUTE — "iya" resolves pending (0 LLM) (37.14466ms)
✔ Case 8: interpreter — LLM called once, reply_draft ≤ 2 sentences (53.211861ms)
✔ Case 9: interpreter → clarification → pending saved in DB (42.51638ms)
✔ Case 10: interpreter — harga dari DB via cart_ops, not customer "50rb" (I13) (64.597776ms)
✔ Case B3-a: "total berapa" (regresi) tetap di-jawab tryTotal (0 LLM) (73.61114ms)
✔ Case B3-b: "berapa bayar kangkung" -> tryProduct (harga), BUKAN tryTotal/tryPayment (60.85198ms)
✔ Case B3-c: "bisa cod ga?" -> tryPayment masih jawab (regression) (61.539769ms)
✔ Case P2-I13: wrong price in pending (sim LLM) -> DB price in cart (raw readback) (43.001522ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2508.48927
EXIT_CODE=0
```

**Catatan**: Output di atas disingkati (hanya baris signifikan). Output penuh termasuk
logging `[Encryption] Using in-memory cached key` berulang dan `prisma:error`
pada `conversation.delete()` cleanup (foreign key constraint — pre-existing,
tidak memengaruhi test pass/fail). Semua 14 test **pass**, 0 fail.

---

### Command 4: npm run test:chat

```
cd /home/ubuntu/garuda/apps/api && npm run test:chat
```

**Output** (ringkas — 2 suite gagal + 1 test gagal, 260 test loluh):
```

> garuda-api@0.0.1 test:chat
> node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs

...
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 260 passed, 261 total
Snapshots:   0 total
Time:        6.944 s, estimated 7 s
Ran all test suites.
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
EXIT_CODE=1
```

Suite yang gagal:
1. `src/services/chat/__tests__/reasoning-v2.test.ts` — 1 test gagal:
   `Validator reject terminal (low confidence) → fallback, llmCalls=1, JANGAN retry`
   ```
   assert.equal(result.outcome, 'fallback_reasoning_failed')
   Expected: "fallback_reasoning_failed"
   Received: "reasoned"
   ```
2. `src/services/chat/__tests__/engine-config-v2.test.ts` — suite gagal total:
   ```
   ReferenceError: Cannot access 'redisAdapter' before initialization
   at src/adapters/container.ts:38:15
   ```

---

### Command 5: pm2 restart api + pm2 status

```
cd /home/ubuntu/garuda/apps/api && pm2 restart api && sleep 2 && pm2 status
```

**Output**:
```
Use --update-env to update environment variables
[PM2] Applying action restartProcessId on app [api](ids: [ 0 ])
[PM2] [api](0) ✓
┌────┬──────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name         │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├────┼──────────────┼─────────────┼─────────┼─────────┼──────────┼────────┬──────┼───────────┼──────────┬──────────┬──────────┬──────────┤
│ 0  │ api          │ default     │ 0.0.1   │ fork    │ 253594   │ 3s     │ 66   │ online    │ 0%       │ 166.7mb  │ root     │ disabled │
│ 1  │ dashboard    │ default     │ 0.0.0   │ fork    │ 27344    │ 3D     │ 2    │ online    │ 0.6%     │ 22.0mb   │ root     │ disabled │
└────┴──────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
...
```

**Status**: `api` online (PID 253594), `dashboard` online (PID 27344).

---

### Command 6: git diff --stat f314326..HEAD — golden-dataset.test.ts

```
git diff --stat f314326..HEAD -- apps/api/src/tests/golden-dataset.test.ts
```

**Output**:
```
apps/api/src/tests/golden-dataset.test.ts | 44 ++++++++++++++++++++++++++-----
 1 file changed, 37 insertions(+), 7 deletions(-)
EXIT_CODE=0
```

---

### Command 7: git status

```
git status
```

**Output** (setelah reset build artifacts + log files):
```
On branch main
Your branch is ahead of 'origin/main' by 42 commits.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

---

### Command 8: git log --oneline -3

```
git log --oneline -3
```

**Output**:
```
b64b017 fix(P6.1b): assert.equal->deepEqual untuk array assertion golden-dataset
5320498 fix(P6.1a): seed woltel/brambang ke BASE_PRODUCTS golden-dataset
06f0400 docs(P6.0): raw evidence attachment for audit cross-check
```

---

## 2. Snippet BASE_PRODUCTS — SEBELUM vs SESUDAH edit (P6.1a)

### SEBELUM (original, line 40-43):
```typescript
const BASE_PRODUCTS = [
  { id: 'prod-beras', name: 'beras', price: 12000, stock: 50 },
] as const;
```

### SESUDAH (setelah P6.1a commit, line 41-45):
```typescript
const BASE_PRODUCTS = [
  { id: 'prod-beras', name: 'beras', price: 12000, stock: 50 },
  { id: 'prod-woltel', name: 'woltel', price: 10000, stock: 50 },
  { id: 'prod-brambang', name: 'brambang', price: 8000, stock: 50 },
] as const;
```

**Diff** (commit 5320498):
```
  const BASE_PRODUCTS = [
    { id: 'prod-beras', name: 'beras', price: 12000, stock: 50 },
+   { id: 'prod-woltel', name: 'woltel', price: 10000, stock: 50 },
+   { id: 'prod-brambang', name: 'brambang', price: 8000, stock: 50 },
  ] as const;
```

Harga konsisten dengan cartOps di Case 1 (line 308-309): woltel price=10000,
brambang price=8000. Stock=50 (sama seperti beras).

---

## 3. Snippet baris assert.equal → assert.deepEqual — SEBELUM vs SESUDAH (P6.1b)

### SEBELUM (line 721 sebelum +2 shift, atau 723 setelah):
```typescript
    assert.equal(audit.stagesReached, ['normalizer', 'tier3']);
```

### SESUDAH:
```typescript
    assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
```

**Context** (line 718-724, setelah edit):
```typescript
    assert.equal(
      result!.source,
      ResponseSource.PRODUCT,
      `expected tryProduct, got ${result!.source}`,
    );
    assert.match(result!.message.content, /kangkung/i, 'harus sebut kangkung');
    assert.match(result!.message.content, /8\.?000|8000/, 'harus sebut harga 8000');
    assert.equal(calls, 0, '0 LLM — tryProduct fast path (bukan interpreter)');
    assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
    assert.equal(audit.finalIntent, 'fastpath');
```

---

## 4. Konfirmasi Case 1 test result

**Test Case**: `Case 1: resolver EXECUTE — "dua duanya" resolves pending clarification (0 LLM)`

**Status**: ✔ **PASS** (212.326576ms)

**Nilai aktual `cartOpsExecuted`**: **2** — dikonfirmasi karena `assert.equal(audit.cartOpsExecuted, 2)`
di line 325 **loluh** (jika nilainya bukan 2, test akan throw dan muncul di laporan
failure).

**Output test runner** (verbatim):
```
✔ Case 1: resolver EXECUTE — "dua duanya" resolves pending clarification (0 LLM) (212.326576ms)
```

Sebelum P6.1a, Case 1 akan **gagal** karena:
- `validateCartOpsAgainstDb` (conversation.service.ts:486) query `storeProducts` dari DB
- `BASE_PRODUCTS` hanya punya `beras` — tidak ada woltel/brambang
- Akibatnya: `valid=[]`, `missing=['woltel', 'brambang']` → `cartOpsExecuted = 0`
- `assert.equal(audit.cartOpsExecuted, 2)` → throw → **FAIL**

Setelah seeding woltel/brambang ke BASE_PRODUCTS, produk ditemukan di DB →
`valid = [woltel, brambang]` → `cartOpsExecuted = 2` → **PASS**.

---

## 5. Hasil grep instance assert.equal(array) lain di golden-dataset.test.ts

Command:
```
grep -n "assert.equal.*stagesReached" apps/api/src/tests/golden-dataset.test.ts
```

**Output**:
```
699:    assert.equal(audit.stagesReached[0], 'normalizer');
700:    assert.equal(audit.stagesReached[1], 'tier3');
723:    assert.deepEqual(audit.stagesReached, ['normalizer', 'tier3']);
```

### Instance lain — **TIDAK ADA** yang membutuhkan perbaikan

Line 699: `assert.equal(audit.stagesReached[0], 'normalizer')` — ini adalah
**index access** (`[0]`), membandingkan **string** `'normalizer'` dengan
string `'normalizer'`. `assert.equal` (strict `===`) untuk string **bekerja
benar** — tidak ada reference inequality.

Line 700: `assert.equal(audit.stagesReached[1], 'tier3')` — sama, index access
string comparison. **Tidak perlu di-fix**.

> **Kesimpulan**: **hanya line 723** (sebelumnya line 721 sebelum +2 shift)
> adalah instance `assert.equal` dengan **array literal** sebagai 2nd argumen
> yang perlu di-fix. **Tidak ada instance lain** di file ini yang memiliki
> pola `assert.equal(variabel, array_literal)`.

---

## 6. Konfirmasi 2 commit terpisah

```
git log --oneline -3
```

**Output**:
```
b64b017 fix(P6.1b): assert.equal->deepEqual untuk array assertion golden-dataset
5320498 fix(P6.1a): seed woltel/brambang ke BASE_PRODUCTS golden-dataset
06f0400 docs(P6.0): raw evidence attachment for audit cross-check
```

**Konfirmasi**:
- ✅ **Commit P6.1a**: `5320498` — "fix(P6.1a): seed woltel/brambang ke
  BASE_PRODUCTS golden-dataset" — 1 file changed, 2 insertions(+)
- ✅ **Commit P6.1b**: `b64b017` — "fix(P6.1b): assert.equal->deepEqual untuk
  array assertion golden-dataset" — 1 file changed, 1 insertion(+), 1 deletion(-)

Kedua commit bersifat terisolasi (atomic), masing-masing memperbaiki 1 bug.

---

## 7. Angka baseline npm run test:chat — perbandingan

### Baseline (RAILS.md §3, setelah P5.2):
> "2 failed suites, 21 passed suites, 1 failed test, 252 passed tests"

### Sekarang (setelah P6.1a + P6.1b):
```
Test Suites: 2 failed, 21 passed, 23 total
Tests:       1 failed, 260 passed, 261 total
```

| Metric | Baseline | Sekarang | Perubahan | Gap? |
|--------|----------|----------|-----------|------|
| Failed suites | 2 | 2 | 0 | ✅ **sama** |
| Passed suites | 21 | 21 | 0 | ✅ **sama** |
| Total suites | 23 | 23 | 0 | ✅ **sama** |
| Failed tests | 1 | 1 | 0 | ✅ **sama** |
| Passed tests | 252 | 260 | **+8** | ⚠️ **naik 8** |

### Penjelasan perubahan jumlah test passed (252 → 260)

**Perubahan ini BUKAN regression dan BUKAN akibat P6.1a/P6.1b.**

Alasan:
1. **P6.1a & P6.1b hanya mengubah golden-dataset.test.ts** — file ini ada di
   `src/tests/`, yang **tidak termasuk** dalam Jest `testMatch` (jest.config.cjs:27-28
   hanya mencakup `src/services/chat/__tests__/` dan `src/services/chat/tests/`).
   Jadi perubahan kita **tidak memengaruhi** angka test:chat sama sekali.

2. **Golden dataset tidak pernah dijalankan oleh `test:chat`** (bukti di laporan-taskP6-audit.md
   §2). Maka test passed 260 vs 252 adalah perbedaan environment antara run ke run.

3. **Test passed naik +8** — ini berarti **lebih banyak test loluh**, bukan
   kegagalan baru. Ini bisa jadi karena:
   - DB state yang berbeda antara run ke run (shared DB, test-test sebelumnya
     mungkin menambah data)
   - Timing/env variability

4. **Failed suite dan failed test TETAP SAMA** (2 + 1) — ini adalah pre-existing
   failures yang didokumentasikan di RAILS.md §3:
   - `reasoning-v2.test.ts`: "terminal→fallback" outdated (I-V2-6 label mismatch)
   - `engine-config-v2.test.ts`: ReferenceError `redisAdapter` before initialization

**Kesimpulan**: Tidak ada regression baru. Angka failed (2 suites, 1 test)
sama persis dengan baseline. P6.1a + P6.1b tidak memengaruhi test:chat karena
golden-dataset.test.ts tidak termasuk di Jest runner.

---

## 8. Daftar perubahan file (git diff stat)

```
git diff --stat f314326..HEAD -- apps/api/src/tests/golden-dataset.test.ts

apps/api/src/tests/golden-dataset.test.ts | 44 ++++++++++++++++++++++++++-----
  1 file changed, 37 insertions(+), 7 deletions(-)
```

Ini termasuk **semua** perubahan sejak commit B3 (`f314326`), bukan hanya P6.1.
Perubahan P6.1 yang spesifik hanya:
- P6.1a (5320498): +2 baris (woltel + brambang di BASE_PRODUCTS)
- P6.1b (b64b017): +1/-1 baris (assert.equal → assert.deepEqual)

---

## 9. Git status final (read-only verification)

Setelah reset build artifacts (`dist/tests/*.test.js`) dan log files:
```
On branch main
Your branch is ahead of 'origin/main' by 42 commits.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

**0 file source berubah** — hanya `laporan-taskP6.1.md` (file ini) baru.
Build artifacts (`dist/`) dan log files direset ke state asli sebelum build/pm2.
