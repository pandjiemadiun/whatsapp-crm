# WIZARD-AUDIT-FIX.md

**Date:** 9 Sep 2026  
**Scope:** Schema verbatim query, FAQ source trace, cooldown risk with real roles  
**Status:** Read-only audit, no code changes  

---

## 1. Verbatim SQL: information_schema.columns untuk 'faqs' dan 'knowledge_base'

```sql
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('faqs','knowledge_base') 
ORDER BY table_name, ordinal_position;
```

**Hasil aktual (27 rows):**

| table_name   | column_name      | data_type                  |
|--------------|------------------|----------------------------|
| faqs         | id               | text                       |
| faqs         | storeId          | text                       |
| faqs         | question         | text                       |
| faqs         | answer           | text                       |
| faqs         | keywords         | ARRAY                      |
| faqs         | category         | text                       |
| faqs         | priority         | integer                    |
| faqs         | embedding        | text                       |
| faqs         | matchCount       | integer                    |
| faqs         | isActive         | boolean                    |
| faqs         | createdAt        | timestamp without time zone|
| faqs         | updatedAt        | timestamp without time zone|
| faqs         | deletedAt        | timestamp without time zone|
| faqs         | source           | text                       |
| knowledge_base| id              | text                       |
| knowledge_base| storeId         | text                       |
| knowledge_base| title           | text                       |
| knowledge_base| content         | text                       |
| knowledge_base| category        | text                       |
| knowledge_base| tags            | ARRAY                      |
| knowledge_base| source          | text                       |
| knowledge_base| embedding       | text                       |
| knowledge_base| relevanceScore  | double precision           |
| knowledge_base| isActive        | boolean                    |
| knowledge_base| createdAt       | timestamp without time zone|
| knowledge_base| updatedAt       | timestamp without time zone|
| knowledge_base| deletedAt       | timestamp without time zone|

**Koreksi dari laporan sebelumnya (`WIZARD-P0-AUDIT-RESULT.md`):**
- `knowledge_base` memiliki `title` + `content` (BUKAN `question` + `answer`)
- `faqs` memiliki kolom tambahan: `keywords` (ARRAY), `priority` (integer), `matchCount` (integer)
- `knowledge_base` memiliki kolom tambahan: `tags` (ARRAY), `relevanceScore` (double precision)
- Kedua tabel sama-sama menyimpan `embedding` sebagai `text` (bukan vector type)
- `source` nullable text pada kedua tabel — KONFIRMASI

---

## 2. Asal 10 Baris FAQ store-a3cd7205 Kategori 'ai_suggestion'

**File:line yang menulis ke tabel `faqs` dengan `category='ai_suggestion'`:**

`apps/api/src/services/learning.service.ts:107`
```ts
category: 'ai_suggestion',
```

**Context penuh (`learning.service.ts:99-113`):**
```ts
await prisma.$transaction(
  drafts.map((draft) =>
    prisma.fAQ.create({
      data: {
        storeId: storeId,
        question: draft.question,
        answer: draft.answer,
        isActive: false,
        category: 'ai_suggestion',  // ← Line 107
        priority: 1,
        keywords: [],
      },
    })
  )
);
```

**Fungsi:** `analyzeAndGenerateFaqDrafts(storeId)` — Learning Service yang:
1. Scan `conversation_history` untuk assistant messages dengan `source='ai'` dalam 24h terakhir
2. Ambil pertanyaan customer (role='user') yang precede jawaban AI
3. Kirim ke Groq untuk clustering & drafting (minimal 5 pertanyaan)
4. Simpan draft FAQ dengan `isActive=false, category='ai_suggestion'` — owner harus approve manual

**Kesimpulan:** 10 baris FAQ di `store-a3cd7205` dengan kategori `ai_suggestion` berasal dari **Learning Service auto-generation**, bukan dari seed script atau wizard. Data ini adalah draft FAQ yang menunggu approval owner.

---

