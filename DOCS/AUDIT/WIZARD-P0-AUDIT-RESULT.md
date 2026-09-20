# WIZARD-P0-AUDIT-RESULT.md

**Audit:** P0 Wizard Audit — Schema, Emptiness, AI Provider Role Sharing  
**Scope:** FAQ/knowledge schema verification, data emptiness check, AI provider multiplicity/cooldown risk  
**Date:** 9 Sep 2026  
**Status:** Read-only audit, no migrations, no code changes  

---

## 1. Schema Verification

### 1.1 FAQ Table

**Table:** `faqs` (Prisma model `FAQ`)  
**Location:** `apps/api/prisma/schema.prisma`

**Columns verified:**
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | String @id | No | Primary key |
| `storeId` | String | No | FK to store |
| `question` | String | No | FAQ question text |
| `answer` | String | No | FAQ answer text |
| `category` | String | No | FAQ category (e.g., `ai_suggestion`) |
| `source` | String | **YES** | Nullable — stores source document reference |
| `embedding` | String | No | Text/JSON embedding vector |
| `createdAt` | DateTime | No | Timestamp |
| `updatedAt` | DateTime | No | Timestamp |

**Key finding:** `source` column is **nullable text**. This is important for wizard audit because it means FAQ rows can exist without a source document reference. The column is NOT a foreign key — it's free-form text.

### 1.2 Knowledge Table

**Table:** `knowledge_base` (Prisma model `Knowledge`)  
**Location:** `apps/api/prisma/schema.prisma`

**Columns verified:**
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | String @id | No | Primary key |
| `storeId` | String | No | FK to store |
| `question` | String | No | Knowledge question text |
| `answer` | String | No | Knowledge answer text |
| `source` | String | **YES** | Nullable — stores source document reference |
| `embedding` | String | No | Text/JSON embedding vector |
| `createdAt` | DateTime | No | Timestamp |
| `updatedAt` | DateTime | No | Timestamp |

**Key finding:** Same as FAQ — `source` is nullable text, not a FK.

### 1.3 Embedding Storage Format

**Critical finding:** Both `faqs.embedding` and `knowledge_base.embedding` are stored as **TEXT/JSON**, NOT as native vector types.

**Evidence:**
- `faq.service.ts:tryFAQ()` — uses plain keyword matching and string similarity (`levenshtein`, `includes`), NOT vector similarity search
- No `pgvector` extension or `Vector` type in schema
- `embedding` column type = `String` in Prisma → maps to `TEXT` in PostgreSQL

**Implication for wizard:** If wizard plans to add embedding-based search, it will need to:
1. Either migrate to `pgvector` extension (schema change + migration)
2. Or keep current plain-text approach and not use embeddings for search

---

## 2. Data Emptiness Check

### 2.1 FAQ Data

| Store ID | FAQ Count | Categories | Source Null? |
|----------|-----------|------------|--------------|
| `store-a3cd7205` | **10** | `ai_suggestion` (all rows) | Yes — all `source=null` |
| All other stores | **0** | — | — |

**Total FAQ rows in DB:** 10 (all in test store)

### 2.2 Knowledge Data

| Store ID | Knowledge Count | Source Null? |
|----------|-----------------|--------------|
| ALL stores | **0** | — |

**Total Knowledge rows in DB:** 0

**Audit conclusion:** Knowledge table is completely empty. FAQ has only test data in dummy store. Any wizard schema work on knowledge_base would be working on a table with zero production data.

---

## 3. AI Provider Multiplicity & Cooldown Risk Analysis

### 3.1 Provider Multiplicity

**Verified in:** `VERIFY-PROVIDER-MULTIPLICITY.md` (committed as `b6f664b`)

**Finding:** `getProvidersForRole(role)` uses `findMany` — returns **multiple providers per role**. No `@@unique` constraint on role in `AIProvider` schema.

**Live test confirmed:** 2 providers returned for same role after INSERT.

**Implication:** A single role (e.g., `suggestion`) can have multiple AI providers configured (e.g., `gemini`, `openai`).

