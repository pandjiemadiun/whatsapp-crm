import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { prisma } from '../infrastructure/prisma.js';
import { adapters } from '../adapters/container.js';
import { eventBus, type ChatbotEventType, type EventEnvelope } from './event-bus.service.js';

/** FASE 1 — Web realtime foundation (Socket.IO transport, in-proc). */

const WS_PATH = '/api/ws'; // path eksplisit, selaras prefix Express /api

type SenderParty = 'customer' | 'human_agent';

interface JoinContext {
  storeId: string;
  party: SenderParty;
  conversationId: string | null; // customer: conversa‑yang-dimiliki; admin: opsional (viewing)
}

function customerConvRoom(storeId: string, conversationId: string): string {
  return `store:${storeId}:conv:${conversationId}`;
}
function adminRoom(storeId: string): string {
  return `store:${storeId}:admin`;
}

async function verifyAdminViaStoreSetting(token: string): Promise<string | null> {
  // REUSE mekanisme auth.ts (middleware/auth.ts:19-34) — bukan sistem auth kedua.
  const setting = await prisma.storeSetting.findFirst({
    where: { key: 'auth_token', value: token },
    include: { store: true },
  });
  if (!setting || !setting.store || setting.store.deletedAt) return null;
  const expiry = await prisma.storeSetting.findUnique({
    where: { storeId_key: { storeId: setting.storeId, key: 'auth_token_expires_at' } },
  });
  if (!expiry || new Date(expiry.value) < new Date()) return null;
  return setting.store.id;
}

export class RealtimeService {
  private io: SocketIOServer | null = null;
  private readonly wsPath: string;
  private onlineByStore: Map<string, number> = new Map();

  // FASE 4: per-conversation customer Socket.IO presence (authoritative online signal).
  // Single-VPS MVP: in-proc. Keyed by `${storeId}:${conversationId}` (store-scoped →
  // tenant isolated). Only CUSTOMER sockets count; admin sockets are excluded.
  // Owner rule: ONLINE = >= 1 active authenticated customer Web Socket for the
  // conversation. OFFLINE = no active customer socket for the conversation.
  private customerPresence: Map<string, Set<string>> = new Map();

  constructor(wsPath = WS_PATH) {
    this.wsPath = wsPath;
  }

  /** Mount Socket.IO pada http.Server yang SAMA yang melayani Express (pm2). */
  init(httpServer: http.Server, corsOrigins: string[]): SocketIOServer {
    if (this.io) return this.io;

    const io = new SocketIOServer(httpServer, {
      path: this.wsPath,
      cors: { origin: corsOrigins, credentials: true },
    });

    io.use((socket, next) => this.authGuard(socket, next));
    io.on('connection', (socket) => this.onConnection(socket));

    this.io = io;

    // Subsribe EventBus (in-proc) -> WS emit. Satu langganan per event type.
    const subs: ChatbotEventType[] = [
      'message.created',
      'typing.started',
      'typing.stopped',
      'conversation.handoff',
      'conversation.resumed',
      'conversation.resolved',
      'conversation.updated',
      'notification.created',
    ];
    for (const ev of subs) {
      eventBus.subscribe(ev, (env) => this.dispatch(env));
    }

    adapters.logger.info('RealtimeService mounted', { path: this.wsPath });
    return io;
  }

  shutdown(): void {
    if (this.io) {
      this.io.close();
      this.io = null;
      adapters.logger.info('RealtimeService closed');
    }
  }

  /** Apakah ada customer online (untuk FASE 4 notification service). */
  isStoreOnline(storeId: string): boolean {
    const n = this.onlineByStore.get(storeId);
    return !!n && n > 0;
  }

  // FASE 4: conversation-scoped customer presence (see field above).
  private presenceKey(storeId: string, conversationId: string): string {
    return `${storeId}:${conversationId}`;
  }

  /**
   * FASE 4 — authoritative online signal for push eligibility (single-VPS MVP).
   * true  = ada >= 1 active authenticated customer Web Socket untuk conversation ini.
   * false = tidak ada active customer socket untuk conversation ini.
   * Tenant-isolated: lookup memakai storeId + conversationId (store A cannot
   * read presence of store B's conversation).
   */
  isCustomerConversationOnline(storeId: string, conversationId: string): boolean {
    const s = this.customerPresence.get(this.presenceKey(storeId, conversationId));
    return !!s && s.size > 0;
  }

