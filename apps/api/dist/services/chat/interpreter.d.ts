import type { InterpreterResult, CartOp, PipelineContext } from '../../domain/types.js';
/**
 * runOneCall — BAGIAN 3 (SATU LLM CALL).
 *
 * Absorbs: intent classification, buy_signal, cart ops, missing info,
 * identity extraction, clarification generation — ALL in ONE Groq call.
 *
 * @param normalizedText  pesan yang sudah dinormalisasi (Stage 2 output)
 * @param ctx             PipelineContext (storeId, cart, activeOrder, products, city, messages)
 * @returns InterpreterResult | null
 */
export declare function runOneCall(normalizedText: string, ctx: PipelineContext): Promise<InterpreterResult | null>;
/**
 * Validasi cart_ops terhadap DB — hanya jalankan jika produk ada + qty valid.
 * Harga SELALU dari DB, bukan dari LLM.
 * I15: cart_ops dari LLM wajib divalidasi terhadap DB
 */
export declare function validateCartOpsAgainstDb(cartOps: CartOp[], storeId: string): Promise<{
    valid: CartOp[];
    invalid: CartOp[];
}>;
/**
 * validateCartOps — validasi cart_ops terhadap katalog produk di memori (storeProducts).
 *
 * Untuk setiap op, cek `product` (sku / product_ref) ada di storeProducts.
 * Op tak ditemukan -> dimasukkan ke `missing` (caller gabung ke missing_info
 * pada InterpreterResult). Hanya mengembalikan op yang valid saja.
 *
 * Pure & sync — tidak sentuh DB/LLM. Pipeline (FASE 4) panggil setelah runOneCall.
 */
export interface ValidateCartOpsResult {
    valid: CartOp[];
    /** product refs (nama) tak ditemukan di katalog — gabung ke missing_info */
    missing: string[];
}
export declare function validateCartOps(cartOps: CartOp[], storeProducts: PipelineContext['storeProducts']): ValidateCartOpsResult;
/**
 * truncateTo2Sentences — memotong teks ke (paling banyak) 2 kalimat pertama.
 * Kalimat dipisahkan oleh [.!?] diikuti pemisah spasi (look-behind boundary).
 *
 * Pure & sync. Pipeline (FASE 4) pakai sebagai safety-net agar reply_draft
 * tak melebihi 2 kalimat, sekaligus memenuhi aturan system prompt.
 */
export declare function truncateTo2Sentences(text: string): string;
//# sourceMappingURL=interpreter.d.ts.map