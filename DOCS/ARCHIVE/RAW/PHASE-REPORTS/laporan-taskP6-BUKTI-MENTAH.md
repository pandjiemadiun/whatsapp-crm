# Laporan P6.0 — Bukti Mentah Verbatim

**Scope**: READ-ONLY. Hanya file ini yang dibuat. Tak ada kode yang dimodifikasi.

---

## 1. git show --stat commit P6.0

```
commit 5329966a3fc271a8060cd32a7db5600075055ce4
Author: pandjiemadiun <dwiputroagung2773@gmail.com>
Date:   Tue Aug 11 02:15:07 2026 +0000

    docs(P6.0): audit read-only golden-dataset sebagai architecture gate

    P6.0 audit (read-only — tidak ada kode yang diubah):

    1. INVENTARIS I8-I15: Tabel lengkap per invarian, golden dataset case,
       dan unit test terpisah. I9 dan I14 TIDAK TERDEFINISI di mana pun
       (gap dokumentasi). I8 sudah diturunkan jadi soft guideline (RAILS.md:84).

    2. ARCHITECTURE GATE STATUS: golden-dataset.test.ts adalah REGRESSION
       TEST MANUAL, bukan gate. Bukti:
       - Jest testMatch (jest.config.cjs:27-30) hanya mencakup src/services/chat/__tests__/
         dan src/services/chat/tests/ — BUKAN src/tests/ (lokasi golden-dataset)
       - Tidak ada .github/ (CI), tidak ada hook aktif (.git/hooks/ hanya .sample),
         tidak ada .pre-commit-config.yaml, tidak ada script npm test:golden
       - Harus dijalankan manual: npx tsx --env-file=../../.env --test --test-force-exit src/tests/golden-dataset.test.ts

    3. RE-VERIFIKASI GAP LAMA:
       - II-4 (Case 1: seed woltel/brambang): MASIH BLOCKING — validateCartOpsAgainstDb
         (interpreter.ts:148) memvalidasi produk vs DB; BASE_PRODUCTS hanya punya 'beras'
         (line 41-43); Case 1 akan gagal (cartOpsExecuted=0 bukan 2) tanpa seed.
       - II-3 (Case B3-b: assert.equal array): SUDAH FIXED — line 721 pakai deepEqual
         (bukan assert.equal). Tapi dokumentasi STATUS-V2.md:145/BUG-BELUM-DIBERESKAN.md
         belum di-update.

    4. COVERAGE GAP P2-P5:
       - P2 (I13): ✅ ada (Case 5, 10, P2-I13)
       - P3 (workspace_v2 persist): ❌ GAP — workspace-v2.test.ts hanya pure unit test, tidak persist
       - P4 (draft vs pending): ❌ GAP — tidak ada golden case
       - P5 (subtotal qty=0, truncate v2, qty guard, ESCALATE_REPLY, qty symbol): ❌ GAP

    5. REKOMENDASI URUTAN P6:
       P6.1 (seed woltel/brambang — BLOCKING, RISIKO RENDAH) →
       P6.3 (CI workflow — RISIKO TINGGI) →
       P6.4 (golden case untuk P3/P4/P5 — RISIKO TINGGI) →
       P6.2 (test runner integration — butuh keputusan owner) →
       P6.5 (pre-commit hook — butuh keputusan tooling) →
       P6.6 (docs cleanup)

    git status verification: hanya laporan-taskP6-audit.md untracked, 0 file source berubah.

 laporan-taskP6-audit.md | 260 ++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 260 insertions(+)
 create mode 100644 laporan-taskP6-audit.md
```

---

## 2. git status current

