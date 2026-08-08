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
export interface CatalogItem {
    id: string;
    name: string;
    price: number;
    category: string | null;
}
export type SetOp = {
    type: 'ALL';
} | {
    type: 'NAMES';
    names: string[];
} | {
    type: 'INDICES';
    indices: number[];
} | {
    type: 'FILTER_CATEGORY';
    cat: string;
} | {
    type: 'FILTER_PRICE_RANK';
    rank: 'cheap' | 'expensive';
} | {
    type: 'MINUS';
    names: string[];
} | {
    type: 'LAST_REPEAT';
};
export interface SetOpResult {
    matched: CatalogItem[];
    unmatched: string[];
}
/**
 * Terapkan satu SetOp atas katalog + state presentasi.
 *
 * @param op              operasi seleksi
 * @param catalog         katalog produk toko (sumber kebenaran)
 * @param optionsPresented  opsi yang pernah/ditunjukkan (nama, urut) — dipakai INDICES
 * @param lastSelection   nama yang dipilih customer turn lalu — dipakai LAST_REPEAT
 * @returns matched (CatalogItem[]) + unmatched (nama tidak ditemukan)
 */
export declare function applySetOp(op: SetOp, catalog: CatalogItem[], optionsPresented: string[], lastSelection: string[]): SetOpResult;
//# sourceMappingURL=setops.d.ts.map