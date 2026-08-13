/**
 * FASE 3 — smoke/integration test (verification script, NOT production source).
 *
 *   npx tsx --env-file=../../.env scripts/smoke-fase3-chatbox.ts
 *
 * Pattern sama seperti smoke-fase1-realtime.ts: boot Express + http server
 * (ephemeral port, TIDAK sentuh pm2; realtimeService.init mount WS di port
 * yang sama), WS client via deep path ../../pwa/node_modules/socket.io-client,
 * fixtures prefix "f3-" + cleanup di finally.
 *
 * Engine INTENTIONALLY NOT triggered (tidak ada LLM): customer-message tests
 * pre-set conversation.status='human_takeover' → processCustomerMessage mengembalikan
 * null (pending_human path) TANPA panggil engine/LLM.
 *
 * WA gateway DITIMBANG (monkeypatch singleton method) — TIDAK ada panggilan jaringan
 * eksternal (FASE 3 rule: uji regression tanpa call Fonnte/GOWA asli).
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import { io, type Socket } from '../../pwa/node_modules/socket.io-client/build/cjs/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
const dc = dotenv.config({ path: envPath });
if (!fs.existsSync(envPath) || dc?.error || !process.env.DATABASE_URL) {
  console.error('[f3] .env/DATABASE_URL tidak tersedia:', dc?.error?.message ?? 'no DATABASE_URL');
  process.exit(2);
}

const { prisma } = await import('../src/infrastructure/prisma.js');
const { realtimeService } = await import('../src/services/realtime.service.js');
const { eventBus } = await import('../src/services/event-bus.service.js');
const { messageQueueService } = await import('../src/services/message-queue.service.js');
const { conversationDeliveryService } = await import('../src/services/conversation-delivery.service.js');
const pwaRouter = (await import('../src/routes/pwa.js')).default;
const conversationsRouter = (await import('../src/routes/conversations.js')).default;
import { fonnteService } from '../src/services/fonnte.service.js';
import { gowaAdapter } from '../src/adapters/whatsapp/gowa.adapter.js';

type AnyEnv = Record<string, string | number>;
let passed = 0;
let failed = 0;
const ok = (n: string) => { passed++; console.log('  \u2705 ' + n); };
const fail = (n: string, e?: unknown) => { failed++; console.log('  \u274c ' + n + (e ? ' :: ' + (e as Error).message : '')); };
const assert = (c: boolean, n: string, e?: unknown) => (c ? ok(n) : fail(n, e));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ADMIN_TOKEN_1 = 'admin-token-f3-1';
const ADMIN_TOKEN_2 = 'admin-token-f3-2';
const S1 = 'store-f3-1';
const S2 = 'store-f3-2';

// ---- Fixtures (idempoten) ----
try {
  const orphans = await prisma.conversation.findMany({ where: { storeId: { in: [S1, S2] }, deletedAt: null }, select: { id: true } });
  const oids = orphans.map((c) => c.id);
  if (oids.length) {
    await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: oids } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { storeId: { in: [S1, S2] } } }).catch(() => {});
  }
} catch {}
await prisma.customer.deleteMany({ where: { storeId: { in: [S1, S2] } } }).catch(() => {});
await prisma.storeSetting.deleteMany({ where: { storeId: { in: [S1, S2] } } }).catch(() => {});
await prisma.store.deleteMany({ where: { id: { in: [S1, S2] } } }).catch(() => {});

const store1 = await prisma.store.upsert({
  where: { id: S1 },
  update: { slug: 'f3-1', name: 'F3-1', fonnteToken: 'fake-f3' },
  create: { id: S1, slug: 'f3-1', name: 'F3-1', fonnteToken: 'fake-f3' },
});
await prisma.store.upsert({
  where: { id: S2 },
  update: { slug: 'f3-2', name: 'F3-2' },
  create: { id: S2, slug: 'f3-2', name: 'F3-2' },
});
await prisma.storeSetting.createMany({
  data: [
    { storeId: S1, key: 'auth_token', value: ADMIN_TOKEN_1 },
    { storeId: S1, key: 'auth_token_expires_at', value: new Date(Date.now() + 3600_000).toISOString() },
    { storeId: S2, key: 'auth_token', value: ADMIN_TOKEN_2 },
    { storeId: S2, key: 'auth_token_expires_at', value: new Date(Date.now() + 3600_000).toISOString() },
  ],
  skipDuplicates: true,
});
await prisma.storeSetting.updateMany({ where: { storeId: S1, key: 'auth_token_expires_at' }, data: { value: new Date(Date.now() + 3600_000).toISOString() } });
await prisma.storeSetting.updateMany({ where: { storeId: S2, key: 'auth_token_expires_at' }, data: { value: new Date(Date.now() + 3600_000).toISOString() } });

await prisma.customer.upsert({ where: { id: 'cust-f3-1' }, update: {}, create: { id: 'cust-f3-1', storeId: S1, webUid: 'uid-f3-1', phone: null } });
await prisma.customer.upsert({ where: { id: 'cust-f3-2' }, update: {}, create: { id: 'cust-f3-2', storeId: S2, webUid: 'uid-f3-2', phone: null } });
await prisma.customer.upsert({ where: { id: 'cust-f3-wa' }, update: {}, create: { id: 'cust-f3-wa', storeId: S1, webUid: 'uid-f3-wa', phone: '+6281234567890' } });

// convF3: web, pre-set human_takeover agar customer-message path TIDAK panggil LLM
const convF3 = await prisma.conversation.upsert({
  where: { id: 'conv-f3-1' },
  update: { status: 'human_takeover', customerPhone: null, channel: 'web', metadata: { preExistingKey: 'keep-me' } },
  create: { id: 'conv-f3-1', storeId: S1, customerId: 'cust-f3-1', channel: 'web', customerPhone: null, status: 'human_takeover', metadata: { preExistingKey: 'keep-me' } },
});
const convWA = await prisma.conversation.upsert({
  where: { id: 'conv-f3-wa' },
  update: { channel: 'whatsapp', customerPhone: '+6281234567890', status: 'open' },
  create: { id: 'conv-f3-wa', storeId: S1, customerId: 'cust-f3-wa', channel: 'whatsapp', customerPhone: '+6281234567890', status: 'open' },
});

// ---- Boot ephemeral Express + WS server ----
const app = express();
app.use(express.json());
app.use('/api/pwa', pwaRouter);
app.use('/api/conversations', conversationsRouter);
const server = http.createServer(app);
realtimeService.init(server, ['http://localhost:5173', 'http://localhost:3000', 'https://qlobot.web.id']);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
const origin = `http://localhost:${port}`;
const sockets: Socket[] = [];

const connectAdmin = async (token: string): Promise<{ socket: Socket; err: string | null }> =>
  new Promise((resolve) => {
    const socket = io(origin, { path: '/api/ws', transports: ['websocket'], reconnection: false, timeout: 3000, auth: { token } });
    sockets.push(socket);
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; socket.close(); resolve({ socket, err: 'timeout' }); } }, 4000);
    socket.on('connect', () => { if (!settled) { settled = true; clearTimeout(t); resolve({ socket, err: null }); } });
    socket.on('connect_error', (e: Error) => { if (!settled) { settled = true; clearTimeout(t); socket.close(); resolve({ socket, err: e.message }); } });
  });

const connectCustomer = async (query: AnyEnv): Promise<{ socket: Socket; err: string | null }> =>
  new Promise((resolve) => {
    const socket = io(origin, { path: '/api/ws', transports: ['websocket'], reconnection: false, timeout: 3000, query });
    sockets.push(socket);
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; socket.close(); resolve({ socket, err: 'timeout' }); } }, 4000);
    socket.on('connect', () => { if (!settled) { settled = true; clearTimeout(t); resolve({ socket, err: null }); } });
    socket.on('connect_error', (e: Error) => { if (!settled) { settled = true; clearTimeout(t); socket.close(); resolve({ socket, err: e.message }); } });
  });

const authFetch = (tok: string, url: string, init: RequestInit = {}) =>
  fetch(origin + url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } });

// Monkeypatch WA gateway singletons — NO network (FASE 3 rule).
let fonnteCalled = false;
let gowaCalled = false;
(fonnteService as any).sendMessage = async () => { fonnteCalled = true; throw new Error('stub-fonfte'); };
(gowaAdapter as any).sendMessage = async () => { gowaCalled = true; throw new Error('stub-gowa'); };

try {
  // ===== [1] admin WS authentication =====
  console.log('\n[1] Admin WS authentication (Bearer token -> verified)');
  {
    const { socket, err } = await connectAdmin(ADMIN_TOKEN_1);
    assert(!err && !!socket.connected, 'admin connect_ok with valid token', err ? new Error(err) : undefined);
  }

  // ===== [2] admin tenant isolation =====
  console.log('\n[2] Admin tenant isolation: admin s1 tidak menerima event store s2');
  {
    const admin1 = await connectAdmin(ADMIN_TOKEN_1);
    const received: any[] = [];
    admin1.socket.on('message.created', (d: any) => received.push(d));
    // publish via EventBus (in-proc) dengan storeId=S2 -> dispatch hanya ke room store:s2:admin
    eventBus.publish({ event: 'message.created', storeId: S2, data: { id: 'iso-1', conversationId: convWA.id, sender: 'assistant', type: 'text', content: 'x', createdAt: new Date() }, ts: Date.now() });
    await wait(200);
    assert(received.length === 0, 'admin s1 tidak menerima event store s2 (room terisolasi per store)');

    const admin2 = await connectAdmin(ADMIN_TOKEN_2);
    const seen2: any[] = [];
    admin2.socket.on('message.created', (d: any) => seen2.push(d));
    eventBus.publish({ event: 'message.created', storeId: S2, data: { id: 'iso-2', conversationId: convWA.id, sender: 'assistant', type: 'text', content: 'y', createdAt: new Date() }, ts: Date.now() });
    await wait(200);
    assert(seen2.length === 1, 'admin s2 (owner store s2) menerima event store s2');
  }

  // ===== [3] Web conversation ownership =====
  console.log('\n[3] Web conversation ownership (cross-tenant reject)');
  {
    const { err } = await connectCustomer({ slug: 'f3-2', uid: 'uid-f3-2', conversationId: convF3.id });
    assert(!!err && /invalid_conversation/.test(err), 'store2 uid present conv (store1) -> reject');
  }
  {
    const { err } = await connectCustomer({});
    assert(!!err && /missing_credentials/.test(err), 'anonymous -> reject');
  }
  {
    const { err } = await connectCustomer({ slug: 'f3-1', uid: 'uid-f3-1', conversationId: convF3.id });
    assert(!err, 'customer pemilik conv -> connect_ok');
  }

  // ===== [4] customer message realtime + identity (human_takeover -> no LLM) =====
  console.log('\n[4] Customer web message realtime (human_takeover path, no LLM)');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const msgs: any[] = [];
    admin.socket.on('message.created', (d: any) => msgs.push(d));
    await fetch(`${origin}/api/pwa/f3-1/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', message: 'permintaan A' }) }).then((r) => r.json());
    await wait(250);
    const custMsg = msgs.find((m) => m.sender === 'customer' && m.content === 'permintaan A');
    assert(!!custMsg, 'admin menerima customer message.created');
    const dbCust = await prisma.conversationHistory.findFirst({ where: { conversationId: convF3.id, role: 'user' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    assert(custMsg && dbCust && custMsg.id === dbCust.id, 'customer WS id == DB conversation_history.id');
    assert(custMsg && custMsg.type === 'text', 'customer type=text');
    assert(custMsg && custMsg.conversationId === convF3.id, 'customer message.created carries conversationId (tetap sama)');
  }

  // ===== [5] CRITICAL: customer message determinism (request A vs B tidak tertukar) =====
  console.log('\n[5] CRITICAL customer-message determinism (A != B, tidak tertukar)');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const seen: string[] = [];
    admin.socket.on('message.created', (d: any) => { if (d.sender === 'customer') seen.push(d.content); });
    await fetch(`${origin}/api/pwa/f3-1/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', message: 'permintaan A' }) }).then((r) => r.json());
    await wait(200);
    await fetch(`${origin}/api/pwa/f3-1/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', message: 'permintaan B' }) }).then((r) => r.json());
    await wait(250);
    const order = seen.join('|');
    assert(order === 'permintaan A|permintaan B', 'event urut A lalu B (deterministic, tidak tertukar): ' + order);
  }

  // ===== [6] admin reply = EXACTLY ONE DB INSERT =====
  console.log('\n[6] Admin reply = exactly ONE DB INSERT');
  {
    const before = await prisma.conversationHistory.count({ where: { conversationId: convF3.id } });
    const res = await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Balasan admin' }),
    }).then((r) => r.json());
    const after = await prisma.conversationHistory.count({ where: { conversationId: convF3.id } });
    assert(after - before === 1, 'history row delta == 1 (single INSERT, rule #1)');
    const dbRow = await prisma.conversationHistory.findUnique({ where: { id: res.messageId }, select: { id: true, role: true, source: true } });
    assert(!!dbRow, 'HTTP messageId == DB conversation_history.id (rule #2)');
    assert(dbRow?.role === 'agent' && dbRow?.source === 'dashboard', 'DB role tetap agent / source dashboard (rule #5, tidak diubah)');
  }

  // ===== [7-9] admin reply WS message.created (human_agent, id=DB, convId stable, 1x) =====
  console.log('\n[7-9] Admin reply WS message.created (human_agent, id=DB, convId stable, single publish)');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const received: any[] = [];
    admin.socket.on('message.created', (d: any) => received.push(d));
    const before = await prisma.conversationHistory.count({ where: { conversationId: convF3.id } });
    const res = await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Balasan WS' }),
    }).then((r) => r.json());
    await wait(250);
    const after = await prisma.conversationHistory.count({ where: { conversationId: convF3.id } });
    const humanMsg = received.find((m) => m.sender === 'human_agent');
    assert(!!humanMsg, 'admin WS menerima message.created human_agent');
    assert(humanMsg && humanMsg.type === 'text', 'human_agent type=text');
    assert(humanMsg && humanMsg.content === 'Balasan WS', 'human_agent content tepat');
    assert(humanMsg && humanMsg.source === 'dashboard', 'human_agent source=dashboard');
    assert(humanMsg && humanMsg.id === res.messageId, 'WS data.id === HTTP messageId (rule #2/#30)');
    assert(after - before === 1, 'hanya 1 INSERT baru (WS zero INSERT, rule #1)');
    assert(humanMsg && humanMsg.conversationId === convF3.id, 'conversationId tidak berubah (rule #8)');
    assert(received.filter((m) => m.sender === 'human_agent').length === 1, 'hanya 1 message.created human_agent (server dedup, rule #13)');
  }

  // ===== [10] customer sender =====
  console.log('\n[10] customer sender="customer" (lihat test 4)');
  ok('customer sender kanonis "customer"');

  // ===== [12] PWA (web customer) menerima admin reply human_agent =====
  console.log('\n[12] PWA (web customer) menerima admin reply human_agent');
  {
    const { socket: cust, err } = await connectCustomer({ slug: 'f3-1', uid: 'uid-f3-1', conversationId: convF3.id });
    assert(!err, 'customer WS connect_ok', err ? new Error(err) : undefined);
    if (!err) {
      const seen: any[] = [];
      cust.on('message.created', (d: any) => { if (d.sender === 'human_agent') seen.push(d); });
      const res = await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/reply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Untuk web customer' }),
      }).then((r) => r.json());
      await wait(250);
      const got = seen.find((m) => m.id === res.messageId);
      assert(!!got && got.content === 'Untuk web customer', 'PWA menerima human_agent via WS (id kanonis)');
    }
  }

  // ===== [13-14] dashboard dedup + WA regression + Web skip gateway =====
  console.log('\n[13-14] Dashboard dedup + WhatsApp regression + Web skip gateway');
  {
    // WA reply -> fonfte ATTEMPTED
    fonnteCalled = false; gowaCalled = false;
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const seen: any[] = [];
    admin.socket.on('message.created', (d: any) => seen.push(d));
    const waRes = await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convWA.id}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'WA balasan' }),
    }).then((r) => r.json());
    await wait(250);
    assert(fonnteCalled === true, 'WA reply ATTEMPTS Fonnte (regression — existing behavior)');
    assert(waRes.sendError === 'Fonnte send failed', 'WA sendError reflects gateway attempt');
    assert(seen.filter((m) => m.id === waRes.messageId && m.sender === 'human_agent').length === 1, 'WA admin reply publish WS message.created (dashboard)');

    // Web reply -> Fonfte/GOWA NOT called
    fonnteCalled = false; gowaCalled = false;
    const webRes = await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Web balasan' }),
    }).then((r) => r.json());
    assert(fonnteCalled === false, 'Web reply does NOT call Fonfte (rule #4)');
    assert(gowaCalled === false, 'Web reply does NOT call GOWA (rule #4)');
    assert(webRes.sendError === null, 'Web reply sendError null (gateway skipped)');
    assert(webRes.messageId !== undefined, 'Web reply returns messageId');
  }

  // ===== [15-17] status events + resolvedAt =====
  console.log('\n[15-17] Status events (handoff/resume/resolved) + resolvedAt persisted');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const handoff = new Promise<string>((res) => admin.socket.on('conversation.handoff', (d: any) => res(d.status)));
    const resumed = new Promise<string>((res) => admin.socket.on('conversation.resumed', (d: any) => res(d.status)));
    const resolved = new Promise<string>((res) => admin.socket.on('conversation.resolved', (d: any) => res(d.status)));
    await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'human_takeover' }) }).then((r) => r.json());
    await wait(250);
    await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'open' }) }).then((r) => r.json());
    await wait(250);
    await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) }).then((r) => r.json());
    await wait(250);
    assert((await handoff) === 'human_takeover', 'conversation.handoff (human_takeover)');
    assert((await resumed) === 'open', 'conversation.resumed (open)');
    assert((await resolved) === 'resolved', 'conversation.resolved (resolved)');
    const db = await prisma.conversation.findUnique({ where: { id: convF3.id }, select: { status: true, resolvedAt: true } });
    assert(db?.status === 'resolved', 'DB status == resolved');
    assert(!!db?.resolvedAt, 'resolvedAt persisted');
  }

  // ===== [18] conversation.updated =====
  console.log('\n[18] conversation.updated published');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const updated: any[] = [];
    admin.socket.on('conversation.updated', (d: any) => updated.push(d));
    await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then((r) => r.json());
    await wait(250);
    assert(updated.filter((d) => d.conversationId === convF3.id).length >= 1, 'conversation.updated diterima setelah read');
  }

  // ===== [19] customer typing -> admin =====
  console.log('\n[19] customer typing -> admin room');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const typing: any[] = [];
    admin.socket.on('typing.started', (d: any) => typing.push(d));
    admin.socket.on('typing.stopped', (d: any) => typing.push({ stopped: true, ...d }));
    await fetch(`${origin}/api/pwa/f3-1/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', conversationId: convF3.id, typing: true }) }).then((r) => r.status);
    await wait(250);
    assert(typing.filter((t) => !t.stopped).length === 1, 'admin menerima typing.started');
    const party = typing.find((t) => !t.stopped)?.party;
    assert(party === 'customer', 'typing party == customer');
  }

  // ===== [20] admin typing -> customer =====
  console.log('\n[20] admin typing -> customer conversation room');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    const { socket: cust, err } = await connectCustomer({ slug: 'f3-1', uid: 'uid-f3-1', conversationId: convF3.id });
    assert(!err, 'customer connect for typing test', err ? new Error(err) : undefined);
    const seen: string[] = [];
    cust.on('typing.started', (d: any) => seen.push(d.party));
    cust.on('typing.stopped', (d: any) => seen.push('stopped:' + d.party));
    admin.socket.emit('admin_typing', { conversationId: convF3.id, typing: true });
    await wait(250);
    assert(seen.includes('human_agent'), 'customer menerima typing.started party=human_agent');
  }

  // ===== [22] typing throttle =====
  console.log('\n[22] POST /typing throttle (1s)');
  {
    await fetch(`${origin}/api/pwa/f3-1/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', conversationId: convF3.id, typing: true }) }).then((r) => r.status);
    await wait(100);
    const t2 = await fetch(`${origin}/api/pwa/f3-1/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', conversationId: convF3.id, typing: true }) }).then((r) => r.status);
    assert(t2 === 429, 'typing throttle -> 429');
  }

  // ===== [24] customer read =====
  console.log('\n[24] Customer read (POST /pwa/:slug/read) -> webLastReadAt');
  {
    await authFetch(ADMIN_TOKEN_1, `/api/pwa/f3-1/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-f3-1', conversationId: convF3.id }) }).then((r) => r.json());
    await wait(200);
    const meta = await prisma.conversation.findUnique({ where: { id: convF3.id }, select: { metadata: true } }) as any;
    const m = meta?.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
    assert(!!m?.webLastReadAt, 'webLastReadAt persisted (metadata JSON, no migration)');
  }

  // ===== [25] admin read =====
  console.log('\n[25] Admin read (POST /conversations/:id/read) -> adminLastReadAt');
  {
    await authFetch(ADMIN_TOKEN_1, `/api/conversations/${convF3.id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then((r) => r.json());
    await wait(200);
    const meta = await prisma.conversation.findUnique({ where: { id: convF3.id }, select: { metadata: true } }) as any;
    const m = meta?.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
    assert(!!m?.adminLastReadAt, 'adminLastReadAt persisted (metadata JSON)');
  }

  // ===== [26] unread calculation =====
  console.log('\n[26] Unread calculation = count(role=user, createdAt > adminLastReadAt)');
  {
    // reset convF3 customer history (tests 4/5/24 seeded user msgs) agar deterministik
    await prisma.conversationHistory.deleteMany({ where: { conversationId: convF3.id, role: 'user' } });
    const past = new Date(Date.now() - 120000).toISOString();
    await prisma.conversation.update({ where: { id: convF3.id }, data: { metadata: { preExistingKey: 'keep-me', adminLastReadAt: past, webLastReadAt: past } } });
    await prisma.conversationHistory.create({ data: { conversationId: convF3.id, role: 'user', content: 'u1', createdAt: new Date(Date.now() - 30000) } });
    await prisma.conversationHistory.create({ data: { conversationId: convF3.id, role: 'user', content: 'u2', createdAt: new Date(Date.now() - 10000) } });
    const list = await authFetch(ADMIN_TOKEN_1, `/api/conversations`).then((r) => r.json());
    const item = list.data.find((c: any) => c.id === convF3.id);
    assert(item?.unreadCount === 2, `unreadCount == 2 (got ${item?.unreadCount})`);
  }

  // ===== [27] metadata preservation =====
  console.log('\n[27] Metadata preservation (preExistingKey tetap)');
  {
    const meta = await prisma.conversation.findUnique({ where: { id: convF3.id }, select: { metadata: true } }) as any;
    const m = meta?.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
    assert(m?.preExistingKey === 'keep-me', 'preExistingKey preserved through read/reply/status changes');
  }

  // ===== [28] reconnect / catch-up =====
  console.log('\n[28] Reconnect -> admin room re-joined, event diterima');
  {
    const admin = await connectAdmin(ADMIN_TOKEN_1);
    // admin sudah connected oleh connectAdmin(); disconnect eksplisit, lalu reconnect baru
    admin.socket.disconnect();
    await wait(500);
    const recon = await connectAdmin(ADMIN_TOKEN_1);
    const seen: string[] = [];
    recon.socket.on('message.created', (d: any) => seen.push(d.id));
    eventBus.publish({ event: 'message.created', storeId: S1, data: { id: 'reconnect-probe', conversationId: convF3.id, sender: 'human_agent', type: 'text', content: 'after reconnect', source: 'dashboard', createdAt: new Date() }, ts: Date.now() });
    await wait(250);
    assert(seen.includes('reconnect-probe'), 'admin menerima event setelah reconnect (room kembali di-join)');
  }

  // ===== [29] conversationId unchanged =====
  console.log('\n[29] conversationId unchanged (web + admin reply)');
  {
    const convs = await prisma.conversation.findMany({ where: { storeId: S1, deletedAt: null }, select: { id: true } });
    assert(convs.some((c) => c.id === convF3.id), 'conversation conv-f3-1 tetap ada (tidak dibuat baru)');
  }

  console.log(`\n===== FASE3 SMOKE RESULT: ${passed} passed, ${failed} failed =====`);
} finally {
  console.log('\n[CLEANUP] socket close + remove fixtures');
  for (const s of sockets) try { s.close(); } catch {}
  await wait(300);
  const SMOKE = [S1, S2];
  const orphans = await prisma.conversation.findMany({ where: { storeId: { in: SMOKE } }, select: { id: true } });
  if (orphans.length) await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: orphans.map((c) => c.id) } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: { in: SMOKE } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { storeId: { in: SMOKE } } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId: { in: SMOKE } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { in: SMOKE } } }).catch(() => {});
  try { await prisma.$disconnect(); } catch {}
  server.close(() => {});
}

setTimeout(() => process.exit(failed === 0 ? 0 : 1), 800);