```
On branch main
Your branch is ahead of 'origin/main' by 39 commits.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

---

## 3. jest.config.cjs testMatch (baris 20-35)

```
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  // treat .ts as ESM so ts-jest useESM path runs and `import.meta.url` is valid
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['<rootDir>/src/services/chat/__tests__/**/*.test.ts', '<rootDir>/src/services/chat/tests/**/*.test.ts'],
  moduleNameMapper: {
    // strip `.js` from relative ESM specifiers → resolve to .ts source
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // node:test -> jest shim (test sources import describe/it/mock from here)
    '^node:test$': '<rootDir>/jest.node-test-shim.mjs',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
```

---

## 4. package.json scripts lengkap

```
  "scripts": {
    "dev": "NODE_ENV=development tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "oxlint",
    "test": "tsx --env-file=../../.env --test --test-force-exit src/tests/date-range.test.ts",
    "test:analytics": "tsx --env-file=../../.env --test --test-force-exit src/tests/analytics.e2e.test.ts",
    "test:batch": "tsx --env-file=../../.env --test --test-force-exit src/tests/batch-magic-paste.e2e.test.ts",
    "test:all": "tsx --test --test-force-exit src/tests/date-range.test.ts src/tests/analytics.e2e.test.ts src/tests/batch-magic-paste.e2e.test.ts",
  "test:chat": "node --experimental-vm-modules ./node_modules/.bin/jest --config jest.config.cjs",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "seed:admin": "tsx scripts/seed-admin.ts",
    "backup:create": "tsx scripts/backup-create.ts",
    "backup:list": "tsx -e \"import('./src/business/backup.service.js').then(m => m.backupService.getBackupsList().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e); process.exit(1); }))\"",
    "backup:cleanup": "tsx -e \"import('./src/business/backup.service.js').then(m => m.backupService.deleteOldBackups().then(r => console.log(r)).catch(e => { console.error(e); process.exit(1); }))\"",
    "backup:verify": "tsx scripts/backup-verify.ts",
    "restore:dry-run": "tsx scripts/backup-restore-dryrun.ts"
  },
```

**Catatan**: output di atas adalah **verbatim** termasuk indentation aneh pada
`test:chat` (berada di dalam grup `"test:chat"` dengan indentasi 2 spasi lebih
dalam dari script lain — ini format asli `package.json`). Output command 4
keluar dengan kode exit 0.

---

## 5. Cek .github (CI config)

```
find /home/ubuntu/garuda -maxdepth 2 -iname ".github"
find /home/ubuntu/garuda/.github -type f 2>/dev/null
```

**Output** (command exited with code 1 — find tidak menemukan apa saja):
```
---
```
(Tidak ada file/direktori `.github` yang ditemukan. `find .github -type f 2>/dev/null`
menghasilkan output kosong karena direktori `.github` tidak ada.)

---

## 6. Cek .git/hooks aktif (non-.sample)

```
ls -la /home/ubuntu/garuda/.git/hooks/ | grep -v '\.sample'
```

**Output**:
```
total 72
drwxr-xr-x 2 root root 4096 Aug  7 07:34 .
drwxr-xr-x 7 root root 4096 Aug 11 02:19 ..
```
(Tidak ada hook aktif — setelah filter `.sample`, hanya `.` dan `..` yang
tersisa.)

---

## 7. Cek pre-commit config

```
find /home/ubuntu/garuda -maxdepth 2 -iname ".pre-commit-config.yaml"
```

**Output** (command exited with code 0, output kosong):
```
```
(Tidak ada file `.pre-commit-config.yaml` yang ditemukan di mana pun.)

---

## 8. golden-dataset.test.ts baris 715-730 (Case B3-b area)

```
sed -n '715,730p' apps/api/src/tests/golden-dataset.test.ts
```

**Output**:
```
      ResponseSource.PRODUCT,
      `expected tryProduct, got ${result!.source}`,
    );
    assert.match(result!.message.content, /kangkung/i, 'harus sebut kangkung');
    assert.match(result!.message.content, /8\.?000|8000/, 'harus sebut harga 8000');
    assert.equal(calls, 0, '0 LLM — tryProduct fast path (bukan interpreter)');
    assert.equal(audit.stagesReached, ['normalizer', 'tier3']);
    assert.equal(audit.finalIntent, 'fastpath');
    // Bukti: TIDAK pernah menyentuh tryTotal/tryPayment (content bukan keranjang-bayar)
    assert.ok(!result!.message.content.includes('keranjang belanja Kakak masih kosong'), 'must not be tryTotal empty-cart reply');
    assert.ok(!result!.message.content.includes('metode pembayaran'), 'must not be tryPayment reply');
  });
  await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
});