  // ---------- Socket.IO middleware ----------
  private async authGuard(socket: Socket, next: (err?: Error) => void): Promise<void> {
    const q = socket.handshake.query as Record<string, string | undefined>;
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const token = q.token ?? (typeof auth.token === 'string' ? auth.token : undefined);

    try {
      let ctx: JoinContext;

      if (token) {
        // ADMIN: Bearer token — reuse storeSetting lookup (auth.ts:19-34).
        const storeId = await verifyAdminViaStoreSetting(token);
        if (!storeId) {
          next(new Error('unauthorized:invalid_token'));
          return;
        }
        ctx = { storeId, party: 'human_agent', conversationId: q.conversationId ?? null };
      } else {
        // WEB CUSTOMER: slug + uid (+ conversationId bila sudah ada).
        const slug = q.slug;
        const uid = q.uid;
        if (!slug || !uid) {
          next(new Error('unauthorized:missing_credentials'));
          return;
        }
        const store = await prisma.store.findUnique({
          where: { slug, deletedAt: null },
          select: { id: true },
        });
        if (!store) {
          next(new Error('unauthorized:store_not_found'));
          return;
        }
        const customer = await prisma.customer.findFirst({
          where: { webUid: uid, storeId: store.id, deletedAt: null },
          select: { id: true },
        });
        if (!customer) {
          next(new Error('unauthorized:invalid_uid'));
          return;
        }

        let conversationId: string | null = q.conversationId ?? null;
        if (conversationId) {
          const conv = await prisma.conversation.findFirst({
            where: {
              id: conversationId,
              storeId: store.id,
              customerId: customer.id,
              channel: 'web',
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!conv) {
            next(new Error('unauthorized:invalid_conversation'));
            return;
          }
          conversationId = conv.id;
        }
        ctx = { storeId: store.id, party: 'customer', conversationId };
      }

      socket.data.ctx = ctx;
      this.onlineByStore.set(ctx.storeId, (this.onlineByStore.get(ctx.storeId) ?? 0) + 1);
      next();
    } catch (e) {
      adapters.logger.error('WS auth guard error', e as Error);
      next(new Error('auth_error'));
    }
  }

  private onConnection(socket: Socket): void {
    const ctx: JoinContext = socket.data.ctx;

    if (ctx.party === 'customer' && ctx.conversationId) {
      // Customer hanya dapat event pada conversation room miliknya (multi-tenant isolated).
      socket.join(customerConvRoom(ctx.storeId, ctx.conversationId));
      // FASE 4: register this customer socket as present-on-conversation.
      const key = this.presenceKey(ctx.storeId, ctx.conversationId);
      let set = this.customerPresence.get(key);
      if (!set) {
        set = new Set();
        this.customerPresence.set(key, set);
      }
      set.add(socket.id);
    }
    if (ctx.party === 'human_agent') {
      // Admin menerima semua event tenant-nya (badge inbox), + conv room bila sedang view.
      socket.join(adminRoom(ctx.storeId));
      if (ctx.conversationId) {
        socket.join(customerConvRoom(ctx.storeId, ctx.conversationId));
      }
    }

    // Admin -> customer typing forward (FASE 1 contract: typing.started/stopped).
    // Customer tidak perlu 'emit' ke server untuk typing ke admin — itu via HTTP POST /typing
    // (lihat routes/pwa.ts).
    socket.on('admin_typing', (payload: { conversationId: string; typing: boolean }) => {
      if (ctx.party !== 'human_agent' || !payload.conversationId) return;
      const room = customerConvRoom(ctx.storeId, payload.conversationId);
      if (!this.io) return;
      this.io.to(room).emit(payload.typing ? 'typing.started' : 'typing.stopped', {
        conversationId: payload.conversationId,
        party: 'human_agent',
        channel: 'web',
      });
    });

    socket.on('disconnect', () => {
      const n = (this.onlineByStore.get(ctx.storeId) ?? 1) - 1;
      if (n <= 0) this.onlineByStore.delete(ctx.storeId);
      else this.onlineByStore.set(ctx.storeId, n);

      // FASE 4: remove this customer socket from per-conversation presence.
      // Presence stays true while >= 1 customer socket remains; becomes false only
      // when the LAST customer socket for the conversation disconnects (#8/#9).
      if (ctx.party === 'customer' && ctx.conversationId) {
        const key = this.presenceKey(ctx.storeId, ctx.conversationId);
        const set = this.customerPresence.get(key);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) this.customerPresence.delete(key);
        }
      }
    });
  }

  // ---------- EventBus dispatch -> WS emit ----------
  private dispatch(env: EventEnvelope): void {
    if (!this.io) return;
    const { storeId, event } = env;
    const data: Record<string, unknown> =
      env.data && typeof env.data === 'object' ? (env.data as Record<string, unknown>) : {};
    const convId = data.conversationId ? String(data.conversationId) : null;

    let rooms: string[] = [];
    switch (event) {
      case 'message.created':
        // Customer + admin-viewing-conversation sama‑satu. Per-socket Socket.IO
        // dedup: socket di kedua room menerima sekali per emit.
        rooms = [customerConvRoom(storeId, convId!), adminRoom(storeId)];
        break;
      case 'typing.started':
      case 'typing.stopped': {
        const party = data.party as SenderParty | undefined;
        // customer typing -> admin lihat; admin typing -> customer lihat.
        rooms =
          party === 'customer'
            ? [adminRoom(storeId)]
            : convId
              ? [customerConvRoom(storeId, convId)]
              : [];
        break;
      }
      case 'conversation.handoff':
      case 'conversation.resumed':
      case 'conversation.resolved':
      case 'conversation.updated':
        rooms = convId
          ? [adminRoom(storeId), customerConvRoom(storeId, convId)]
          : [adminRoom(storeId)];
        break;
      case 'notification.created':
        rooms = convId
          ? [adminRoom(storeId), customerConvRoom(storeId, convId)]
          : [adminRoom(storeId)];
        break;
      default:
        rooms = [];
    }

    if (!rooms.length) return;
    // Union room, single emit → per-socket dedup (Socket.IO guarantee).
    let broadcaster: unknown = this.io;
    for (const r of rooms) {
      broadcaster = (broadcaster as { to: (r: string) => unknown }).to(r);
    }
    (broadcaster as { emit: (ev: string, payload: unknown) => void }).emit(event, data);
  }
}

export const realtimeService = new RealtimeService();