## 3. Risk Analysis Cooldown dengan Role ASLI (chat_primary/chat_fallback/chat_fallback_2)

### 3.1 Cooldown Scope: GLOBAL PER-PROVIDER (Tidak Ada Role/Store Dimension)

**File: `apps/api/src/services/provider-cooldown.ts:18-31`**
```ts
const store: Map<string, CooldownEntry> = new Map();

export function cooldown(provider: string, durationMs: number = DEFAULT_COOLDOWN_MS): void {
  const until = Date.now() + durationMs;
  store.set(provider, { until, warned: false });  // Key = provider name ONLY
}

export function isCooldown(provider: string): boolean {
  const entry = store.get(provider);  // Lookup by provider name ONLY
  ...
}
```

**Key:** `provider: string` — hanya nama provider, TANPA dimensi role atau storeId.

### 3.2 Role ASLI di Codebase

| Role | Dipakai di | Fungsi |
|------|-----------|--------|
| `chat_primary` | `llm-gateway.ts:157`, `manager.ts:92` | Primary speaker (main conversation) |
| `chat_fallback` | `llm-gateway.ts:158`, `manager.ts:93` | Fallback jika primary gagal |
| `chat_fallback_2` | `llm-gateway.ts:159` | Fallback kedua (hanya di llm-gateway.ts) |
| `chat_gatekeeper` | `health.service.ts:166` | Intent extraction (cosmetic, tidak di-swap) |
| `batch_task` | `learning.service.ts:147` | Learning service / FAQ drafting |
| `wizard` | `health.service.ts:166`, `admin/ai-providers.ts:81` | Role enum exist tapi **TIDAK ADA production caller** |

### 3.3 Skenario Konkret: Mistral(chat_primary) 429 → Cross-Store Contamination

**Konfirmasi dari kode:**

**Langkah 1 — Store A wizard burst call ke Mistral via chat_primary:**

`llm-gateway.ts:157,265,288,330`
```ts
const primaryList = await this.resolver.getProvidersForRole('chat_primary');
// ...
for (const provider of providers) {
  const name = provider.getName();  // e.g., 'Mistral'
  if (shouldSkipProvider(name)) continue;
  // ...
  if (error.category === ErrorCategory.RATE_LIMIT || error.statusCode === 429) {
    triggerCooldown(error.provider || name, ...);  // → cooldown('Mistral')
  }
}
```

**Langkah 2 — Store B customer chat via chat_primary/Mistral:**

Store B menggunakan instance yang sama dari `llmGateway` (singleton). Ketika Store B request masuk:
```ts
const name = provider.getName();  // 'Mistral'
if (shouldSkipProvider(name)) {    // → TRUE (cooldown aktif dari Store A)
  continue;                        // Skip Mistral!
}
```

**Kesimpulan: SKENARIO DIKONFIRMASI DARI KODE AKTUAL.**

Dalam **single-process deployment** (termasuk dev/test, atau pm2 single instance):
- `provider-cooldown.ts` menggunakan `Map<string, CooldownEntry>` di module level
- Map ini DI-SHARE oleh SEMUA request di SEMUA store dalam proses yang sama
- Jika Store A trigger 429 pada Mistral → `cooldown('Mistral')` fire
- Store B yang request ke Mistral di proses yang sama → `shouldSkipProvider('Mistral')` return TRUE → **skip 5 menit**

**Dalam multi-process deployment (pm2 cluster):**
- Setiap process punya Map terisolasi
- Store A di process 1 → cooldown hanya di process 1
- Store B di process 2 → tidak terdampak (kecuali sticky session mengarahkan ke process yang sama)

### 3.4 Wizard Generation — Konfirmasi/Bantahan

**Tidak ada kode wizard generation yang ditemukan di codebase.**

- Role `wizard` ada di schema enum (`admin/ai-providers.ts:81`) dan health check (`health.service.ts:166`)
- TIDAK ADA production caller yang memanggil `getProvidersForRole('wizard')`
- `v2-engine-generalization.ts:146` menggunakan `chat_primary`, BUKAN `wizard`
- Learning service (`learning.service.ts:147`) menggunakan `batch_task`, BUKAN `wizard`

