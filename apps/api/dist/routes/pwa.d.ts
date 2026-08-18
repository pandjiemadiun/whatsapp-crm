declare const router: import("express-serve-static-core").Router;
interface WebSession {
    storeId: string;
    customerId: string;
    conversationId: string;
}
/** Resolve-or-create Web session (mirror /message). Dipakai /handoff supaya
 *  "Hubungi Admin" bisa dipanggil meski customer/conversation belum ada. */
export declare function getOrCreateWebSession(storeId: string, uid: string, convId?: string): Promise<WebSession>;
export default router;
//# sourceMappingURL=pwa.d.ts.map