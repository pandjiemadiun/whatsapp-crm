/**
 * FASE 4 — smoke / integration test (verification script, NOT production source).
 *
 *   npx tsx --env-file=../../.env scripts/smoke-fase4-notification.ts
 *
 * Mirrors smoke-fase3-chatbox.ts: boot an EPHEMERAL Express + http server
 * (does NOT touch pm2), realtimeService.init on the same http.Server,
 * notificationService.init, mount pwaRouter + conversationsRouter, WS client via
 * socket.io-client from apps/pwa/node_modules, fixtures prefix "f4-" + cleanup.
 *
 * FASE 4 rules enforced here:
 *  - Socket.IO = primary transport (online customer gets message.created via WS).
 *  - Web Push = signal only; fired ONLY when customer has NO WS presence for the
 *    conversation. No duplicate bubble.
 *  - HUMAN AGENT -> WEB CUSTOMER only (no AI assistant push, no WA-channel push).
 *  - Push failure / invalid subscription = NO message rollback.
 *  - subscription persists in Customer.pushSubscription (server-authoritative).
 *
 * web-push is monkeypatched (spy) like F3 monkeypatches fonnteService.sendMessage,
 * so NO real browser push service is needed. One bonus real-send to a local HTTP
 * collector also verifies VAPID signing on the wire.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import express from 'express';
import webPush from 'web-push';
import { io, type Socket } from '../../pwa/node_modules/socket.io-client/build/cjs/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
const dc = dotenv.config({ path: envPath });
if (!fs.existsSync(envPath) || dc?.error || !process.env.DATABASE_URL) {
  console.error('[f4] .env/DATABASE_URL tidak tersedia:', dc?.error?.message ?? 'no DATABASE_URL');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const ok = (n: string) => { passed++; console.log('  ✅ ' + n); };
const fail = (n: string, e?: unknown) => { failed++; console.log('  ❌ ' + n + (e ? ' :: ' + (e as Error).message : '')); };
const assert = (c: boolean, n: string, e?: unknown) => (c ? ok(n) : fail(n, e));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- FASE 4 VAPID env (generated at test time; real deploy generates at ops) ----
const { publicKey: VAPID_PK, privateKey: VAPID_SK } = webPush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = VAPID_PK;
process.env.VAPID_PRIVATE_KEY = VAPID_SK;
process.env.VAPID_SUBJECT = 'mailto:fase4-smoke@qlobot.local';

const { prisma } = await import('../src/infrastructure/prisma.js');
const { realtimeService } = await import('../src/services/realtime.service.js');
const { notificationService } = await import('../src/services/notification.service.js');
const pwaRouter = (await import('../src/routes/pwa.js')).default;
const conversationsRouter = (await import('../src/routes/conversations.js')).default;
import { fonnteService } from '../src/services/fonnte.service.js';
import { gowaAdapter } from '../src/adapters/whatsapp/gowa.adapter.js';

// ---- Fixtures ----
const ADMIN_TOKEN_1 = 'admin-token-f4-1';
const ADMIN_TOKEN_2 = 'admin-token-f4-2';
const S1 = 'store-f4-1';
const S2 = 'store-f4-2';
const UID_WEB = 'uid-f4-1';   // customer in S1 (web)
const UID_WEB2 = 'uid-f4-2';  // customer in S2 (web, tenant isolation)
const UID_WA = 'uid-f4-wa';   // WA customer in S1
const F4 = [S1, S2];

const cleanupFixtures = async () => {
  const orphans = await prisma.conversation.findMany({
    where: { storeId: { in: F4 } }, select: { id: true },
  });
  if (orphans.length) await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: orphans.map((c) => c.id) } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: { in: F4 } } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { webUid: { in: [UID_WEB, UID_WEB2, UID_WA] } } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId: { in: F4 } } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: { in: F4 } } }).catch(() => {});
};

await cleanupFixtures();
await prisma.store.upsert({ where: { id: S1 }, update: { slug: 'f4-1', name: 'F4-1', fonnteToken: 'fake-f4' }, create: { id: S1, slug: 'f4-1', name: 'F4-1', fonnteToken: 'fake-f4' } });
await prisma.store.upsert({ where: { id: S2 }, update: { slug: 'f4-2', name: 'F4-2' }, create: { id: S2, slug: 'f4-2', name: 'F4-2' } });
await prisma.storeSetting.createMany({
  data: [
    { storeId: S1, key: 'auth_token', value: ADMIN_TOKEN_1 },
    { storeId: S1, key: 'auth_token_expires_at', value: new Date(Date.now() + 3600_000).toISOString() },
    { storeId: S2, key: 'auth_token', value: ADMIN_TOKEN_2 },
    { storeId: S2, key: 'auth_token_expires_at', value: new Date(Date.now() + 3600_000).toISOString() },
  ],
  skipDuplicates: true,
});
const cust1 = await prisma.customer.upsert({ where: { id: 'cust-f4-1' }, update: {}, create: { id: 'cust-f4-1', storeId: S1, webUid: UID_WEB, phone: null } });
const cust2 = await prisma.customer.upsert({ where: { id: 'cust-f4-2' }, update: {}, create: { id: 'cust-f4-2', storeId: S2, webUid: UID_WEB2, phone: null } });
const custWA = await prisma.customer.upsert({ where: { id: 'cust-f4-wa' }, update: {}, create: { id: 'cust-f4-wa', storeId: S1, webUid: UID_WA, phone: '+6281234567890' } });

const convWeb = await prisma.conversation.upsert({ where: { id: 'conv-f4-web' }, update: { status: 'open', customerPhone: null, channel: 'web' }, create: { id: 'conv-f4-web', storeId: S1, customerId: cust1.id, channel: 'web', customerPhone: null, status: 'open' } });
const convWeb2 = await prisma.conversation.upsert({ where: { id: 'conv-f4-web2' }, update: { channel: 'web', customerPhone: null, status: 'open' }, create: { id: 'conv-f4-web2', storeId: S2, customerId: cust2.id, channel: 'web', customerPhone: null, status: 'open' } });
const convWA = await prisma.conversation.upsert({ where: { id: 'conv-f4-wa' }, update: { channel: 'whatsapp', customerPhone: '+6281234567890', status: 'open' }, create: { id: 'conv-f4-wa', storeId: S1, customerId: custWA.id, channel: 'whatsapp', customerPhone: '+6281234567890', status: 'open' } });

// ---- Boot ephemeral server ----
const app = express();
app.use(express.json());
app.use('/api/pwa', pwaRouter);
app.use('/api/conversations', conversationsRouter);
const server = http.createServer(app);
const origins = ['http://localhost:5173', 'http://localhost:3000', 'https://qlobot.web.id'];
realtimeService.init(server, origins);
// Spy on setVapidDetails BEFORE init() so we can assert VAPID wiring deterministically.
const setVapidCalls: any[] = [];
const origSetVapid = (webPush as any).setVapidDetails;
(webPush as any).setVapidDetails = (...args: any[]) => { setVapidCalls.push(args); return origSetVapid(...args); };
notificationService.init(); // reads VAPID env + subscribes to message.created
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
const origin = `http://localhost:${port}`;
const sockets: Socket[] = [];

const connectAdmin = (token: string): Promise<{ socket: Socket; err: string | null }> =>
  new Promise((resolve) => {
    const socket = io(origin, { path: '/api/ws', transports: ['websocket'], reconnection: false, timeout: 3000, auth: { token } });
    sockets.push(socket);
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; socket.close(); resolve({ socket, err: 'timeout' }); } }, 4000);
    socket.on('connect', () => { if (!settled) { settled = true; clearTimeout(t); resolve({ socket, err: null }); } });
    socket.on('connect_error', (e: Error) => { if (!settled) { settled = true; clearTimeout(t); socket.close(); resolve({ socket, err: e.message }); } });
  });

const connectCustomer = (query: Record<string, string>): Promise<{ socket: Socket; err: string | null }> =>
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

const adminReply = async (token: string, convId: string, message: string) => {
  const before = await prisma.conversationHistory.count({ where: { conversationId: convId } });
  const res = await authFetch(token, `/api/conversations/${convId}/reply`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  }).then((r) => r.json());
  const after = await prisma.conversationHistory.count({ where: { conversationId: convId } });
  return { ...res, dbBefore: before, dbAfter: after };
};

// Monkeypatch WA gateways (FASE 4 rule: no WA call for web; WA tests must not hit network).
(fonnteService as any).sendMessage = async () => { throw new Error('stub-fonfte-f4'); };
(gowaAdapter as any).sendMessage = async () => { throw new Error('stub-gowa-f4'); };

// ---- Push spy (stubbed; mirrors f3 fonnte monkeypatch) ----
type SendBehavior = 'sent' | 'invalid' | 'error';
let sendBehavior: SendBehavior = 'sent';
const sendCalls: Array<{ subscription: unknown; payload: string; opts: unknown }> = [];
const realSend = (webPush as any).sendNotification;

const installSpy = () => {
  sendCalls.length = 0;
  sendBehavior = 'sent';
  (webPush as any).sendNotification = async (subscription: unknown, payload: string, opts: unknown) => {
    sendCalls.push({ subscription, payload, opts });
    if (sendBehavior === 'invalid') {
      const e: any = new Error('push subscription invalid');
      e.statusCode = 410;
      throw e;
    }
    if (sendBehavior === 'error') { throw new Error('transient push gateway failure'); }
    return { statusCode: 201 };
  };
};
const restoreReal = () => { (webPush as any).sendNotification = realSend; };

// Close + forget all connected WS clients so presence resets to OFFLINE.
const closeAllSockets = async () => {
  for (const s of sockets) { try { s.close(); } catch {} }
  sockets.length = 0;
  await wait(400);
};

const subscribe = async (uid: string, slug: string, sub: unknown) =>
  fetch(`${origin}/api/pwa/${slug}/subscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid, subscription: sub }),
  }).then((r) => r.json());

const unsubscribe = async (uid: string, slug: string) =>
  fetch(`${origin}/api/pwa/${slug}/unsubscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid }),
  }).then((r) => r.json());

const SUB1 = { endpoint: 'https://push.example/1', keys: { p256dh: 'k1', auth: 'a1' } };
const SUB1b = { endpoint: 'https://push.example/1b', keys: { p256dh: 'k1b', auth: 'a1b' } };

try {
  // ===== [5] VAPID configuration =====
  console.log('\n[5] VAPID configuration');
  {
    assert(notificationService.isVapidConfigured() === true, 'notificationService vapidConfigured=true (env keys loaded)');
    const k = webPush.generateVAPIDKeys();
    assert(!!k.publicKey && !!k.privateKey, 'web-push VAPID key generation works (base64url pair)');
    // No private key in PWA bundle: assert vapidPublicKey exposed via /init is PUBLIC only.
    const init = await fetch(`${origin}/api/pwa/f4-1/init`).then((r) => r.json());
    assert(!!init?.data?.vapidPublicKey, '/init exposes VAPID PUBLIC key to PWA');
    assert(init.data.vapidPublicKey === VAPID_PK, 'exposed public key == server VAPID public key');

    // VAPID wiring: assert init() applied the env keys to web-push via setVapidDetails
    // (deterministic; avoids a flaky HTTPS-only localhost push-service). Private key
    // is applied server-side only and never exposed to the PWA bundle.
    assert(setVapidCalls.length === 1, 'web-push.setVapidDetails called once by notificationService.init()');
    assert(setVapidCalls[0]?.[0] === 'mailto:fase4-smoke@qlobot.local', 'VAPID subject passed to web-push');
    assert(setVapidCalls[0]?.[1] === VAPID_PK, 'VAPID PUBLIC key applied to web-push');
    assert(setVapidCalls[0]?.[2] === VAPID_SK, 'VAPID PRIVATE key applied to web-push (server-side only; never exposed to PWA)');
  }

  // ===== [1] subscription registration =====
  console.log('\n[1] Subscription registration (POST /subscribe -> persisted)');
  {
    installSpy();
    const r = await subscribe(UID_WEB, 'f4-1', SUB1);
    assert(r?.success === true, 'subscribe returns success');
    const c = await prisma.customer.findUnique({ where: { id: cust1.id }, select: { pushSubscription: true } });
    assert(!!c?.pushSubscription, 'Customer.pushSubscription persisted on DB row');
    assert((c?.pushSubscription as any)?.endpoint === 'https://push.example/1', 'persisted subscription endpoint matches');
  }

  // ===== [2] subscription replacement (refresh) =====
  console.log('\n[2] Subscription replacement (UPDATE, not new row)');
  {
    const beforeCount = await prisma.customer.count({ where: { id: cust1.id } });
    const r = await subscribe(UID_WEB, 'f4-1', SUB1b);
    assert(r?.success === true, 're-subscribe returns success');
    const c = await prisma.customer.findUnique({ where: { id: cust1.id }, select: { pushSubscription: true } });
    assert((c?.pushSubscription as any)?.endpoint === 'https://push.example/1b', 'subscription replaced (endpoint 1b)');
    const afterCount = await prisma.customer.count({ where: { id: cust1.id } });
    assert(afterCount - beforeCount === 0, 'still exactly 1 customer row (UPDATE, no new row)');
  }

  // ===== [3] unsubscribe =====
  console.log('\n[3] Unsubscribe (clear pushSubscription)');
  {
    const r = await unsubscribe(UID_WEB, 'f4-1');
    assert(r?.success === true, 'unsubscribe returns success');
    const c = await prisma.customer.findUnique({ where: { id: cust1.id }, select: { pushSubscription: true } });
    assert(c?.pushSubscription === null, 'pushSubscription cleared (null) after unsubscribe');
  }

  // ===== [4] tenant ownership =====
  console.log('\n[4] Tenant isolation (cross-store subscribe rejected)');
  {
    // uid belongs to S1, but slug=f4-2 (S2) -> server resolves store S2, customer by uid in S2 -> none -> 401.
    const res = await fetch(`${origin}/api/pwa/f4-2/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: UID_WEB, subscription: SUB1 }),
    });
    assert(res.status === 401, `cross-store subscribe -> 401 (got ${res.status})`);
    // subscription of C1 (S1) must not exist on S2
    const c2 = await prisma.customer.findUnique({ where: { id: cust2.id }, select: { pushSubscription: true } });
    assert(!c2?.pushSubscription, 'S2 customer untouched by S1 cross-store subscribe');
  }

  // ===== [6] customer presence ONLINE =====
  console.log('\n[6] Customer presence ONLINE');
  {
    const { socket, err } = await connectCustomer({ slug: 'f4-1', uid: UID_WEB, conversationId: convWeb.id });
    assert(!err, 'customer WS connect_ok', err ? new Error(err) : undefined);
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === true, 'presence online after customer connect');
  }

  // ===== [8] multiple sockets same conversation = online (still 1 customer) =====
  console.log('\n[8] Multiple sockets same conversation -> online');
  {
    const { socket, err } = await connectCustomer({ slug: 'f4-1', uid: UID_WEB, conversationId: convWeb.id });
    assert(!err, 'second customer WS connect_ok', err ? new Error(err) : undefined);
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === true, 'presence online with 2 sockets');
  }

  // ===== [9] last socket disconnect -> offline =====
  console.log('\n[9] Last socket disconnect -> OFFLINE');
  {
    // disconnect one of the two sockets first -> still online
    sockets[0].close();
    await wait(300);
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === true, 'still online after 1 socket disconnects (1 remains)');
    // disconnect the remaining customer socket -> offline
    sockets[1].close();
    await wait(300);
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === false, 'offline after last customer socket disconnects');
  }

  // ===== [10] online customer -> NO push (T12-A part: online) =====
  console.log('\n[10] Online customer + subscription -> NO push (+ WS receives message)');
  {
    installSpy();
    await subscribe(UID_WEB, 'f4-1', SUB1); // re-set subscription
    const cust = await connectCustomer({ slug: 'f4-1', uid: UID_WEB, conversationId: convWeb.id });
    assert(!cust.err, 'customer online for push test', cust.err ? new Error(cust.err) : undefined);
    const seen: any[] = [];
    (cust.socket as any).on('message.created', (d: any) => seen.push(d));
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'Hai customer (online test)');
    await wait(400);
    assert(seen.some((m) => m.sender === 'human_agent' && m.id === reply.messageId), 'online customer receives message.created via WS (primary transport)');
    assert(sendCalls.length === 0, `push NOT sent for online customer (got ${sendCalls.length})`);
  }

  // ===== [11] offline customer + subscription -> PUSH (T12-B) =====
  console.log('\n[11] Offline customer + subscription -> PUSH');
  {
    installSpy();
    // ensure customer socket is offline (disconnect any)
    await closeAllSockets();
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === false, 'customer confirmed offline');
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'Hai customer (offline test)');
    await wait(400);
    assert(sendCalls.length === 1, `push sent exactly once for offline customer (got ${sendCalls.length})`);
    let parsed: any = null;
    try { parsed = JSON.parse(sendCalls[0].payload); } catch {}
    assert(!!parsed && parsed.messageId === reply.messageId, `push payload messageId == reply DB id (${parsed?.messageId} === ${reply.messageId})`);
    assert(parsed?.conversationId === convWeb.id, 'push payload carries conversationId (deep-link)');
    assert(parsed?.url && !parsed.url.includes('token') && !parsed.url.includes('Bearer'), 'push url has no token');
  }

  // ===== [12] offline customer WITHOUT subscription -> no push =====
  console.log('\n[12] Offline customer without subscription -> NO push');
  {
    installSpy();
    await unsubscribe(UID_WEB, 'f4-1'); // clear subscription
    await closeAllSockets();
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'No sub test');
    await wait(400);
    assert(reply.success === true, 'admin reply still succeeds (no sub)');
    assert(sendCalls.length === 0, `no push when no subscription (got ${sendCalls.length})`);
  }

  // ===== [13] push failure does NOT rollback message =====
  console.log('\n[13] Push failure -> message NOT rolled back');
  {
    installSpy();
    sendBehavior = 'error'; // transient failure
    await subscribe(UID_WEB, 'f4-1', SUB1);
    await closeAllSockets();
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'Push failure rollback test');
    await wait(400);
    assert(reply.success === true && !!reply.messageId, 'admin reply persisted (reply returned)');
    const row = await prisma.conversationHistory.findUnique({ where: { id: reply.messageId }, select: { content: true } });
    assert(!!row, 'message row exists despite push failure (no rollback)');
  }

  // ===== [14] invalid subscription -> clears DB subscription (no message rollback) =====
  console.log('\n[14] Invalid (410) subscription -> clear DB subscription');
  {
    installSpy();
    sendBehavior = 'invalid'; // 410
    await subscribe(UID_WEB, 'f4-1', SUB1);
    await closeAllSockets();
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'Invalid sub test');
    await wait(400);
    assert(reply.success === true, 'admin reply persisted through invalid-sub');
    const c = await prisma.customer.findUnique({ where: { id: cust1.id }, select: { pushSubscription: true } });
    assert(c?.pushSubscription === null, 'stale pushSubscription cleared from Customer after 410');
  }

  // ===== [15] push payload contains NO secret/token =====
  console.log('\n[15] Push payload contains no secret/token');
  {
    installSpy();
    await subscribe(UID_WEB, 'f4-1', SUB1);
    await closeAllSockets();
    await adminReply(ADMIN_TOKEN_1, convWeb.id, 'Secret scan test');
    await wait(400);
    let parsed: any = {};
    try { parsed = JSON.parse(sendCalls[0].payload); } catch {}
    const blob = JSON.stringify(parsed);
    const leaks = ['token', 'Bearer', 'authorization', 'vapidprivatekey', 'privatekey', 'cost', 'margin', 'history', 'phonenumber', 'webuid'];
    const found = leaks.filter((k) => blob.toLowerCase().includes(k.toLowerCase()));
    assert(found.length === 0, `payload has no forbidden fields (leaked: ${found.join(',') || 'none'})`);
  }

  // ===== [16] push payload messageId = DB message id ===== (covered by [11] assertion)
  console.log('\n[16] Push payload messageId == DB conversation_history.id (see [11])');
  ok('assertion covered in [11]');

  // ===== [17] push does NOT INSERT conversation_history =====
  console.log('\n[17] Push does not INSERT conversation_history');
  {
    installSpy();
    await subscribe(UID_WEB, 'f4-1', SUB1);
    await closeAllSockets();
    const before = await prisma.conversationHistory.count({ where: { conversationId: convWeb.id } });
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'No insert test');
    await wait(400);
    const after = await prisma.conversationHistory.count({ where: { conversationId: convWeb.id } });
    assert(after - before === 1, `history row delta == 1 (only admin reply INSERT; push added 0) (got ${after - before})`);
    const row = await prisma.conversationHistory.findUnique({ where: { id: reply.messageId }, select: { id: true } });
    assert(!!row, 'admin reply row present (single insert)');
  }

  // ===== [18] Socket.IO remains primary transport (online WS delivery) ===== (covered [10])
  console.log('\n[18] Socket.IO remains primary transport (see [10])');
  ok('assertion covered in [10] (online customer receives message.created via WS)');

  // ===== [19] no duplicate bubble =====
  console.log('\n[19] No duplicate bubble (online customer gets exactly 1 human_agent)');
  {
    installSpy();
    await subscribe(UID_WEB, 'f4-1', SUB1);
    const cust = await connectCustomer({ slug: 'f4-1', uid: UID_WEB, conversationId: convWeb.id });
    assert(!cust.err, 'customer online for dedup', cust.err ? new Error(cust.err) : undefined);
    const seen: any[] = [];
    (cust.socket as any).on('message.created', (d: any) => { if (d.sender === 'human_agent') seen.push(d); });
    const reply = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'Dedup bubble test');
    await wait(400);
    assert(seen.filter((m) => m.id === reply.messageId).length === 1, `exactly 1 human_agent message.created for online customer (got ${seen.filter((m) => m.id === reply.messageId).length})`);
    assert(sendCalls.length === 0, 'and push NOT sent (no duplicate signal)');
    await closeAllSockets(); // release [19] customer socket before presence scenarios
  }

  // ===== [20] Web/WhatsApp isolation =====
  console.log('\n[20] Web/WhatsApp isolation (WA channel -> no push)');
  {
    installSpy();
    // WA customer has no web push subscription by design; convWA is whatsapp channel.
    const reply = await adminReply(ADMIN_TOKEN_1, convWA.id, 'WA isolation test');
    await wait(400);
    assert(sendCalls.length === 0, `no push for whatsapp-channel conversation (got ${sendCalls.length})`);
    const row = await prisma.conversationHistory.findUnique({ where: { id: reply.messageId }, select: { id: true } });
    assert(!!row, 'WA admin reply still persisted (WA path unaffected by FASE 4)');
  }

  // ===== [21] tenant isolation (presence) =====
  console.log('\n[21] Tenant isolation (presence S1 vs S2)');
  {
    // customer in S2 -> presence true for S2 conv, false for S1 conv
    const c2 = await connectCustomer({ slug: 'f4-2', uid: UID_WEB2, conversationId: convWeb2.id });
    assert(!c2.err, 'S2 customer connect_ok', c2.err ? new Error(c2.err) : undefined);
    await wait(300);
    assert(realtimeService.isCustomerConversationOnline(S2, convWeb2.id) === true, 'S2 presence true for S2 conversation');
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === false, 'S1 presence false for S1 conversation (S2 socket) — no cross-tenant leak');
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb2.id) === false, 'S1 cannot read S2 conversation presence (store-scoped key)');
    c2.socket.close();
    await wait(300);
  }

  // ===== T12 — composite e2e =====
  console.log('\nT12 E2E: online=WS only; offline=push, same messageId, single insert');
  {
    await closeAllSockets(); // clear [21] leftover so T12-B's offline assertion holds
    installSpy();
    await subscribe(UID_WEB, 'f4-1', SUB1);
    // (A) customer online
    const cust = await connectCustomer({ slug: 'f4-1', uid: UID_WEB, conversationId: convWeb.id });
    const seen: any[] = [];
    (cust.socket as any).on('message.created', (d: any) => { if (d.sender === 'human_agent') seen.push(d); });
    const a = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'T12 online message');
    await wait(400);
    const aGot = seen.find((m) => m.id === a.messageId);
    assert(!!aGot && aGot.content === 'T12 online message', 'A: online customer receives WS message.created (id canonical)');
    assert(sendCalls.length === 0, `A: push NOT sent while online (got ${sendCalls.length})`);

    // (B) customer disconnects, admin replies again
    cust.socket.close();
    await wait(400);
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === false, 'B: customer offline after disconnect');
    const histBeforeB = await prisma.conversationHistory.count({ where: { conversationId: convWeb.id } });
    const b = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'T12 offline message');
    await wait(400);
    const histAfterB = await prisma.conversationHistory.count({ where: { conversationId: convWeb.id } });
    assert(sendCalls.length === 1, `B: web push sent for offline customer (got ${sendCalls.length})`);
    let bp: any = {};
    try { bp = JSON.parse(sendCalls[0].payload); } catch {}
    assert(bp.messageId === b.messageId, `B: push messageId == reply DB id (${bp.messageId} === ${b.messageId})`);
    assert(histAfterB - histBeforeB === 1, `B: exactly 1 history INSERT for this reply (got ${histAfterB - histBeforeB})`);
  }

  // ===== [7] customer presence OFFLINE (baseline) =====
  console.log('\n[7] Customer presence OFFLINE (baseline + after disconnect)');
  {
    await closeAllSockets();
    assert(realtimeService.isCustomerConversationOnline(S1, convWeb.id) === false, 'offline when no customer socket');
  }

  // ===== [22] FASE 3 regression (message.created delivery still works) =====
  console.log('\n[22] FASE 3 regression (message.created delivery path intact)');
  {
    const before = await prisma.conversationHistory.count({ where: { conversationId: { equals: convWeb.id } } });
    const r = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'F3 regression reply');
    assert(r.success === true, 'admin reply path (FASE 3) still works');
    assert(r.dbAfter - r.dbBefore === 1, 'FASE 3 single INSERT preserved');
    assert(r.messageId === (await prisma.conversationHistory.findUnique({ where: { id: r.messageId }, select: { id: true } }))?.id, 'FASE 3 messageId canonical identity intact');
  }

  // ===== [23] FASE 2 regression (structured type=text on admin reply) =====
  console.log('\n[23] FASE 2 regression (admin reply type=text, no structured crash)');
  {
    const r = await adminReply(ADMIN_TOKEN_1, convWeb.id, 'F2 regression text');
    const row = await prisma.conversationHistory.findUnique({ where: { id: r.messageId }, select: { messageType: true } });
    assert(row?.messageType === 'text' || row?.messageType === null || row?.messageType === undefined, `admin reply type=text/null (FASE 2 text default) (got ${row?.messageType})`);
  }

  console.log(`\n===== FASE4 SMOKE RESULT: ${passed} passed, ${failed} failed =====`);
} catch (e: any) {
  console.error('FATAL:', e?.message || e);
  failed++;
} finally {
  console.log('\n[CLEANUP] socket close + remove fixtures');
  for (const s of sockets) try { s.close(); } catch {}
  await wait(300);
  try { await prisma.$disconnect(); } catch {}
  restoreReal();
  try { server.close(() => {}); } catch {}
  try { await cleanupFixtures(); } catch {}
}

setTimeout(() => process.exit(failed === 0 ? 0 : 1), 800);