**Kesimpulan:** Skenario "toko A onboarding wizard trigger burst call ke Mistral(chat_primary)" **TIDAK BISA DIKONFIRMASI** karena tidak ada kode wizard generation yang ditemukan. Namun, prinsip kerusakan tetap sama: **SIApa pun yang memanggil `chat_primary` dengan provider yang sama di proses yang sama akan mengalami cooldown contamination.**

### 3.5 Role Cascade Matrix (Real Roles)

| Role | Provider Contoh | Jika 429 → Cooldown Key | Dampak ke Role Lain di Proses Yang Sama |
|------|----------------|------------------------|----------------------------------------|
| `chat_primary` | Mistral | `'Mistral'` | `chat_fallback` yang juga pakai Mistral → skip |
| `chat_fallback` | Groq | `'Groq'` | `chat_primary` yang juga pakai Groq → skip |
| `chat_fallback_2` | InternalLLM | `'InternalLLM'` | `chat_primary`/`chat_fallback` yang juga pakai InternalLLM → skip |
| `batch_task` | Groq | `'Groq'` | `chat_primary`/`chat_fallback` yang juga pakai Groq → skip |

**Contoh nyata:**
- Store A: `chat_primary` = Mistral, `chat_fallback` = Groq
- Store B: `chat_primary` = Mistral, `chat_fallback` = Groq
- Store A dapat 429 dari Mistral → `cooldown('Mistral')`
- Store B mencoba chat via `chat_primary` → Mistral di-skip, fallback ke Groq
- Jika Groq juga di-429 oleh Store A → `cooldown('Groq')`
- Store B: Mistral skip + Groq skip → **AllProvidersCooldownError**

### 3.6 File:line Konfirmasi Cooldown Global

| Bukti | File:Line |
|-------|-----------|
| Cooldown map declaration (global, module-level) | `provider-cooldown.ts:18` |
| `cooldown()` key = provider name only | `provider-cooldown.ts:20-23` |
| `isCooldown()` lookup by provider name only | `provider-cooldown.ts:25-31` |
| `triggerCooldown()` called on 429 with provider name | `llm-gateway.ts:330-333` |
| `shouldSkipProvider()` called before each attempt | `llm-gateway.ts:288` |
| Same pattern in manager.ts | `manager.ts:174,210` |
| `AllProvidersCooldownError` thrown when all skipped | `llm-gateway.ts:367-379` |

---

## 4. Ringkasan Temuan

| # | Temuan | Bukti File:Line | Severity |
|---|--------|-----------------|----------|
| 1 | Schema FAQ: `keywords` ARRAY, `priority` integer, `matchCount` integer | SQL verbatim | Info |
| 2 | Schema KB: `title`+`content` (bukan `question`+`answer`), `tags` ARRAY, `relevanceScore` double | SQL verbatim | Info |
| 3 | 10 FAQ `ai_suggestion` berasal dari Learning Service | `learning.service.ts:107` | Confirmed |
| 4 | Cooldown GLOBAL per provider name — tidak ada role/store dimension | `provider-cooldown.ts:18-31` | **P0** |
| 5 | Skenario Mistral 429 cross-store contamination DIKONFIRMASI untuk single-process | `llm-gateway.ts:288,330` | **P0** |
| 6 | Wizard generation code TIDAK DITEMUKAN — role `wizard` ada di schema tapi tidak dipanggil | grep seluruh codebase | Info |
| 7 | Multi-process (pm2 cluster) memitigasi risiko menjadi per-process, bukan per-deployment | Arsitektur Node.js | Medium |

**Rekomendasi:** Perubahan `provider-cooldown.ts` untuk include role (atau store+role) dalam cooldown key adalah P0 blocker sebelum production deployment dengan multi-tenant architecture.
