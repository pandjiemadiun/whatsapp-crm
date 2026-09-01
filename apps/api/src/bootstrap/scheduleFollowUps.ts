import cron from 'node-cron';
import { prisma } from '../infrastructure/prisma.js';
import { groqAdapter } from '../adapters/ai/groq.adapter.js';
import { aiProviderResolver } from '../services/ai-provider-resolver.service.js';
import type { AIProvider } from '../adapters/ai/types.js';
import { fonnteService } from '../services/fonnte.service.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { adapters } from '../adapters/container.js';

interface FollowUpScanResult {
  conversationId: string;
  storeId: string;
  customerId: string;
  matched: boolean;
  reasons: string[];
}

interface ScanOpts {
  dryRun?: boolean;
  now?: Date;
}

/**
 * Proactive follow-up scheduler.
 *
 * Every 10 minutes (configurable via FOLLOWUP_CRON env), scans for open conversations
 * that have been inactive for >= (store.config.followUpDelayHours ?? 4) JAM and < 24 jam.
 * Generates a proactive follow-up via Groq and sends it via the store's configured
 * gateway (Fonnte → GOWA fallback). Skips night-mode stores (fallback 08.00–20.00 WIB).
 */
export function scheduleFollowUps(): void {
  const schedule = process.env.FOLLOWUP_CRON || '*/10 * * * *';

  cron.schedule(schedule, async () => {
    adapters.logger.info('[FollowUp Scheduler] Scanning for idle conversations...');
    try {
      await runFollowUpScan();
    } catch (error) {
      adapters.logger.error('[FollowUp Scheduler] Scan failed', error as Error);
    }
  });

  adapters.logger.info(`[FollowUp Scheduler] Started — cron "${schedule}"`);
}

// Exported for dryRun testing
export async function runFollowUpScan(opts: ScanOpts = {}): Promise<FollowUpScanResult[]> {
  const { dryRun = false, now: nowOverride } = opts;
  const now = nowOverride ?? new Date();
  const results: FollowUpScanResult[] = [];

  // Ambang waktu: >= (store.config.followUpDelayHours ?? 4) JAM, < 24 jam
  const maxDelayHours = 24; // maks 24 jam sejak pesan terakhir
  const defaultDelayHours = 4;

  // Fetch open conversations that had activity in the last 24h window
  const minLastMessage = new Date(now.getTime() - maxDelayHours * 60 * 60 * 1000);
  const idleConversations = await prisma.conversation.findMany({
    where: {
      status: 'open',
      deletedAt: null,
      lastMessageAt: { lte: now, gte: minLastMessage },
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          timezone: true,
          operatingHours: true,
          config: true,
          fonnteToken: true,
          phoneNumber: true,
          fonnteNumber: true,
          deletedAt: true,
        },
      },
    },
    take: 20,
  });

  adapters.logger.info('[FollowUp Scheduler] Found candidate conversations', {
    count: idleConversations.length,
    dryRun,
  });

  for (const conv of idleConversations) {
    // Skip deleted stores
    if (conv.store?.deletedAt) {
      continue;
    }

    // Per-store delay threshold
    const storeConfig = (conv.store.config as Record<string, unknown> | null) || {};
    const delayHours = (storeConfig.followUpDelayHours as number | undefined) ?? defaultDelayHours;
    const delayMs = delayHours * 60 * 60 * 1000;

    const reasons: string[] = [];

    // Criterion 1: lastMessageAt >= delayHours ago
    const lastActivityAge = now.getTime() - (conv.lastMessageAt?.getTime() ?? 0);
    if (lastActivityAge < delayMs) {
      reasons.push(`<${delayHours}jam`);
      results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: false, reasons });
      continue;
    }

    // Criterion 2: < 24 jam
    if (lastActivityAge >= maxDelayHours * 60 * 60 * 1000) {
      reasons.push('>=24jam');
      results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: false, reasons });
      continue;
    }

    // Criterion 3: pesan terakhir di conversation_history role=assistant
    const lastHistory = await prisma.conversationHistory.findFirst({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      select: { role: true },
    });
    if (!lastHistory || lastHistory.role !== 'assistant') {
      reasons.push('lastMsgNotAssistant');
      results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: false, reasons });
      continue;
    }

    // Criterion 4: metadata.followUpSentAt null (maks 1x per percakapan)
    const metadata = (conv.metadata as Record<string, unknown> | null) || {};
    if (metadata.followUpSentAt != null) {
      reasons.push('alreadySentFollowUp');
      results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: false, reasons });
      continue;
    }

    // Criterion 5: TIDAK ada Order dengan status paid/completed/delivered/shipped
    const finishedOrder = await prisma.order.findFirst({
      where: {
        conversationId: conv.id,
        deletedAt: null,
        orderStatus: { in: ['paid', 'completed', 'delivered', 'shipped'] },
      },
      select: { id: true },
    });
    if (finishedOrder) {
      reasons.push('orderFinished');
      results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: false, reasons });
      continue;
    }

    // Criterion 6: jam operasional store (fallback 08.00–20.00 WIB)
    if (isNightMode(conv.store.timezone, conv.store.operatingHours, now)) {
      reasons.push('nightMode');
      results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: false, reasons });
      continue;
    }

    // All criteria passed — process follow-up
    if (!dryRun) {
      await processFollowUp(conv, now);
    }
    results.push({ conversationId: conv.id, storeId: conv.storeId, customerId: conv.customerId, matched: true, reasons: ['OK'] });
  }

  return results;
}