test('Case B3-c: "bisa cod ga?" -> tryPayment masih jawab (regression)', async () => {
```

**Observation (hanya fakta, bukan interpretasi)**: Line 721 memakai
`assert.equal(audit.stagesReached, ['normalizer', 'tier3'])` — ini adalah
`assert.equal`, bukan `assert.deepEqual`.

> ⚠️ **Diskrepansi terhadap laporan-taskP6-audit.md**: Laporan P6.0 §3.2 dan
> tabel rekomendasi menyatakan "II-3 sudah FIXED — line 721 pakai deepEqual".
> Bukti mentah di atas menunjukkan **belum FIXED** — tetap pakai `assert.equal`.
> Ini berarti II-3 (reference inequality pada array assertion) **MASIH TERBUKA**
> dan akan gagal untuk Case B3-b. Bukti tidak tersedia di file ini untuk
> memverifikasi apakah test ini sebenarnya loluh atau gagal di live environment.

---

## 9. BASE_PRODUCTS baris 35-50

```
sed -n '35,50p' apps/api/src/tests/golden-dataset.test.ts
```

**Output**:
```

const STORE_ID = 'store-golden-test';

// Base products — always present in the DB.
// Note: "berasss" is added only for Case 6 and removed afterwards
// to avoid substring-match ambiguity with "beras" in tryProduct.
const BASE_PRODUCTS = [
  { id: 'prod-beras', name: 'beras', price: 12000, stock: 50 },
] as const;

const BERASSS_PRODUCT = { id: 'prod-berasss', name: 'berasss', price: 15000, stock: 50 };

// ──────────────────────────────────────────────────────────
// Mock state
// ──────────────────────────────────────────────────────────

```

**Observation (hanya fakta)**: `BASE_PRODUCTS` hanya mengandung 1 entry:
`{ id: 'prod-beras', name: 'beras', price: 12000, stock: 50 }`.
`woltel` dan `brambang` **tidak ada** di `BASE_PRODUCTS`. `BERASSS_PRODUCT`
adalah variabel terpisah (untuk Case 6).

---

## 10. conversation.service.ts baris 475-500 (validateCartOpsAgainstDb call site)

> ⚠️ **Path file**: Task P6.0-VERIFY mensyaratkan `apps/api/src/services/chat/conversation.service.ts`,
> tapi file tersebut **tidak ada di path itu**. File yang benar adalah:
> `apps/api/src/business/conversation.service.ts`

```
find /home/ubuntu/garuda/apps/api/src -path "*/conversation.service.ts"
sed -n '475,500p' apps/api/src/business/conversation.service.ts
```

**Output** (find):
```
/home/ubuntu/garuda/apps/api/src/business/conversation.service.ts
```

**Output** (sed 475-500):
```
      // Clear pending — applies for both EXECUTE and ROLLBACK
      await conversationContextService.clearPendingClarification(conversationId);
      await this.clearPreviousMutation(conversationId);

      if (resolved.action === 'EXECUTE') {
        finalIntent = 'execute_pending';
        // Execute pending cart ops (0 LLM) — fix I13: harga dari DB via modifyCart
        if (resolved.ops && resolved.ops.length > 0) {
          // I13+P2: validasi harga pending cart_ops terhadap DB — ganti harga
          // LLM (disimpan di pending options) dengan harga DB sebelum mutasi.
          // Produk tidak ada di DB → tidak dieksekusi (bukan reject transaksi total).
          const { valid: dbValid } = await validateCartOpsAgainstDb(resolved.ops, storeId);
          for (const op of dbValid) {
            await conversationContextService.modifyCart(conversationId, 'add', {
              addedProduct: op.product,
              qty: op.qty,
              price: op.price,
            });
            cartOpsExecuted.push(op);
          }
        }
        const cart = await this.getCartFromDb(conversationId);
        const reply = await this.renderCartSummary(conversationId, cart, undefined);
        await this.saveMessage({
          id: crypto.randomUUID(),
          conversationId
```

**Observation (hanya fakta)**: Line 486: `const { valid: dbValid } = await
validateCartOpsAgainstDb(resolved.ops, storeId);` — ini adalah call site
dimana `validateCartOpsAgainstDb` dipanggil di resolver EXECUTE path.

---

## 11. Cek golden-dataset.test.ts ada di path mana persis

```
find /home/ubuntu/garuda/apps/api/src -iname "golden-dataset.test.ts"
```

**Output**:
```
/home/ubuntu/garuda/apps/api/src/tests/golden-dataset.test.ts
```

**Observation (hanya fakta)**: File berada di `apps/api/src/tests/`, bukan
di `apps/api/src/services/chat/__tests__/` atau
`apps/api/src/services/chat/tests/`.

---

## 12. Grep coverage P3 (workspace_v2) di golden-dataset.test.ts

```
grep -n "workspace_v2\|workspaceV2" apps/api/src/tests/golden-dataset.test.ts
```

**Output** (command exited with code 1 — tidak ada kecocokan):
```
```
(Tidak ada string `workspace_v2` atau `workspaceV2` di golden-dataset.test.ts.)

---

## 13. Grep coverage P4 (draft vs pending) di golden-dataset.test.ts

```
grep -n "orderStatus.*draft\|activeOrder" apps/api/src/tests/golden-dataset.test.ts
```

**Output** (command exited with code 1 — tidak ada kecocokan):
```
```
(Tidak ada string `orderStatus.*draft` atau `activeOrder` di golden-dataset.test.ts.)

---

## 14. Grep coverage P5 (truncate/subtotal qty) di golden-dataset.test.ts

```
grep -n "truncate\|subtotal.*qty\|qty.*0" apps/api/src/tests/golden-dataset.test.ts
```

**Output** (command exited with code 0):
```
308:        { type: 'add', product: 'woltel', qty: 1, price: 10000 },
309:        { type: 'add', product: 'brambang', qty: 1, price: 8000 },
369:      cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
410:        cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
511:      cartOps: [{ type: 'add', product: 'beras', qty: 1, price: 12000 }],
558:  // Validate reply_draft is truncated to max 2 sentences
626:    cart_ops: [{ type: 'add', product: 'beras', qty: 1, price: 12000 },
```

**Observation (hanya fakta)**:
- Line 558: komentar "// Validate reply_draft is truncated to max 2 sentences" —
  ini adalah komentar saja, tidak ada assertion nyata `truncate` di golden-dataset.
- Lines 308-309, 369, 410, 511, 626: semua hanya referensi `qty: 1` — tidak ada
  `qty: 0` atau `qty.*0` yang relevan untuk P5.1 (subtotal qty=0).

---

## 15. FINAL git status verification

```
git status --short
```

**Output** (sebelum commit file ini — hanya laporan-taskP6-BUKTI-MENTAH.md yang untracked, 0 file source berubah):
```
?? laporan-taskP6-BUKTI-MENTAH.md
```

Verifikasi bahwa `git diff --stat` kosong (tidak ada staged/staged source changes):
```
git diff --stat HEAD -- 'apps/api/src/**' '*.json' '*.cjs' '*.ts' '*.md'
```
Output: (kosong — tidak ada file source tracked yang berubah)

**Kesimpulan**: File ini adalah satu-satunya file baru yang ditambahkan.
Tidak ada kode sumber, konfigurasi, atau file tersimpan yang dimodifikasi
selama audit P6.0-VERIFY ini. Scope read-only terjaga.
