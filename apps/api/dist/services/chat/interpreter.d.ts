import type { InterpreterResult } from '../../domain/types.js';
/**
 * callSingleInterpreter — BAGIAN 3.
 *
 * @param normalizedText  pesan yang sudah dinormalisasi
 * @param context          conversation context (storeId, customerId, conversationId, messages)
 * @param dbSnapshot       { cart, activeOrder, customerCity, products }
 */
export declare function callSingleInterpreter(normalizedText: string, context: {
    storeId: string;
    customerId: string;
    conversationId: string;
    messages: any[];
}, dbSnapshot: {
    cart: Array<{
        product: string;
        qty?: number;
        price?: number;
    }>;
    activeOrder: {
        orderStatus: string;
        items: any[];
    } | null;
    customerCity: string | null;
    products: Array<{
        name: string;
        price: number;
        stock: number | null;
    }>;
}): Promise<InterpreterResult | null>;
/**
 * Validasi cart_ops terhadap DB — hanya jalankan jika produk ada + qty valid.
 * Harga SELALU dari DB, bukan dari LLM.
 * I15: cart_ops dari LLM wajib divalidasi terhadap DB
 */
export declare function validateCartOpsAgainstDb(cartOps: any[], storeId: string): Promise<{
    valid: any[];
    invalid: any[];
}>;
//# sourceMappingURL=interpreter.d.ts.map