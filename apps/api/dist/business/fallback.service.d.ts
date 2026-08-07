import { ResponseOption, ConversationContext, ResponseResult } from '../domain/types.js';
export declare class FallbackService {
    getResponse(context: ConversationContext, customerMessage: string, askIdentity?: boolean, customerCity?: string | null): Promise<ResponseResult>;
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
    private tryAI;
    private validateDescriptionAgainstProducts;
    private getStoreProfile;
    private createResult;
    /**
     * Append item yang dibahas ke extractedEntities.discussedItems.
     * Dipanggil setelah tryProduct mengembalikan hasil (single match atau ambiguous).
     * Caps last 10 entries (drop oldest), gunakan upsert untuk race-safe.
     */
    private saveDiscussedItems;
    private static readonly BUY_KEYWORDS;
    /**
     * Deteksi sinyal pembelian.
     * Keyword heuristic dulu — hanya call LLM jika tidak match keyword sama sekali.
     */
    detectBuySignal(message: string): Promise<boolean>;
    /**
     * Cek apakah ada pending ambiguous prompt di extractedEntities.
     * Jika ada, caller harus selalu coba resolveBuySignal meski detectBuySignal false.
     */
    hasPendingAmbiguity(conversationId: string): Promise<boolean>;
    /**
     * Resolve a buy signal against the conversation's extractedEntities.
     * Handles 4 cases (A: single→confirm, B: ambiguous→ask back, C: correction,
     * and the "resolve against lastAmbiguousPrompt" sub-branch).
     * Returns ResponseResult if resolved, null if caller should fall through to normal chain.
     */
    resolveBuySignal(context: ConversationContext, message: string): Promise<ResponseResult | null>;
    private parseEntities;
    private upsertExtractedEntities;
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