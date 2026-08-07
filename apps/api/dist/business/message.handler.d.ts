import { ResponseSource } from '../domain/types.js';
export declare class MessageHandler {
    handle(message: string, storeId: string, customerId: string): Promise<{
        source: ResponseSource;
        response: string;
        costUSD: number;
        metadata: {
            tokens: {
                input: number;
                output: number;
            };
            error?: undefined;
        };
    } | {
        source: ResponseSource;
        response: string;
        costUSD: number;
        metadata: {
            error: boolean;
            tokens?: undefined;
        };
    }>;
}
export declare const messageHandler: MessageHandler;
//# sourceMappingURL=message.handler.d.ts.map