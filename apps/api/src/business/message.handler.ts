import { adapters } from '../adapters/container.js';
import { ResponseSource } from '../domain/types.js';

export class MessageHandler {
  async handle(message: string, storeId: string, customerId: string) {
    adapters.logger.info("Handling message", { storeId, customerId });
    
    try {
      // Perbaikan pemanggilan LLM
      const llmResponse = await adapters.llm.chat([{ role: 'user', content: message }]);
      
      return {
        source: ResponseSource.AI,
        response: llmResponse.content,
        costUSD: llmResponse.cost || 0,
        metadata: { tokens: llmResponse.tokens }
      };
    } catch (error) {
      adapters.logger.error("Message handler failed", error as Error);
      return {
        source: ResponseSource.HUMAN,
        response: "Mohon maaf, sistem sedang sibuk.",
        costUSD: 0,
        metadata: { error: true }
      };
    }
  }
}

export const messageHandler = new MessageHandler();
