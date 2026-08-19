/**
 * Handoff Service — reusable human-takeover trigger (P4-2).
 *
 * Extracted (pure extract-method, NO behavior change) from the inline body of
 * `POST /api/pwa/:storeSlug/handoff` in routes/pwa.ts. Both the PWA handoff
 * route and the CONTACT_ADMIN structured action handler call THIS function so
 * the escalation convention stays single-source:
 *
 *   - conversation.status = 'human_takeover' + humanTakeoverAt
 *   - a `handoff` conversationHistory row (the customer-facing reply)
 *   - eventBus.publish('message.created' type 'handoff')  -> realtime -> customer
 *   - eventBus.publish('conversation.handoff')            -> dashboard alert
 *   - eventBus.publish('conversation.updated')            -> dashboard inbox refresh
 *
 * Reuses the EXISTING composer helpers (composeEscalateReply / escalateStatusUpdate
 * convention) as-is — those are NOT modified (contract P4-2 DILARANG list).
 *
 * Conversation Engine (conversation.service.ts) is NOT touched — this is a
 * standalone service, not the engine escalation path (still locked §6A.11.6).
 */

import { prisma } from '../infrastructure/prisma.js';
import { eventBus } from './event-bus.service.js';
import { composeEscalateReply } from './chat/composer-v2.js';
import { ResponseSource } from '../domain/types.js';
import { fonnteService } from './fonnte.service.js';
import { gowaAdapter } from '../adapters/whatsapp/gowa.adapter.js';
import { adapters } from '../adapters/container.js';

const HANDOFF_REASON = 'escalation_clarification_retry_exceeded';

export interface ExecuteHandoffInput {
  conversationId: string;
  storeId: string;
  channel: 'whatsapp' | 'web';
}

export interface ExecuteHandoffResult {
  messageId: string;
  status: string;
  content: string;
}

/**
 * Mark a conversation for human takeover and notify both the customer (WS) and
 * the dashboard (eventBus). Runs the status update + history insert inside a
 * single $transaction, mirroring the original route exactly.
 */
export async function executeHandoff(input: ExecuteHandoffInput): Promise<ExecuteHandoffResult> {
  const { conversationId, storeId, channel } = input;
  const escalateReply = composeEscalateReply();
  const now = new Date();

  const messageRow = await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: conversationId },
      data: { status: 'human_takeover', humanTakeoverAt: now },
    });
    return tx.conversationHistory.create({
      data: {
        conversationId,
        role: 'assistant',
        content: escalateReply,
        source: ResponseSource.HUMAN,
        messageType: 'handoff',
        metadata: { messagePayload: { reason: HANDOFF_REASON, content: escalateReply } },
        createdAt: now,
      },
    });
  });

  eventBus.publish({
    event: 'message.created',
    storeId,
    data: {
      id: messageRow.id,
      conversationId,
      sender: 'assistant',
      type: 'handoff',
      payload: { reason: HANDOFF_REASON, content: escalateReply },
      content: escalateReply,
      source: ResponseSource.HUMAN,
      confidence: 0.9,
      createdAt: now,
    },
    ts: Date.now(),
  });
  eventBus.publish({
    event: 'conversation.handoff',
    storeId,
    data: { conversationId, status: 'human_takeover' },
    ts: Date.now(),
  });
  eventBus.publish({
    event: 'conversation.updated',
    storeId,
    data: { conversationId, status: 'human_takeover', lastMessageAt: now },
    ts: Date.now(),
  });

  // Optional WA push — only for whatsapp-channel conversations that actually
  // have a customer phone (web customers have null phone, so this is a no-op
  // for the PWA path). Mirrors routes/conversations.ts:226-257 gateway choice.
  if (channel === 'whatsapp') {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { customerPhone: true },
      });
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { fonnteToken: true, phoneNumber: true },
      });
      const phone = conversation?.customerPhone;
      if (conversation && store && phone) {
        if (store.fonnteToken) {
          await fonnteService.sendMessage(phone, escalateReply, { token: store.fonnteToken });
        } else if (store.phoneNumber) {
          const did = `garuda-${storeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20)}`;
          await gowaAdapter.sendMessage(phone, escalateReply, { deviceId: did });
        }
      }
    } catch (err) {
      adapters.logger.warn('Handoff WA push failed', err as Error);
    }
  }

  return { messageId: messageRow.id, status: 'human_takeover', content: escalateReply };
}
