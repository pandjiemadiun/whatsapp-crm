/**
 * PromptBuilderService — generates context-rich system prompts for AI assistants.
 */
export declare class PromptBuilderService {
    /**
     * Generate an initial system prompt for a store based on its profile data.
     */
    generateInitialPrompt(storeId: string): Promise<string>;
    /**
     * Save the generated system prompt to store_settings if not already set manually.
     */
    saveInitialPromptIfMissing(storeId: string): Promise<void>;
    private formatOperatingHours;
}
export declare const promptBuilderService: PromptBuilderService;
//# sourceMappingURL=prompt-builder.service.d.ts.map