# VERIFY-PROVIDER-MULTIPLICITY — Laporan Verifikasi (read-only, tanpa perubahan kode)

**Tanggal:** 9 Sep 2026  
**Tujuan:** Konfirmasi definitif apakah `AIProviderConfig` mendukung >1 row aktif dalam SATU role, dan apakah resolver/gateway benar-benar iterasi semuanya.

---

## 1. `getProvidersForRole` — query Prisma-nya `findMany` (bisa >1 row)

**File:** `apps/api/src/services/ai-provider-resolver.service.ts:66-81`

```ts
async getProvidersForRole(role: string): Promise<AIProvider[]> {
  const now = Date.now();
  const cached = this.cache.get(role);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.providers;

  const rows = await this.findMany({
    where: { role, isActive: true },
    orderBy: { priority: 'desc' },
  });

  const providers = rows.map((row) => this.buildProvider(row));
  this.cache.set(role, { providers, ts: now });
  return providers;
}
```

**Konfirmasi:** Query menggunakan `findMany` (bukan `findFirst`/`findUnique`). Return type: `Promise<AIProvider[]>` — **array**. Tidak ada limitasi ke 1 row.

Injected dependency (`this.findMany`) default ke `prisma.aIProviderConfig.findMany` (baris 61-62).

---

## 2. `resolveEffectiveProviders` — return type: array per role

**File:** `apps/api/src/adapters/ai/llm-gateway.ts:152-166`

```ts
private async resolveEffectiveProviders(): Promise<{ primaryList: AIProvider[]; fallbackList: AIProvider[]; fallback2List: AIProvider[] }> {
  if (!(await this.isDynamicProvidersEnabled())) {
    return { primaryList: [this.primary], fallbackList: [this.fallback], fallback2List: this.fallback2 ? [this.fallback2] : [] };
  }

  const primaryList = await this.resolver.getProvidersForRole('chat_primary');
  const fallbackList = await this.resolver.getProvidersForRole('chat_fallback');
  const fallback2List = await this.resolver.getProvidersForRole('chat_fallback_2');

  return {
    primaryList: primaryList.length > 0 ? primaryList : [this.primary],
    fallbackList: fallbackList.length > 0 ? fallbackList : [this.fallback],
    fallback2List: fallback2List.length > 0 ? fallback2List : (this.fallback2 ? [this.fallback2] : []),
  };
}
```

**File:** `apps/api/src/adapters/ai/manager.ts:87-99`

```ts
private async resolveEffectiveProviders(): Promise<{ primaryList: AIProvider[]; fallbackList: AIProvider[] }> {
  if (!(await this.isDynamicProvidersEnabled())) {
    return { primaryList: [this.primaryProvider], fallbackList: [this.fallbackProvider] };
  }

  const primaryList = await this.resolver.getProvidersForRole('chat_primary');
  const fallbackList = await this.resolver.getProvidersForRole('chat_fallback');

  return {
    primaryList: primaryList.length > 0 ? primaryList : [this.primaryProvider],
    fallbackList: fallbackList.length > 0 ? fallbackList : [this.fallbackProvider],
  };
}
```

**Konfirmasi:** Kedua fungsi return **array per role**. Di `llm-gateway.ts:276-283`, array tersebut di-iterate:

```ts
const roleLists: Array<{
  providers: AIProvider[];
  roleKey: 'primary' | 'fallback' | 'fallback_2';
}> = [
  { providers: primaryList, roleKey: 'primary' },
  { providers: fallbackList, roleKey: 'fallback' },
  { providers: fallback2List, roleKey: 'fallback_2' },
];

for (const { providers, roleKey } of roleLists) {
  for (const provider of providers) {
    // ... try each provider
  }
}
```

---

## 3. Semua row saat ini di `ai_provider_configs`

```
b13477fd-a160-4f38-90cb-1ef49e4311d9 | SambaNova | role=chat_fallback | priority=0 | active=true | format=openai_compatible
251d6f17-84cd-4f2c-8ce6-df24ad093510 | Internal LLM | role=chat_fallback_2 | priority=1 | active=true | format=openai_compatible
c8c2ae57-fa81-495c-8e38-1a755ec2001e | Mistral | role=chat_primary | priority=0 | active=true | format=openai_compatible

Total rows: 3
Rows per role: {"chat_fallback":1,"chat_fallback_2":1,"chat_primary":1}
```

Saat ini cuma 1 row per role, tapi itu karena belum ditambahkan, bukan karena schema melarang.

---

## 4. Schema constraint — TIDAK ada unique index per role

```
ai_provider_configs_pkey → CREATE UNIQUE INDEX ... (id)
ai_provider_configs_role_isActive_priority_idx → CREATE INDEX ... (role, "isActive", priority)
```

Hanya `@@index([role, isActive, priority])` — bukan `@@unique`.

**`prisma/schema.prisma` model `AIProviderConfig`:**
```
@@index([role, isActive, priority])
@@map("ai_provider_configs")
```

Tidak ada `@@unique([role])` atau `@@unique([role, isActive])`. **TIDAK ADA constraint yang melarang >1 row per role.**

---

## 5. Test INSERT dummy + verifikasi array berisi 2 row

```
=== BEFORE TEST: getProvidersForRole("chat_primary") ===
Count: 1
  - Mistral (mistral-small-latest)

=== TEST: INSERT dummy second chat_primary row ===
Created dummy row: 31451e94-7967-433d-b488-e8c7cbdfc81a

=== AFTER TEST: getProvidersForRole("chat_primary") ===
Count: 2
  - TEST-DUPLICATE-PRIMARY (test-model)
  - Mistral (mistral-small-latest)

=== CLEANUP: delete dummy row ===
Deleted: TEST-DUPLICATE-PRIMARY

=== AFTER CLEANUP: getProvidersForRole("chat_primary") ===
Count: 1
  - Mistral (mistral-small-latest)

Final total rows: 3 (should match before: 3)
```

**Konfirmasi:** setelah INSERT dummy row kedua di `role='chat_primary'`, `getProvidersForRole` return array berisi 2 row. Setelah DELETE, kembali ke 1 row. Tidak ada constraint yang melarang >1 row per role; sistem memang didesain untuk iterate semua row aktif dalam satu role.

---

## Kesimpulan

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Query Prisma menggunakan `findMany`? | **YA** | `ai-provider-resolver.service.ts:71` |
| Return type array per role? | **YA** | `Promise<AIProvider[]>` di `getProvidersForRole` |
| Gateway iterate semua provider dalam array? | **YA** | `llm-gateway.ts:276-283` + `manager.ts:162-170` |
| Ada constraint DB yang melarang >1 row per role? | **TIDAK** | Hanya `@@index`, bukan `@@unique` |
| Test INSERT 2 row per role berhasil? | **YA** | `getProvidersForRole('chat_primary')` return 2 row setelah INSERT, kembali ke 1 setelah DELETE |

**Sistem memang mendukung multiplicity >1 row per role. Saat ini hanya 1 row per role karena belum ditambahkan, bukan karena dibatasi schema.**
