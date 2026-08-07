import cron from 'node-cron';
import { prisma } from '../infrastructure/prisma.js';
import { analyzeAndGenerateFaqDrafts } from '../services/learning.service.js';
import { adapters } from '../adapters/container.js';
/**
 * Learning Scheduler — auto-generate FAQ drafts from AI-answered questions.
 *
 * Daily at 3:00 AM WIB (Asia/Jakarta). Iterates all active stores and
 * calls analyzeAndGenerateFaqDrafts for each.
 */
export function scheduleLearning() {
    // 3:00 AM WIB = 3:00 AM in Jakarta timezone
    // node-cron uses server local time (TZ=Asia/Jakarta)
    const schedule = process.env.LEARNING_CRON || '0 3 * * *';
    cron.schedule(schedule, async () => {
        adapters.logger.info('[Learning Scheduler] Starting daily FAQ draft generation...');
        try {
            await runLearningCycle();
        }
        catch (error) {
            adapters.logger.error('[Learning Scheduler] Learning cycle failed', error);
        }
    });
    adapters.logger.info(`[Learning Scheduler] Started — cron "${schedule}" (3 AM WIB daily)`);
}
async function runLearningCycle() {
    const stores = await prisma.store.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true },
    });
    adapters.logger.info('[Learning Scheduler] Found active stores', { count: stores.length });
    for (const store of stores) {
        try {
            const draftCount = await analyzeAndGenerateFaqDrafts(store.id);
            if (draftCount > 0) {
                adapters.logger.info('[Learning Scheduler] Generated FAQ drafts', {
                    storeId: store.id,
                    storeName: store.name,
                    count: draftCount,
                });
            }
        }
        catch (err) {
            adapters.logger.warn('[Learning Scheduler] Store processing failed', {
                storeId: store.id,
                error: err.message,
            });
        }
    }
}
//# sourceMappingURL=scheduleLearning.js.map