/**
 * Set Operations Executor — BAGIAN 3 (v3.2)
 * src/services/chat/setops.ts
 *
 * Seleksi produk rule-based (0-LLM) atas katalog + riwayat presentasi.
 * Mengembalikan { matched, unmatched } di mana setiap referensi yang
 * "tak ada di catalog" wajib masuk ke `unmatched` (JANGAN silent drop).
 *
 * I8: executor ini 0-LLM — tidak ada panggilan model.
 * I15: hasil yang matched belum diverifikasi stok/harga ke DB; verifikasi
 *      dilakukan di stage terpisah.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Catalog item (proyeksi ringkas dari Product; cukup untuk seleksi v2)
// ─────────────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  category: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SetOp discriminated union
// ─────────────────────────────────────────────────────────────────────────────

export type SetOp =
  | { type: 'ALL' }
  | { type: 'NAMES'; names: string[] }
  | { type: 'INDICES'; indices: number[] }
  | { type: 'FILTER_CATEGORY'; cat: string }
  | { type: 'FILTER_PRICE_RANK'; rank: 'cheap' | 'expensive' }
  | { type: 'MINUS'; names: string[] }
  | { type: 'LAST_REPEAT' };

export interface SetOpResult {
  matched: CatalogItem[];
  unmatched: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lookup satu item di katalog by nama (case-insensitive).
 * I5: referensi pakai act_id/name, bukan index — di sini pakai nama stabil.
 */
function findInCatalog(
  catalog: CatalogItem[],
  name: string
): CatalogItem | undefined {
  return catalog.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}

function matchesName(catalog: CatalogItem[], name: string): boolean {
  return findInCatalog(catalog, name) !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// applySetOp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Terapkan satu SetOp atas katalog + state presentasi.
 *
 * @param op              operasi seleksi
 * @param catalog         katalog produk toko (sumber kebenaran)
 * @param optionsPresented  opsi yang pernah/ditunjukkan (nama, urut) — dipakai INDICES
 * @param lastSelection   nama yang dipilih customer turn lalu — dipakai LAST_REPEAT
 * @returns matched (CatalogItem[]) + unmatched (nama tidak ditemukan)
 */
export function applySetOp(
  op: SetOp,
  catalog: CatalogItem[],
  optionsPresented: string[],
  lastSelection: string[]
): SetOpResult {
  switch (op.type) {
    case 'ALL': {
      return { matched: [...catalog], unmatched: [] };
    }

    case 'NAMES': {
      const matched: CatalogItem[] = [];
      const unmatched: string[] = [];
      for (const name of op.names) {
        const found = findInCatalog(catalog, name);
        if (found) matched.push(found);
        else unmatched.push(name); // JANGAN silent drop
      }
      return { matched, unmatched };
    }

    case 'INDICES': {
      const matched: CatalogItem[] = [];
      const unmatched: string[] = [];
      for (const idx of op.indices) {
        if (idx < 0 || idx >= optionsPresented.length) continue;
        const name = optionsPresented[idx];
        const found = findInCatalog(catalog, name);
        if (found) matched.push(found);
        else unmatched.push(name);
      }
      return { matched, unmatched };
    }

    case 'FILTER_CATEGORY': {
      const cat = op.cat.toLowerCase();
      return {
        matched: catalog.filter((c) => (c.category ?? '').toLowerCase() === cat),
        unmatched: [],
      };
    }

    case 'FILTER_PRICE_RANK': {
      // Median split: 'cheap' = setengah paling murah, 'expensive' = setengah paling mahal.
      const sorted = [...catalog].sort((a, b) => a.price - b.price);
      const mid = Math.floor(sorted.length / 2);
      const matched =
        op.rank === 'cheap' ? sorted.slice(0, mid) : sorted.slice(mid);
      return { matched, unmatched: [] };
    }

    case 'MINUS': {
      const matched = catalog.filter(
        (c) => !op.names.some((n) => n.toLowerCase() === c.name.toLowerCase())
      );
      // Nama yang diminta dikecualikan tapi tidak ada di katalog -> laporkan.
      const unmatched = op.names.filter((n) => !matchesName(catalog, n));
      return { matched, unmatched };
    }

    case 'LAST_REPEAT': {
      const matched: CatalogItem[] = [];
      const unmatched: string[] = [];
      for (const name of lastSelection) {
        const found = findInCatalog(catalog, name);
        if (found) matched.push(found);
        else unmatched.push(name);
      }
      return { matched, unmatched };
    }
  }
}
