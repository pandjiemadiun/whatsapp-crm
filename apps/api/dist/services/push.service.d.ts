export interface PushSubscriptionDTO {
    endpoint: string;
    keys: {
        auth: string;
        p256dh: string;
    };
}
export interface PushMessage {
    title: string;
    body: string;
    url: string;
    tag?: string;
    timestamp?: string;
}
export declare function ensureVapidConfigured(): boolean;
export declare function sendPush(subscription: PushSubscriptionDTO, message: PushMessage): Promise<{
    ok: boolean;
    expired: boolean;
}>;
//# sourceMappingURL=push.service.d.ts.map