### 3.2 Cooldown Scope: Global Per-Provider (NOT Per-Role)

**Source:** `apps/api/src/services/provider-cooldown.ts`

**Critical finding:** Cooldown is **global per provider name**, NOT scoped per role.

**Evidence:**
```ts
const store: Map<string, CooldownEntry> = new Map();

export function cooldown(provider: string, durationMs: number): void {
  const until = Date.now() + durationMs;
  store.set(provider, { until, warned: false });
}

export function isCooldown(provider: string): boolean {
  const entry = store.get(provider);
  // ...
}
```

**Key:** `provider: string` — only provider name, no role dimension.

### 3.3 Risk Matrix: Role Sharing with Global Cooldown

| Scenario | Risk Level | Description |
|----------|------------|-------------|
| Provider used in 1 role | **LOW** | Cooldown only affects that role's requests |
| Provider used in 2+ roles | **HIGH** | Rate-limit (429) on one role blocks ALL roles using same provider |
| Provider shared across `suggestion` + `chat` + `order` | **CRITICAL** | Single 429 → all 3 roles frozen for 5 minutes |

**Concrete example:**
- Store configures `openai` for roles: `suggestion`, `chat`, `order`
- `suggestion` gets rate-limited (429) → `cooldown('openai')` fires
- `chat` and `order` roles now ALSO skip `openai` for 5 minutes
- Customer experience: bot stops responding across all intents

### 3.4 Current Mitigation Status

**Current code has NO mitigation** for cross-role cooldown contamination:

- `shouldSkipProvider(provider)` — checks global cooldown, returns true if ANY role triggered it
- No per-role cooldown tracking
- No isolation between role/provider pairs

**Recommendation BEFORE any schema work:**
1. Decide: should cooldown be per-role or keep global?
2. If per-role: change `cooldown()` key from `provider` to `${provider}:${role}`
3. If global: document the coupling risk and add monitoring alerts
4. Update `getProvidersForRole` callers to pass role context to cooldown functions

---

## 4. Wizard Readiness Assessment

### 4.1 Ready for Schema Work

| Component | Status | Blocker? |
|-----------|--------|----------|
| FAQ schema | ✅ Verified | No |
| Knowledge schema | ✅ Verified | No |
| Data emptiness | ✅ Confirmed (10 FAQ, 0 KB) | No |
| Embedding strategy | ⚠️ Needs decision | **Yes** — text vs pgvector |
| AI provider cooldown scope | ⚠️ Needs decision | **Yes** — global vs per-role |
| Role multiplicity | ✅ Confirmed (multi-provider per role) | No |

### 4.2 Blocking Decisions Before Schema Migration

1. **Embedding format decision:**
   - Option A: Keep `TEXT` storage, use plain-text similarity (current)
   - Option B: Migrate to `pgvector`, use cosine similarity
   - **Impact:** Option B requires PostgreSQL extension + type migration + query rewrite

2. **Cooldown scope decision:**
   - Option A: Keep global (current) — risk of cross-role blocking
   - Option B: Per-role cooldown — requires key format change in `provider-cooldown.ts`
   - **Impact:** Option B is safer for multi-role stores

---

## 5. Audit Summary

| Audit Item | Finding | Severity |
|------------|---------|----------|
| FAQ schema has `source` (nullable text) | ✅ Expected | — |
| Knowledge schema has `source` (nullable text) | ✅ Expected | — |
| Embeddings stored as TEXT, not vector | ⚠️ Design limitation | Medium |
| FAQ data: 10 rows in test store only | ✅ Confirmed | — |
| Knowledge data: 0 rows total | ✅ Confirmed | — |
| Multi-provider per role confirmed | ⚠️ Risk factor | High |
| Cooldown is global per-provider | ❌ Cross-role contamination risk | **P0** |
| No per-role cooldown isolation | ❌ Missing mitigation | **P0** |

**Bottom line:** Wizard can proceed with FAQ/knowledge schema work, but **must resolve cooldown scope decision first** (global vs per-role) before production deployment. The current global cooldown creates a hidden coupling between AI roles that can cause cascading failures.
