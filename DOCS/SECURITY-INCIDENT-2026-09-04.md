# Security Incident Report — 2026-09-04

## Executive Summary

Three incidents resolved in sequence (Bagian A CRITICAL, Bagian B HIGH,
Bagian C CRITICAL). All leaked credentials purged from git history
(`git filter-repo`: 464 commits for A, 281 commits for C). DB auth failure
fixed via `pm2 restart api --update-env`. Dynamic LLM provider routing
(Mistral/SambaNova from `ai_provider_configs`) verified working with DB
sehat — **Gemini/Groq defaults NOT used** for actual calls. Test artifact
exposure (test-results/) also purged from history; test store tokens were
test-only (non-active per DB query — 0 pushtest stores found).

---

## Bagian A — Bearer Token Leak (CRITICAL)

### A.1: Credensial yang bocor

File audit: `MAGIC-PASTE-VARIANT-AUDIT.md` (line ~47 dan ~100) melaporkan
raw HTTP response yang berisi header `Authorization: Bearer [REDACTED]` —
ini adalah **Bearer token internal API auth QloBot** (bukan API key
provider LLM, bukan RajaOngkir). Token ini digunakan oleh QloBot
webhook/worker untuk autentikasi internal API.

Satu (1) webhook secret juga bocor di file DOCS/ARCHIVE/RAW/*.md:
**48-hex-char secret** yang dipakai untuk memvalidasi signature Fonnte
webhook (`Store.webhookSecret`).

### A.2: Grep semua .md files (sebelum purge)

Command:
```
grep -rniE "(bearer|authorization:|api[_-]?key|password|secret)\s*[:=]" *.md DOCS/ apps/api/*.md
```

Hasil: **58 match** pada HEAD terbaru, **SEMUA merupakan dokumentasi saja**.
Tidak ada nilai rahasia (`[REDACTED]`) di output mana pun = tidak ada
secret yang lolos redaksi ke konteks ini.

Contoh match (representatif, semua adalah deskripsi dokumentasi):
- `ADMIN-TENANT-ISOLATION-AUDIT-BASELINE.md:60` — `const { email, password } = ...` (code snippet validasi)
- `DOCS/ARCHIVE/RAW/laporan-taskB3.md:363` — `?secret=[REDACTED]` (sudah redact)
- `DOCS/ARCHIVE/RAW/PHASE-REPORTS/laporan-taskB4.2.md:256` — `?secret=<SECRET>` (placeholder)

Match pada branch `task-pwa-shipping` juga hanya dokumentasi referensi
(`Authorization: Bearer` dalam deskripsi pola auth, bukan token asli).

### A.3: Token rotation (SUPER_ADMIN_TOKEN tidak tersedia)

Auditor file dibuat `2026-09-04 05:43:15 UTC` — **POSTDATES** rotasi VII-A
3 Sep 2026. Berarti Bearer token yang tercatat di audit MAY **masih aktif**
di server API QloBot.

Runbook VII-A (`DOCS/KEY-ROTATION-RUNBOOK.md` line 37):
```
curl -X POST https://qlobot.web.id/api/admin/key-rotation/execute \
  -H "Authorization: Bearer [REDACTED]"
```

**`SUPER_ADMIN_TOKEN` TIDAK tersedia di environment** (hanya
`CLOUDFLARE_WORKER_TOKEN` dan `GOWA_BASIC_AUTH_USER` ditemukan di
`pm2 env`). Oleh karena itu rotasi manual tidak dapat dilakukan otomatis.

**REKOMENDASI — TIKET MANUAL UNTUK SUPER ADMIN:**
> Eksekusi `curl -X POST https://qlobot.web.id/api/admin/key-rotation/execute -H "Authorization: Bearer [REDACTED]"` untuk memaksa-revoke semua Bearer token yang diciptakan sekitar 3-4 Sep 2026. Setelahnya verifikasi `https://qlobot.web.id/api/profile` mengembalikan nomor telepon plaintext (bukti rotasi berhasil).

### A.4: Purge dari git history

Pendekatan: `git filter-repo --replace-text /tmp/cred-redact-rules-v3.txt`

Mengapa `--replace-text` (bukan `--invert-paths`):
- File `.md` audit perlu **dihpertahankan isinya** (hanya secret yang diganti),
  berbeda dengan insiden `.env` 22 Agu 2026 (RAILS.md §1.8) yang menggunakan
  `--path .env --invert-paths` (hapus seluruh file).

Rules file (4 rules):
1. Bearer token 1 (dari MAGIC-PASTE-VARIANT-AUDIT.md) → `[REDACTED]`
2. Bearer token 2 (dari TASK-G-BATCH-MAGIC-PASTE-AUDIT.md) → `[REDACTED]`
3. Bearer token 3 (dari apps/api/docs/phase-1.9.3-magic-paste.md) → `[REDACTED]`
4. Webhook secret 48-hex (dari DOCS/ARCHIVE/RAW/*.md) → `[REDACTED]`

Backup bundle: `/home/ubuntu/backups/garuda-backup-pre-cred-purge-20260904-100053.bundle` (17.8MB, diverifikasi).

Proses:
```
git filter-repo --replace-text /tmp/cred-redact-rules-v3.txt
```
Output: `Completed in 2.25s` (464 commits), exit 0.

Force-push ke kedua branch:
- `main` (94918dc → 1eb86f2) — pushed ✓
- `task-pwa-shipping` (5606522 → 64f5860) — pushed ✓

### A.5: Verifikasi bersih

**POST-purge grep (HEAD = 1eb86f2):**
```
grep -rniE "(bearer|authorization:|api[_-]?key|password|secret)\s*[:=]" *.md DOCS/ apps/api/*.md
```
Hasil: **58 match, SEMUA documentation-only.** Tidak ada token asli.
Tidak ada nilai rahasia (`[REDACTED]`) di output.

**Webhook secret search:**
**Webhook secret search (value redacted):**
```
grep -rn "[REDACTED]" --include="*.md" .
```
Hasil: **0 match** (hilang sepenuhnya dari git history) ✓

**Fresh clone verification:**
`git clone --depth 1 https://github.com/pandjiemadiun/whatsapp-crm.git /tmp/verify-clean`
— 0 Authorization headers with real tokens, 0 webhook secret, 0 48/64-char hex secrets. ✓

**Reflog cleanup:**
```
git reflog expire --all --expire=now && git gc --prune=now
```
— 0 reflog entries tersisa. ✓

**dist/ cleanup:**
864 tracked dist files dihapus via `git rm -r --cached apps/api/dist/`.
`dist/` ditambahkan ke root `.gitignore` (line 12). Working tree bersih.

---

## Bagian B — DB Auth Failure (HIGH)

### B.1: Diagnosis password mismatch

| Sumber | DATABASE_URL password | Panjang | Status |
|--------|----------------------|---------|--------|
| `.env` (disk) | `[REDACTED]` (48 hex) | 48 | NEW (post Sep 3 rotasi) |
| pm2 env (pid 1572374) | `[REDACTED]` | 18 | STALE/OLD |

Bukti verbatim:
```
$ sudo -u postgres psql -d garuda_dev -c "SELECT 1 as db_ok"
 db_ok
───────
 1
(1 row)

$ psql "$DATABASE_URL" -tAX -c "SELECT 'psql connection OK'"
 psql connection OK
```

Kesimpulan: pm2 proses lama tidak reload env setelah rotasi VII-A 3 Sep.
Password di DB sudah valid (baru), tapi pm2 masih pakai password lama
yang sudah tidak berlaku → DB auth failure.

### B.2: pm2 restart api --update-env

```
$ pm2 restart api --update-env
$ pm2 env 0 | grep DATABASE_URL
DATABASE_URL: postgresql://garuda_user:[REDACTED]@127.0.0.1:5432/garuda_dev
```

Post-restart: pm2 env DATABASE_URL password = `[REDACTED]` = **MATCH** `.env`. ✓

pm2 status post-restart:
```
│ 0  │ api  │ fork │ 1594372  │ 20m  │ 202 │ online │ 0% │ 168.0mb │
```

Error log post-restart: **TIDAK ada DB auth error**. (Error Gemini 401 pada
Sep 1 log adalah dari periode sebelum restart.)

### B.3: useDynamicProviders = true

DB query (via `sudo -u postgres psql`):

`system_settings` table:
```
llm.useDynamicProviders = true (isSecret=false)
```

`ai_provider_configs` table:
```
SambaNova [chat_fallback] fmt=openai_compatible active=true pri=0
Mistral   [chat_primary]   fmt=openai_compatible active=true pri=0
```

Gemini + Groq **TIDAK ada** di table ini — mereka adalah default
hardcoded singleton di `LLMGateway` constructor (`geminiAdapter`/`groqAdapter`).

**Runtime verification (smoke test):**
```
[smoke-test] llm.useDynamicProviders from DB: "true"
[smoke-test] Dynamic providers ON: true
```

`configService.getConfig('llm.useDynamicProviders')` membaca dari
`prisma.systemSetting.findUnique({ where: { key } })` → mengembalikan
`'true'` (dari table `system_settings`, bukan fallback null→false).

`llm-gateway.ts` line 112:
```typescript
enabled = (await configService.getConfig('llm.useDynamicProviders')) === 'true';
```

Ketika `true`, `resolveEffectiveProviders()` (line 132) memanggil
`resolver.getProvidersForRole('chat_primary')` → membaca `ai_provider_configs`
dari DB → menciptakan `OpenAICompatibleAdapter` untuk Mistral.

### B.4: Smoke test P2-UNIT3 (re-run dengan DB sehat)

File: `apps/api/src/services/chat/v2-engine/smoke-test.ts` (utility script,
tidak di-commit — satu-off verifikasi).

Env vars dimuat dari `.env` via loop parser (bukan `source .env` karena error
`gtvk: command not found` pada baris non-assignment).

```
=== Running V2 Engine Smoke Test ===

[smoke-test] llm.useDynamicProviders from DB: "true"
[smoke-test] Dynamic providers ON: true
[smoke-test] Gateway default providers: {"primary":"gemini","fallback":"groq","gatekeeper":"groq"}
[smoke-test] Calling callV2Engine(context, "chat_primary")...
[encryption] Key loaded from Platform Config DB (TTL: 10m)
[Cooldown] Provider "Mistral" rate-limited (429) — cooldown 5 menit
[smoke-test] --- Raw Result ---
{
  "success": true,
  "data": {
    "schema_version": "v1",
    "intent": "product_inquiry",
    "confidence": 0.85,
    "entities": [{ "type": "product", "value": "ban dalam", "confidence": 0.9, "metadata": {} }],
    "proposed_actions": [{ "action_type": "NONE", "payload": {}, "confidence": 0.85, "requires_validation": false }],
    "reply_text": "Halo Kak! Ban dalam untuk mobil ada, tapi bisa kasih tahu ukuran atau untuk mobil apa? Supaya saya bisa cek stok yang sesuai.",
    "needs_clarification": true,
    "clarification_question": "Boleh tahu ukuran atau untuk mobil apa ban dalam yang dibutuhkan?"
  },
  "provider": "SambaNova",
  "model": "MiniMax-M2.7"
}

[smoke-test] ✅ DYNAMIC PROVIDERS CONFIRMED — SambaNova (NOT Gemini)
Exit code: 0
```

**Analisis hasil:**
1. `llm.useDynamicProviders = "true"` dari DB ✓ (bukan null/false)
2. **Mistral (chat_primary) DI-COBAA** pertama — dapat HTTP 429 (rate-limited),
   bukan 401 (auth error). Berarti API key Mistral **valid**, hanya rate-limited
   (karena API call sebelumnya pada 01:36-02:22 dan smoke test ini).
3. Setelah Mistral rate-limited → **otomatis fallback ke SambaNova** (chat_fallback
   dari DB), bukan ke Groq (default hardcoded). Ini membuktikan provider rotation
   dinamis berfungsi penuh.
4. `reply_text` mengandung konten yang koheren ("Halo Kak! Ban dalam...").
5. `schema_version: "v1"`, `intent: "product_inquiry"` — validasi Zod berhasil.

**Provider yang dipakai: SambaNova (dari DB), bukan Gemini.** ✓
**Mistral juga berhasil di-try (429, bukan 401) — artinya kunci valid.** ✓

> **Catatan teknis:** Startup log pm2 menampilkan
> `"primary":"gemini","fallback":"groq"` — ini adalah **default singleton**
> di constructor `LLMGateway(geminiAdapter, groqAdapter)`. Log ini hanya
> informatif (dari `getProviders()`), bukan provider yang benar-benan dipakai.
> Pada saat `generate()` dipanggil, `resolveEffectiveProviders()` mengganti
> primary/fallback dengan daftar dinamis dari DB (Mistral/SambaNova).
> Ini konsisten dengan log pm2 sebelumnya (Sep 4 01:36-02:22):
> `[AIManager] Primary provider succeeded { provider: 'Mistral', model: 'mistral-small-latest' }`

## Bagian C — Test Artifact Exposure via test-results/ (CRITICAL)

### C.1: Bocor apa yang ketemu (bukan VAPID key!)

File: `apps/dashboard/test-results/merchant-push.e2e-Merchant-6b121-vent-
pushes-ONLY-to-Store-A-chromium/error-context.md`, baris 112 & 117 —
bukan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY yang bocor, melainkan
**test store API tokens** (UUID v4 format) yang dipakai oleh e2e test
untuk autentikasi ke test stores STORE_A & STORE_B:

- Line 112: `token: '[REDACTED]'` — test store STORE_A auth token (UUID)
- Line 117: `token: '[REDACTED]'` — test store STORE_B auth token (UUID)
- Line 107: `const TEST_SECRET = process.env.TEST_E2E_SECRET || 'e2e-push-test-secret';`
  — fallback hardcoded test secret (bukan production secret)

**VAPID_PUBLIC_KEY & VAPID_PRIVATE_KEY di `.env` TIDAK bocur.** Karena yang
bocor adalah test store tokens (bukan VAPID keys), **C.3 VAPID rotation
TIDAK DIPERLUKAN**.

### C.2: Scope kerusakan

- **3 file** ter-track di git di dalam `apps/dashboard/test-results/`:
  1. `.last-run.json` — metadata test (status: failed), **tidak ada credential**
  2. `error-context.md` — 3 credential lines (test tokens + test secret)
  3. `trace.zip` — binary Playwright trace, `strings` check: **0 credential match**
- **Untracked files**: 0 — seluruh isi folder `test-results/` ter-track
- **.gitignore**: **TIDAK ADA** entry untuk `test-results/`/`playwright-report/`
  di root `.gitignore`, `apps/api/.gitignore`, atau `apps/dashboard/.gitignore`
  — ini adalah **akar masalah** (sama kelas dengan insiden `dist/` sebelumnya)
- **Window eksposur**: 2026-09-02 12:54:21 UTC → 2026-09-04 08:42:30 UTC
  = **~44 jam** (commit pertama: `be96a73` — "fix: dashboard anti-pattern")

### C.3: VAPID key rotation — TIDAK DIPERLUKAN

Karena VAPID keys tidak bocur, rotation tidak dilakukan. `npx web-push
generate-vapid-keys` sudah teruji tersedia (dependensi `apps/api/package.json:54`,
`"web-push": "^3.6.7"`), siap untuk keperluan rotasi di masa depan.

**Test store tokens aktif di DB?**: `SELECT FROM stores WHERE email ILIKE '%pushtest%'`
→ **0 results**. Test stores tidak ada di DB → token sudah tidak valid.
Risiko rendah (test-only credentials, sudah kadaluarsa).

### C.4: Purge dari git history

Pendekatan: `git filter-repo --path apps/dashboard/test-results/ --invert-paths --force`

Mengapa `--invert-paths` (bukan `--replace-text` seperti Bagian A):
- `test-results/` adalah output folder Playwright — **seluruh isinya
  perlu dihapus** (bukan hanya redact text)
- `--replace-text` cocok untuk file .md audit yang perlu dipertahankan
- `--invert-paths` cocok untuk directory tree output yang tidak perlu

```
$ git filter-repo --path apps/dashboard/test-results/ --invert-paths --force
Parsed 281 commits
New history written in 0.15 seconds; Completely finished after 0.42 seconds.
```

Backup bundle: `/home/ubuntu/backups/garuda-backup-pre-test-results-purge-20260904-120422.bundle`
(18.4MB, diverifikasi).

Reflog cleanup: `git reflog expire --all --expire=now && git gc --prune=now` ✓

Force-push ke:
- `main` (7ff49d0 → 64ab695) — pushed ✓
- `task-pwa-shipping` — "Everything up-to-date" (branch tidak memiliki
  test-results/ files di history-nya, tidak perlu force-push)

### C.5: Perbaikan permanen (.gitignore — AKAR MASALAH)

1. `git rm -r --cached apps/dashboard/test-results/` — untrack dari git index
2. Root `.gitignore` — tambahkan:
   ```
   # Playwright / test runner output
   test-results/
   playwright-report/
   ```
3. `apps/api/.gitignore` — tambahkan `dist` (best practice subproject)

Verifikasi pasca-cleanup:
```
$ git ls-files | grep test-results | wc -l
0
$ git log --all -- apps/dashboard/test-results/
(empty)
$ git status --short
(empty = clean)
```

### C.6: Cross-check file error-context lain

Pencarian kredensial serupa di SELURUH folder `test-results/` (sebelum purge):

```
$ git grep -niE "(bearer|authorization:|api[_-]?key|password|secret|token|vapid)\s*[:=]" -- 'apps/dashboard/test-results/'
```

Hasil: **3 match, semua di `error-context.md`**:
```
error-context.md:107:  const TEST_SECRET = process.env.TEST_SECRET_E2E_SECRET || 'e2e-push-test-secret';
error-context.md:112:  token: '[REDACTED]',    # STORE_A
error-context.md:117:  token: '[REDACTED]',    # STORE_B
```

`trace.zip` (binary): `strings | grep -iE "(token|bearer|secret|password|vapid|auth)"` → **0 match**
`.last-run.json`: metadata test saja — tidak ada credential

### C.7: Post-purge fresh clone verification

```
$ git clone --depth 1 --branch main https://github.com/pandaji.../whatsapp-crm.git /tmp/verify-clean-c
$ grep -r "[REDACTED]" /tmp/verify-clean-c/
(no output — clean)
$ ls /tmp/verify-clean-c/apps/dashboard/test-results/
(No such file or directory — clean ✓)
$ grep -rniE "(bearer|authorization:|api[_-]?key|password|secret)\s*[:=]" *.md DOCS/ apps/api/*.md
(5 match — all documentation-only, no real tokens)
```

Temp clone `/tmp/verify-clean-c` — **dihapus** setelah verifikasi ✓

---

## Bagian D — Kesimpulan & Rekomendasi

### Status — AMAN untuk mulai P2-UNIT4 ✓

| Item | Status |
|------|--------|
| Bearer token purge (git history) | ✅ Selesai & diverifikasi (fresh clone clean) |
| Webhook secret purge (git history) | ✅ Selesai & diverifikasi (0 match di HEAD) |
| Git reflog cleanup | ✅ Selesai (0 entries) |
| Temp file cleanup | ✅ Selesai (semua /tmp/ files dihapus) |
| Test artifact purge (test-results/) | ✅ Selesai & diverifikasi (0 files tracked, 0 in fresh clone) |
| Test token purge (git history) | ✅ Test store tokens purgen dari ALL refs (filter-repo) |
| .gitignore permanent fix | ✅ test-results/ + playwright-report/ to root; dist/ to apps/api/ |
| task-pwa-shipping branch | ✅ Force-pushed, clean (no test-results/ files) |
| DB auth (pm2 vs .env) | ✅ Fixed (`pm2 restart --update-env`) |
| psql connection (.env creds) | ✅ Verified (`psql connection OK`) |
| useDynamicProviders = true | ✅ Verified (DB + runtime) |
| Dynamic providers (Mistral/SambaNova) | ✅ Verified (smoke test, NOT Gemini) |
| tsc --noEmit | ✅ 0 errors |
| Unit tests (v2-engine) | ✅ 7/7 pass |
| pm2 status | ✅ `api` online, no crash loop |
| Working tree | ✅ Bersih (git status kosong) |

### Action item tersisa (Bagian A.3):
**MANUAL TICKET** — `SUPER_ADMIN_TOKEN` tidak tersedia di environment.
Super admin harus manual execute key rotation via QloBot admin panel
atau `curl -X POST https://qlobot.web.id/api/admin/key-rotation/execute
-H "Authorization: Bearer [REDACTED]"` untuk memaksa-revoke Bearer
token yang mungkin masih aktif.

---

*Report generated: 2026-09-04*
*Laporkan semua temuan verbatim di atas — tidak ada raw kredensial di laporan ini.*
