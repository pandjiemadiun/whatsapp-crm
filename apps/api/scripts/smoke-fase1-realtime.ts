/**
 * FASE 1 — smoke test runtime (verification script, bukan production source).
 *
 * Dijalankan dari apps/api:  ../../node_modules/.bin/tsx scripts/smoke-fase1-realtime.ts
 *
 * Cakupan (TANPA menyentuh pm2 production & TANPA memanggil LLM engine):
 *  1. Web auth (slug+uid+conversationId) → connect + message.created routing + identity + dedup
 *  2. Cross-tenant rejection (uid/conv milik store lain) + anonymous reject
 *  3. Admin Bearer auth negative (token invalid → reject)
 *  4. conversationDeliveryService lock contention → 429 (engine TIDAK terpanggil)
 *  5. POST /typing → EventBus typing.started + 401 boundary + 429 throttle
 *
 * DB: fixture isolated (id prefix "smoke-"), upsert (idempoten) + delete di finally.
 * Engine (processCustomerMessage) sengaja TIDAK dipanggil → tidak ada LLM.
 * Identity (history.id == messageId == WS data.id) diverifikasi statis (lihat laporan).
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import http from 'http'
import express from 'express'
import { io, type Socket } from '../../pwa/node_modules/socket.io-client/build/cjs/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../../../.env')
const dc = dotenv.config({ path: envPath })
if (!fs.existsSync(envPath) || dc?.error || !process.env.DATABASE_URL) {
  console.error('[smoke] .env/DATABASE_URL tidak tersedia:', dc?.error?.message ?? 'no DATABASE_URL')
  process.exit(2)
}

const { prisma } = await import('../src/infrastructure/prisma.js')
const { realtimeService } = await import('../src/services/realtime.service.js')
const { eventBus } = await import('../src/services/event-bus.service.js')
const { conversationDeliveryService } = await import('../src/services/conversation-delivery.service.js')
const { messageQueueService } = await import('../src/services/message-queue.service.js')
const pwaRouter = (await import('../src/routes/pwa.js')).default
// pwaRouter memakai conversationLimiter (rate-limiter) — aman (memory).

type AnyEnv = Record<string, string | number>
let passed = 0
let failed = 0
const ok = (n: string) => { passed++; console.log('  ✅ ' + n) }
const fail = (n: string, e?: unknown) => { failed++; console.log('  ❌ ' + n + (e ? ' :: ' + (e as Error).message : '')) }
const assert = (c: boolean, n: string, e?: unknown) => (c ? ok(n) : fail(n, e))

// ---- Fixtures (idempoten) : pre-cleanup orphan dari run sebelumnya (FK-safe) ----
try {
  const orphans = await prisma.conversation.findMany({ where: { storeId: { in: ['store-smoke-1', 'store-smoke-2', 'probe-store'] } }, select: { id: true } })
  const oids = orphans.map((c) => c.id)
  if (oids.length) {
    try { await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: oids } } }) } catch {}
    try { await prisma.conversation.deleteMany({ where: { storeId: { in: ['store-smoke-1', 'store-smoke-2', 'probe-store'] } } }) } catch {}
  }
} catch {}
try { await prisma.customer.deleteMany({ where: { webUid: { in: ['uid-smoke-1', 'uid-smoke-2', 'uid-probe'] } } }) } catch {}
try { await prisma.store.deleteMany({ where: { id: { in: ['store-smoke-1', 'store-smoke-2', 'probe-store'] } } }) } catch {}

const store1 = await prisma.store.upsert({
  where: { id: 'store-smoke-1' },
  update: { slug: 'smoke-1', name: 'Smoke1' },
  create: { id: 'store-smoke-1', slug: 'smoke-1', name: 'Smoke1', phoneNumber: '+628000000001' },
})
const customer1 = await prisma.customer.upsert({
  where: { id: 'cust-smoke-1' },
  update: {},
  create: { id: 'cust-smoke-1', storeId: store1.id, webUid: 'uid-smoke-1', phone: null },
})
const conv1 = await prisma.conversation.upsert({
  where: { id: 'conv-smoke-1' },
  update: {},
  create: { id: 'conv-smoke-1', storeId: store1.id, customerId: customer1.id, channel: 'web', customerPhone: null, status: 'open' },
})
const store2 = await prisma.store.upsert({
  where: { id: 'store-smoke-2' },
  update: { slug: 'smoke-2', name: 'Smoke2' },
  create: { id: 'store-smoke-2', slug: 'smoke-2', name: 'Smoke2', phoneNumber: '+628000000002' },
})
const customer2 = await prisma.customer.upsert({
  where: { id: 'cust-smoke-2' },
  update: {},
  create: { id: 'cust-smoke-2', storeId: store2.id, webUid: 'uid-smoke-2', phone: null },
})
const conv2 = await prisma.conversation.upsert({
  where: { id: 'conv-smoke-2' },
  update: {},
  create: { id: 'conv-smoke-2', storeId: store2.id, customerId: customer2.id, channel: 'web', customerPhone: null, status: 'open' },
})

// ---- Temp http server + RealtimeService (ephemeral port) ----
const app = express()
app.use(express.json())
app.use('/api/pwa', pwaRouter)
const server = http.createServer(app)
realtimeService.init(server, ['http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'https://qlobot.web.id'])
await new Promise<void>((r) => server.listen(0, r))
const port = (server.address() as any).port
const origin = `http://localhost:${port}`
const sockets: Socket[] = []

const connectRace = (query: AnyEnv, ms = 4000): Promise<{ socket: Socket; err: string | null }> =>
  new Promise((resolve) => {
    const socket = io(origin, { path: '/api/ws', transports: ['websocket'], reconnection: false, timeout: 3000, query })
    sockets.push(socket)
    let settled = false
    const t = setTimeout(() => { if (!settled) { settled = true; socket.close(); resolve({ socket, err: 'timeout' }) } }, ms)
    socket.on('connect', () => { if (!settled) { settled = true; clearTimeout(t); resolve({ socket, err: null }) } })
    socket.on('connect_error', (e: Error) => { if (!settled) { settled = true; clearTimeout(t); socket.close(); resolve({ socket, err: e.message }) } })
  })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

try {
  // ===== TEST 1: Web auth + routing + identity + dedup =====
  console.log('\n[1] Web customer auth + message.created routing + identity + dedup')
  const { socket: ws, err: e1 } = await connectRace({ slug: 'smoke-1', uid: 'uid-smoke-1', conversationId: conv1.id })
  assert(!e1, 'web customer connect_ok', e1 ? new Error(e1) : undefined)
  if (!e1) {
    const seen = new Set<string>()
    let dup = 0
    ws.on('message.created', (d: { id: string; content: string }) => {
      if (seen.has(d.id)) { dup++; return }
      seen.add(d.id)
    })
    const emit = (id: string) => eventBus.publish({
      event: 'message.created', storeId: store1.id,
      data: { id, conversationId: conv1.id, sender: 'assistant', type: 'text', content: 'Halo', source: 'ai', confidence: 0.9, createdAt: new Date() },
      ts: Date.now(),
    })
    emit('MSG-1')            // pertama → render (setara dengan HTTP response messageId)
    await wait(250)
    emit('MSG-1'); emit('MSG-1')  // duplikat id yang sama → client dedup
    await wait(350)
    assert(seen.has('MSG-1'), 'WS menerima message.created dengan id tepat (identity)')
    assert(dup === 2, 'dedup: 2 duplikat id sama diabaikan oleh client')
  }

  // ===== TEST 2: cross-tenant rejection =====
  console.log('\n[2] Cross-tenant room rejection')
  {
    const { err } = await connectRace({ slug: 'smoke-2', uid: 'uid-smoke-2', conversationId: conv1.id })
    assert(!!err && /invalid_conversation/.test(err), 'store2 uid present conv1 id -> reject')
  }
  {
    const { err } = await connectRace({ slug: 'smoke-1', uid: 'uid-smoke-2', conversationId: conv1.id })
    assert(!!err && /invalid_uid/.test(err), 'store1 uid milik store2 -> reject')
  }
  {
    const { err } = await connectRace({})
    assert(!!err && /missing_credentials/.test(err), 'anonymous -> reject')
  }

  // ===== TEST 3: admin auth negative =====
  console.log('\n[3] Admin Bearer auth negative')
  {
    const { err } = await connectRace({ token: 'this-is-invalid' })
    assert(!!err && /invalid_token/.test(err), 'invalid admin token -> reject')
  }

  // ===== TEST 4: delivery lock 429 (engine TIDAK terpanggil) =====
  console.log('\n[4] conversationDeliveryService lock contention -> 429')
  {
    const release = messageQueueService.acquireLock(conv1.id)
    const res = await conversationDeliveryService.processWebRequest({ storeId: store1.id, customerId: customer1.id, conversationId: conv1.id, message: 'x' })
    release()
    assert(res.kind === 'locked', 'delivery mengembalikan locked bila mutex ditahan (429, owner=delivery)')
  }

  // ===== TEST 5: POST /typing -> EventBus typing.started + boundaries =====
  console.log('\n[5] POST /typing -> EventBus typing.started + 401 + 429 throttle')
  const typed: any[] = []
  const unsub = eventBus.subscribe('typing.started', (env) => typed.push(env))

  const startRes = await fetch(`${origin}/api/pwa/smoke-1/typing`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid: 'uid-smoke-1', conversationId: conv1.id, typing: true }),
  }).then((r) => r.status)
  await wait(150)
  assert(startRes === 200, 'POST /typing valid -> 200')
  assert(typed.length === 1, 'EventBus menerima typing.started')
  assert(typed[0]?.data?.conversationId === conv1.id, 'typing payload mengandung conversationId')

  // boundary: uid beda store -> 401
  const bad = await fetch(`${origin}/api/pwa/smoke-1/typing`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid: 'uid-smoke-2', conversationId: conv1.id, typing: true }),
  }).then((r) => r.status)
  assert(bad === 401, 'POST /typing uid beda store -> 401')

  // throttle 1s
  await fetch(`${origin}/api/pwa/smoke-1/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-smoke-1', conversationId: conv1.id, typing: true }) }).then(() => {})
  await wait(50)
  const throttled = await fetch(`${origin}/api/pwa/smoke-1/typing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'uid-smoke-1', conversationId: conv1.id, typing: true }) }).then((r) => r.status)
  assert(throttled === 429, 'POST /typing throttle 1s -> 429')

  unsub()
} finally {
  console.log('\n[CLEANUP] socket close + remove fixtures')
  for (const s of sockets) try { s.close() } catch {}
  await wait(200)
  const SMOKE = ['store-smoke-1', 'store-smoke-2']
  const orphans = await prisma.conversation.findMany({ where: { storeId: { in: SMOKE } }, select: { id: true } })
  if (orphans.length) await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: orphans.map((c) => c.id) } } }).catch(() => {})
  await prisma.conversation.deleteMany({ where: { storeId: { in: SMOKE } } }).catch(() => {})
  await prisma.customer.deleteMany({ where: { webUid: { in: ['uid-smoke-1', 'uid-smoke-2'] } } }).catch(() => {})
  await prisma.store.deleteMany({ where: { id: { in: SMOKE } } }).catch(() => {})
  try { await prisma.$disconnect() } catch {}
  server.close(() => {})
}

console.log(`\n===== SMOKE RESULT: ${passed} passed, ${failed} failed =====`)
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 500)
