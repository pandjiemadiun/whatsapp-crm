export interface AiDefaults {
    primaryModel: string;
    fallbackModel: string;
    temperature: number;
    topP: number;
    maxTokensGemini: number;
    maxTokensGroq: number;
    buySignalTemperature: number;
    styleGuide: string;
}
export declare function getAiDefaults(): Promise<AiDefaults>;
export declare function invalidateAiDefaultsCache(): void;
//# sourceMappingURL=ai-config.d.ts.map