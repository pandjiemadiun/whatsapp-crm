import { ResponseOption, ConversationContext, ResponseResult, PipelineContext } from '../domain/types.js';
export declare class FallbackService {
    getResponse(normalizedMsg: string, ctx: PipelineContext): Promise<ResponseResult>;
    private tryCache;
    private tryFAQ;
    private tryKnowledge;
    private tryCatalog;
    private tryProduct;
    private tryProductNotFound;
    private tryPayment;
    private tryShipping;
    private tryOrderStatus;
    private tryTotal;
    private trySop;
    private validateDescriptionAgainstProducts;
    private getStoreProfile;
    private createResult;
    /**
     * Append item yang dibahas ke discussedItems.
     * Dipanggil setelah tryProduct mengembalikan hasil (single match atau ambiguous).
     * Caps last 10 entries (drop oldest), gunakan atomicCas untuk race-safe.
     *
     * G2-D.6: Canonical (workspace_v2) is PRIMARY authority. Reads existing
     * discussedItems from canonical _compat for dedup. Writes to canonical via
     * writeV1DiscussedItems, then mirrors to extractedEntities for backward compat.
     */
    private saveDiscussedItems;
    /**
     * Deteksi intent koreksi: message mengandng kata "bukan"/"salah"
     * dan menyebut nama produk di confirmedItems. Kembalikan nama produk yang disebut.
     */
    private detectCorrection;
    /**
     * Deteksi negasi terhadap discussedItems: "bukan kangkung", "salah wortel".
     * Hanya return nama produk yang muncul setelah kata negasi dalam jendela 3 kata.
     */
    private detectNegation;
    private capitalize;
    private formatPrice;
    private get ORDER_STATUS_LABELS();
    handleOrderChangeRequest(context: ConversationContext, customerMessage: string, orderStatus: string): Promise<ResponseOption>;
}
export declare const fallbackService: FallbackService;
//# sourceMappingURL=fallback.service.d.ts.map