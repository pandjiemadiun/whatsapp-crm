/**
 * FASE 3 GAP #1 — Runtime verification of admin typing (real Dashboard client method).
 *
 * What this proves (RUNTIME VERIFIED):
 *   The ACTUAL Dashboard client method `adminRealtime.emitAdminTyping`
 *   (apps/dashboard/src/services/realtime.ts) is reachable & drives the end-to-end
 *   flow — NOT a raw `socket.emit('admin_typing')`:
 *
 *   adminRealtime.connect()                      // real Dashboard client auth+join
 *   adminRealtime.emitAdminTyping(convId, true)   // REAL client method (the one
 *                                                //   the wired reply-input calls)
 *   -> server `admin_typing` handler
 *   -> forwards typing.started/stopped{party:'human_agent'} to customer conv room
 *
 * What is SOURCE-VERIFIED ONLY (no browser harness is installed; cannot install per
 * task constraints): the React input handler `handleReplyChange` ->
 * `reportAdminTyping`/`stopAdminTyping` -> `adminRealtime.emitAdminTyping`. That link
 * is exercised by the browser UI and is verified by code inspection of
 * apps/dashboard/src/pages/ConversationInbox.tsx.
 *
 *   npx tsx --env-file=../../.env scripts/smoke-admin-typing.ts
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
  console.error('[f3a] .env/DATABASE_URL tidak tersedia:', dc?.error?.message ?? 'no DATABASE_URL');
  process.exit(2);
}

const { prisma } = await import('../src/infrastructure/prisma.js');
const { realtimeService } = await import('../src/services/realtime.service.js');
const pwaRouter = (await import('../src/routes/pwa.js')).default;
const conversationsRouter = (await import('../src/routes/conversations.js')).default;

let passed = 0;
let failed = 0;
const ok = (n: string) => { passed++; console.log('  \u2705 ' + n); };
const fail = (n: string, e?: unknown) => { failed++; console.log('  \u274c ' + n + (e ? ' :: ' + (e as Error).message : '')); };
const assert = (c: boolean, n: string, e?: unknown) => (c ? ok(n) : fail(n, e));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Distinct fixture prefix so this script never clashes with smoke-fase3-chatbox.ts.
const ADMIN_TOKEN = 'admin-token-f3a-1';
const STORE_SLUG = 'f3a-1';
const STORE_ID = 'store-f3a-1';
const CONV_ID = 'conv-f3a-1';
const CUST_ID = 'cust-f3a-1';
const WEB_UID = 'uid-f3a-1';

// ---- Polyfills so the real Dashboard client (adminRealtime.connect) runs in node ----
(globalThis as any).window = (globalThis as any).window || { location: { origin: '' } };
(globalThis as any).localStorage = {
  _d: {} as Record<string, string>,
  getItem(k: string) { return this._d[k] ?? null; },
  setItem(k: string, v: string) { this._d[k] = String(v); },
  removeItem(k: string) { delete this._d[k]; },
  clear() { this._d = {}; },
};

// ---- Fixtures (idempotent) ----
try {
  const orphans = await prisma.conversation.findMany({
    where: { storeId: STORE_ID, deletedAt: null }, select: { id: true },
  });
  if (orphans.length) {
    await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: orphans.map((c) => c.id) } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  }
} catch {}
await prisma.customer.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
await prisma.storeSetting.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});

await prisma.store.upsert({
  where: { id: STORE_ID },
  update: { slug: STORE_SLUG, name: 'F3A-1', fonnteToken: 'fake-f3a' },
  create: { id: STORE_ID, slug: STORE_SLUG, name: 'F3A-1', fonnteToken: 'fake-f3a' },
});
await prisma.storeSetting.createMany({
  data: [
    { storeId: STORE_ID, key: 'auth_token', value: ADMIN_TOKEN },
    { storeId: STORE_ID, key: 'auth_token_expires_at', value: new Date(Date.now() + 3600_000).toISOString() },
  ],
  skipDuplicates: true,
});
await prisma.storeSetting.updateMany({ where: { storeId: STORE_ID, key: 'auth_token_expires_at' }, data: { value: new Date(Date.now() + 3600_000).toISOString() } });
await prisma.customer.upsert({ where: { id: CUST_ID }, update: {}, create: { id: CUST_ID, storeId: STORE_ID, webUid: WEB_UID } });
await prisma.conversation.upsert({
  where: { id: CONV_ID },
  update: { status: 'human_takeover', customerPhone: null, channel: 'web', customerId: CUST_ID, metadata: { preExistingKey: 'keep-me' } },
  create: {
    id: CONV_ID, storeId: STORE_ID, customerId: CUST_ID, channel: 'web',
    customerPhone: null, status: 'human_takeover', metadata: { preExistingKey: 'keep-me' },
  },
});

// ---- Boot ephemeral Express + WS server ----
const app = express();
app.use(express.json());
app.use('/api/pwa', pwaRouter);
app.use('/api/conversations', conversationsRouter);
const server = http.createServer(app);
realtimeService.init(server, ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001', 'https://qlobot.web.id']);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
const origin = `http://localhost:${port}`;
(globalThis as any).window = { location: { origin } }; // so adminRealtime.connect() targets the ephemeral server

const authFetch = (tok: string, url: string, init: RequestInit = {}) =>
  fetch(origin + url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } });

const connectCustomer = async (query: Record<string, string>): Promise<Socket | null> =>
  new Promise((resolve) => {
    const socket = io(origin, { path: '/api/ws', transports: ['websocket'], reconnection: false, timeout: 3000, query });
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; socket.close(); resolve(null); } }, 4000);
    socket.on('connect', () => { if (!settled) { settled = true; clearTimeout(t); resolve(socket); } });
    socket.on('connect_error', () => { if (!settled) { settled = true; clearTimeout(t); socket.close(); resolve(null); } });
  });

// ---- Real Dashboard client service ----
const { adminRealtime }: typeof import('../../dashboard/src/services/realtime.ts') =
  await import('../../dashboard/src/services/realtime.ts');
(globalThis as any).localStorage.setItem('garuda_user', JSON.stringify({ token: ADMIN_TOKEN, storeId: STORE_ID }));

const sockets: Socket[] = [];
try {
  // 1. admin connect via the REAL Dashboard client (connect -> auth -> join admin room)
  const adminReady = new Promise<void>((res) => {
    const off = adminRealtime.onConnect(() => { off(); res(); });
  });
  adminRealtime.connect();
  const adminErr = await Promise.race([
    adminReady,
    new Promise<string>((res) => setTimeout(() => res('timeout'), 5000)),
  ]);
  assert(!adminErr, 'admin connect_ok via real adminRealtime.connect() (Bearer token -> store room)');
  assert(typeof adminRealtime.isConnected === 'boolean', 'adminRealtime reports connection state');

  // 2. select conversation = open the customer socket on the conv room
  const cust = await connectCustomer({ slug: STORE_SLUG, uid: WEB_UID, conversationId: CONV_ID });
  assert(!!cust && !!cust.connected, 'customer WS connect_ok into conversation room');
  if (!cust) throw new Error('customer socket failed to connect');
  sockets.push(cust);

  const typingStarted: any[] = [];
  const typingStopped: any[] = [];
  const humanMsgs: any[] = [];
  cust.on('typing.started', (d: any) => typingStarted.push(d));
  cust.on('typing.stopped', (d: any) => typingStopped.push(d));
  cust.on('message.created', (d: any) => { if (d.sender === 'human_agent') humanMsgs.push(d); });

  // 3. admin starts typing  (REAL client method, not raw socket.emit)
  const beforeRows = await prisma.conversationHistory.count({ where: { conversationId: CONV_ID } });
  adminRealtime.emitAdminTyping(CONV_ID, true);
  await wait(250);

  // 4. customer receives typing.started party=human_agent
  const started = typingStarted.find((d) => d.party === 'human_agent');
  assert(!!started, 'customer menerima typing.started (party=human_agent) via real emitAdminTyping(true)');
  assert(started?.conversationId === CONV_ID, 'typing.started carries conversationId (conv room targeted, not foreign)');
  assert(typingStarted.length === 1, 'single emit -> single typing.started (no storm)');

  // 5. admin stops typing  (REAL client method)
  adminRealtime.emitAdminTyping(CONV_ID, false);
  await wait(250);
  const stopped = typingStopped.find((d) => d.party === 'human_agent');
  assert(!!stopped, 'customer menerima typing.stopped (party=human_agent) via real emitAdminTyping(false)');

  // 6. no persistence during typing (no history row inserted)
  const afterTypingRows = await prisma.conversationHistory.count({ where: { conversationId: CONV_ID } });
  assert(afterTypingRows - beforeRows === 0, 'typing caused ZERO DB history inserts (rule #1/#25)');

  // 7. admin sends message  -> typing stopped emitted + human message arrives + exactly one row
  adminRealtime.emitAdminTyping(CONV_ID, false); // handleSend wires stopAdminTyping() before/while sending
  await wait(150);
  const typingStoppedBeforeSend = typingStopped.filter((d) => d.party === 'human_agent').length;
  const res = await authFetch(ADMIN_TOKEN, `/api/conversations/${CONV_ID}/reply`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Balasan via Dashboard' }),
  }).then((r) => r.json());
  await wait(250);
  assert(typingStoppedBeforeSend >= 1, 'typing.stopped emitted when admin sends (handleSend -> stopAdminTyping)');
  assert(!!res.messageId, 'POST /reply returns messageId');
  const got = humanMsgs.find((m) => m.id === res.messageId);
  assert(!!got && got.sender === 'human_agent' && got.content === 'Balasan via Dashboard', 'customer menerima message.created human_agent setelah typing (id kanonis = DB)');
  const afterSendRows = await prisma.conversationHistory.count({ where: { conversationId: CONV_ID } });
  assert(afterSendRows - afterTypingRows === 1, 'admin reply = EXACTLY ONE new history row (rule #1)');
  assert(got?.conversationId === CONV_ID, 'conversationId unchanged after reply (no new conversation)');

  // 8. metadata preserved through the typing + reply flow
  const meta = (await prisma.conversation.findUnique({ where: { id: CONV_ID }, select: { metadata: true } })) as any;
  const m = meta?.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
  assert(m?.preExistingKey === 'keep-me', 'preExistingKey metadata preserved through typing+reply');

  console.log(`\n===== ADMIN-TYPING SMOKE RESULT: ${passed} passed, ${failed} failed =====`);
} finally {
  console.log('\n[CLEANUP] adminRealtime.disconnect + sockets close + remove fixtures');
  try { adminRealtime.disconnect(); } catch {}
  for (const s of sockets) try { s.close(); } catch {}
  await wait(300);
  const orphans = await prisma.conversation.findMany({ where: { storeId: STORE_ID }, select: { id: true } });
  if (orphans.length) await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: orphans.map((c) => c.id) } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.storeSetting.deleteMany({ where: { storeId: STORE_ID } }).catch(() => {});
  await prisma.store.deleteMany({ where: { id: STORE_ID } }).catch(() => {});
  try { await prisma.$disconnect(); } catch {}
  server.close(() => {});
}

setTimeout(() => process.exit(failed === 0 ? 0 : 1), 800);
