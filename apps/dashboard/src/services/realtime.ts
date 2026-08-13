/**
 * FASE 3 — Dashboard admin realtime (Socket.IO client).
 *
 * Reuse existing AuthContext Bearer token (storeSetting.auth_token -> storeId).
 * PROTECTED files (apps/dashboard/src/contexts/AuthContext.tsx + services/api.ts)
 * are NOT edited — token is read from the same localStorage the app already uses.
 *
 * Server authGuard (services/realtime.service.ts) re-verifies the token and is
 * authoritative: a valid admin token is auto-joined to store:{storeId}:admin (and
 * optionally the viewed conversation room when `conversationId` is supplied). The
 * client MUST NOT trust a room name it computed itself (CRITICAL RULE #9).
 */
import { io, type Socket } from 'socket.io-client';

const WS_PATH = '/api/ws';
const WS_BASE_ORIGIN = import.meta.env.DEV ? 'http://localhost:3000' : '';

export type SenderParty = 'assistant' | 'customer' | 'human_agent';

export interface CreatedMessageData {
  id: string;
  conversationId: string;
  sender: SenderParty;
  type: string;
  content: string;
  source?: string | null;
  confidence?: number | null;
  createdAt?: string;
  payload?: unknown;
}

export interface ConversationEventPayload {
  conversationId: string;
  status?: string;
  lastMessageAt?: string | null;
  humanTakeoverAt?: string | null;
  resolvedAt?: string | null;
  adminLastReadAt?: string | null;
  webLastReadAt?: string | null;
}

type Listener<T> = (payload: T) => void;

interface GarudaUser {
  token?: string;
  storeId?: string;
}

function readUser(): GarudaUser | null {
  try {
    const stored = localStorage.getItem('garuda_user');
    return stored ? (JSON.parse(stored) as GarudaUser) : null;
  } catch {
    return null;
  }
}

class AdminRealtimeService {
  private socket: Socket | null = null;
  private connected = false;
  private readonly listeners = {
    connect: new Set<Listener<void>>(),
    disconnect: new Set<Listener<{ reason: string }>>(),
    reconnect: new Set<Listener<void>>(),
    messageCreated: new Set<Listener<CreatedMessageData>>(),
    conversationHandoff: new Set<Listener<ConversationEventPayload>>(),
    conversationResumed: new Set<Listener<ConversationEventPayload>>(),
    conversationResolved: new Set<Listener<ConversationEventPayload>>(),
    conversationUpdated: new Set<Listener<ConversationEventPayload>>(),
    typingStarted: new Set<Listener<{ conversationId: string }>>(),
    typingStopped: new Set<Listener<{ conversationId: string }>>(),
  };

  private emit<T>(set: Set<Listener<T>>, payload: T): void {
    set.forEach((l) => l(payload));
  }

  get isConnected(): boolean {
    return this.connected && !!this.socket?.connected;
  }

  /** Build a socket authenticated as the logged-in admin (auto-joins admin room). */
  connect(): Socket | null {
    if (this.socket && this.socket.connected) return this.socket;

    const user = readUser();
    if (!user?.token || !user.storeId) return null;

    const origin = WS_BASE_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');
    const socket = io(origin, {
      path: WS_PATH,
      transports: ['websocket'],
      auth: { token: user.token, storeId: user.storeId },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      this.connected = true;
      this.emit(this.listeners.connect, undefined);
    });

    socket.on('disconnect', (reason: string) => {
      this.connected = false;
      this.emit(this.listeners.disconnect, { reason });
    });

    socket.io?.on('reconnect', () => {
      // Server authGuard re-runs on (re)connect -> admin room is re-joined
      // authoritatively. Consumers can use this for an HTTP catch-up.
      this.emit(this.listeners.reconnect, undefined);
    });

    socket.on('connect_error', (err: Error & { message: string }) => {
      // unauthorized token -> stop; Dashboard keeps working via HTTP polling.
      if (err?.message?.startsWith('unauthorized')) {
        this.connected = false;
      }
    });

    socket.on('message.created', (data: CreatedMessageData) => {
      this.emit(this.listeners.messageCreated, data);
    });
    socket.on('conversation.handoff', (d: ConversationEventPayload) =>
      this.emit(this.listeners.conversationHandoff, d),
    );
    socket.on('conversation.resumed', (d: ConversationEventPayload) =>
      this.emit(this.listeners.conversationResumed, d),
    );
    socket.on('conversation.resolved', (d: ConversationEventPayload) =>
      this.emit(this.listeners.conversationResolved, d),
    );
    socket.on('conversation.updated', (d: ConversationEventPayload) =>
      this.emit(this.listeners.conversationUpdated, d),
    );
    socket.on('typing.started', (d: { conversationId?: string; party?: string }) => {
      if (d?.party === 'customer') {
        this.emit(this.listeners.typingStarted, {
          conversationId: String(d.conversationId ?? ''),
        });
      }
    });
    socket.on('typing.stopped', (d: { conversationId?: string; party?: string }) => {
      if (d?.party === 'customer') {
        this.emit(this.listeners.typingStopped, {
          conversationId: String(d.conversationId ?? ''),
        });
      }
    });

    this.socket = socket;
    return socket;
  }

  /** Admin typing indicator -> customer conversation room (existing server mechanism). */
  emitAdminTyping(conversationId: string, typing: boolean): void {
    this.socket?.emit('admin_typing', { conversationId, typing });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.connected = false;
    }
  }

  onConnect(cb: Listener<void>) {
    this.listeners.connect.add(cb);
    return () => this.listeners.connect.delete(cb);
  }
  onDisconnect(cb: Listener<{ reason: string }>) {
    this.listeners.disconnect.add(cb);
    return () => this.listeners.disconnect.delete(cb);
  }
  onReconnect(cb: Listener<void>) {
    this.listeners.reconnect.add(cb);
    return () => this.listeners.reconnect.delete(cb);
  }
  onMessageCreated(cb: Listener<CreatedMessageData>) {
    this.listeners.messageCreated.add(cb);
    return () => this.listeners.messageCreated.delete(cb);
  }
  onConversationHandoff(cb: Listener<ConversationEventPayload>) {
    this.listeners.conversationHandoff.add(cb);
    return () => this.listeners.conversationHandoff.delete(cb);
  }
  onConversationResumed(cb: Listener<ConversationEventPayload>) {
    this.listeners.conversationResumed.add(cb);
    return () => this.listeners.conversationResumed.delete(cb);
  }
  onConversationResolved(cb: Listener<ConversationEventPayload>) {
    this.listeners.conversationResolved.add(cb);
    return () => this.listeners.conversationResolved.delete(cb);
  }
  onConversationUpdated(cb: Listener<ConversationEventPayload>) {
    this.listeners.conversationUpdated.add(cb);
    return () => this.listeners.conversationUpdated.delete(cb);
  }
  onTypingStarted(cb: Listener<{ conversationId: string }>) {
    this.listeners.typingStarted.add(cb);
    return () => this.listeners.typingStarted.delete(cb);
  }
  onTypingStopped(cb: Listener<{ conversationId: string }>) {
    this.listeners.typingStopped.add(cb);
    return () => this.listeners.typingStopped.delete(cb);
  }
}

export const adminRealtime = new AdminRealtimeService();
export default adminRealtime;
