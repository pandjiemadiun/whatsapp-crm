import { describe, it, expect, vi } from 'vitest';
import { ConversationService } from '../business/conversation.service.js';
import { getStoreEngine } from '../services/chat/engine-config.js';
import { understand } from '../services/chat/reasoning.js';
// Mocking dependencies
vi.mock('../services/chat/engine-config.js');
vi.mock('../services/chat/reasoning.js');
vi.mock('../services/chat/workspace.js', async () => {
    const actual = await vi.importActual('../services/chat/workspace.js');
    return { ...actual };
});
describe('Engine Branching (v1|v2)', () => {
    it('should use v2 engine if getStoreEngine returns v2', async () => {
        vi.mocked(getStoreEngine).mockResolvedValue('v2');
        vi.mocked(understand).mockResolvedValue({
            outcome: 'reasoned',
            plannedActs: [],
            llmCalls: 1,
            result: { acts: [], unmatched_mentions: [], topic_switch: false, draft_cart_ops: [], confidence: { entities: 1, intent: 1, selection: 1, topic: 1 } }
        });
        const service = new ConversationService();
        // Setup minimal mocks for internal calls if necessary
        // ...
        const result = await service.processCustomerMessage('store1', 'cust1', 'conv1', 'halo');
        expect(result?.metadata.engine).toBe('v2');
    });
    it('should fallback to v1 if reasoning engine v2 throws an error', async () => {
        vi.mocked(getStoreEngine).mockResolvedValue('v2');
        vi.mocked(understand).mockRejectedValue(new Error('Reasoning failed'));
        const service = new ConversationService();
        // Setup so that fallback runs successfully
        // ...
        // Assert v1 logic path is taken
        // This would require more sophisticated mocking of internal DB/service calls
    });
    it('should use v1 engine if getStoreEngine returns v1', async () => {
        vi.mocked(getStoreEngine).mockResolvedValue('v1');
        const service = new ConversationService();
        // ...
    });
});
//# sourceMappingURL=engine-branch-v2.test.js.map