interface IdleConversation {
  id: string;
  storeId: string;
  customerId: string;
  customerPhone: string | null;
  customerName: string | null;
  lastMessageAt: Date | null;
  metadata: unknown;
  store: {
    id: string;
    name: string;
    timezone: string;
    operatingHours: unknown;
    config: unknown;
    fonnteToken: string | null;
    phoneNumber: string | null;
    fonnteNumber: string | null;
  };
}

async function processFollowUp(conv: IdleConversation, now: Date): Promise<void> {
  const { store, customerName, customerPhone, id: conversationId, storeId } = conv;
  const followUpTime = new Date();

  // Generate proactive follow-up via Groq
  const lastAssistantMsg = await prisma.conversationHistory.findFirst({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });

  if (!lastAssistantMsg) return;

  const followUpText = await generateFollowUp(customerName, lastAssistantMsg.content, store.name);
  if (!followUpText) return;

  // Send via gateway (Fonnte primary, GOWA fallback)
  let sendError: string | null = null;

  if (store.fonnteToken) {
    try {
      if (!customerPhone) {
        adapters.logger.warn('Skip Fonnte follow-up: customerPhone is null', { conversationId });
      } else {
        await fonnteService.sendMessage(customerPhone, followUpText, { token: store.fonnteToken });
      }
    } catch {
      sendError = 'Fonnte send failed';
    }
  } else if (store.phoneNumber) {
    try {
      if (!customerPhone) {
        adapters.logger.warn('Skip GOWA follow-up: customerPhone is null', { conversationId });
      } else {
        const deviceId = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
        await gowaAdapter.sendMessage(customerPhone, followUpText, { deviceId });
      }
    } catch {
      sendError = 'GOWA send failed';
    }
  } else {
    sendError = 'No WhatsApp gateway configured for this store';
  }

  if (sendError) {
    adapters.logger.warn('[FollowUp Scheduler] Send failed', { conversationId, storeId, error: sendError });
    return;
  }

  // Persist follow-up to history
  await prisma.conversationHistory.create({
    data: {
      id: `followup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      role: 'assistant',
      content: followUpText,
      createdAt: followUpTime,
    },
  });

  // Mark followUpSentAt in conversation metadata (maks 1x per percakapan)
  const existingMetadata = (conv.metadata as Record<string, unknown> | null) || {};
  await prisma.conversation.update({
    where: { id: conversationId, storeId },
    data: {
      lastMessageAt: followUpTime,
      metadata: { ...existingMetadata, followUpSentAt: followUpTime.toISOString() },
    },
  });

  adapters.logger.info('[FollowUp Scheduler] Follow-up sent', { conversationId, storeId });
}

async function generateFollowUp(
  customerName: string | null,
  lastAssistantMessage: string,
  storeName: string
): Promise<string | null> {
  const prompt = `Kamu adalah CS toko online "${storeName}".
Pelanggan belum membalas pesan terakhir Anda. Buat pesan follow-up singkat, ramah, dan natural dalam Bahasa Indonesia yang mendorong pelanggan untuk membalas.

${customerName ? `Pelanggan sudah pernah menyebutkan nama: "${customerName}".` : 'Pelanggan belum pernah menyebutkan nama.'}

Pesan terakhir Anda: "${lastAssistantMessage}"

Aturan:
- Maksimum 1 kalimat
- Gunakan gaya bahasa yang akrab tapi sopan
- Jika ada nama, sebutkan "Kak ${customerName}"
- Jika tidak ada nama, gunakan "Kakak"
- Akhiri dengan ajakan bertanya
- JANGAN gunakan emoji`;

  try {
    // Unit 5: 'batch_task' role — resolver-backed, falls back to the groqAdapter
    // singleton when no active AIProviderConfig row exists for 'batch_task'
    // (default OFF: no rows => groqAdapter, identical to prior behavior).
    const batchTaskProviders = await aiProviderResolver.getProvidersForRole('batch_task');
    const llm: AIProvider = batchTaskProviders.length > 0 ? batchTaskProviders[0] : groqAdapter;
    const result = await llm.generate(prompt, {
      temperature: 0.7,
      maxTokens: 100,
      intent: 'followup',
    });
    const text = result.content.trim();
    return text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
  } catch (err) {
    adapters.logger.warn('[FollowUp Scheduler] Groq generation failed', { error: (err as Error).message });
    return null;
  }
}

/**
 * Check if current time is outside operating hours for the store's timezone.
 * Fallback operating hours: 08.00–20.00 WIB (Asia/Jakarta) when no config exists.
 */
function isNightMode(timezone: string, operatingHours: unknown, now: Date = new Date()): boolean {
  try {
    const tz = timezone || 'Asia/Jakarta';
    const localHour = getHoursInTimezone(now, tz);

    if (operatingHours && typeof operatingHours === 'object') {
      const days = (operatingHours as any).days;
      if (days) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const todayName = dayNames[now.getUTCDay()].toLowerCase();
        const dayInfo = (days as Record<string, { open: string; close: string }>)[todayName];
        if (dayInfo) {
          const openHour = parseInt(dayInfo.open.split(':')[0] || '8', 10);
          const closeHour = parseInt(dayInfo.close.split(':')[0] || '20', 10);
          const isOpen = localHour >= openHour && localHour < closeHour;
          if (!isOpen) return true;
        }
        return false; // days-based, assume open if we can't find today
      }
    }

    // Fallback: 08.00–20.00 WIB
    return localHour < 8 || localHour >= 20;
  } catch {
    return false;
  }
}

function getHoursInTimezone(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}
