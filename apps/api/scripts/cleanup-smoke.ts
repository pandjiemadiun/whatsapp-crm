import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
const { prisma } = await import('../src/infrastructure/prisma.js')

const STORES = ['store-smoke-1', 'store-smoke-2', 'probe-store']
const WEBUIDS = ['uid-smoke-1', 'uid-smoke-2', 'uid-probe']

async function run() {
  // urutan FK (RESTRICT) : history -> conversation -> customer -> store
  const convs = await prisma.conversation.findMany({ where: { storeId: { in: STORES } }, select: { id: true } })
  const convIds = convs.map((c) => c.id)
  if (convIds.length) {
    try { await prisma.conversationHistory.deleteMany({ where: { conversationId: { in: convIds } } }) } catch {}
    try { await prisma.conversation.deleteMany({ where: { storeId: { in: STORES } } }) } catch {}
  }
  try { await prisma.customer.deleteMany({ where: { webUid: { in: WEBUIDS } } }) } catch {}
  try { await prisma.store.deleteMany({ where: { id: { in: STORES } } }) } catch {}

  const leftover = {
    stores: await prisma.store.findMany({ where: { id: { in: STORES } }, select: { id: true } }),
    custs: await prisma.customer.findMany({ where: { webUid: { in: WEBUIDS } }, select: { id: true, webUid: true } }),
    convs: await prisma.conversation.findMany({ where: { storeId: { in: STORES } }, select: { id: true } }),
  }
  console.log('leftover smoke rows:', JSON.stringify(leftover))
  await prisma.$disconnect()
  setTimeout(() => process.exit(leftover.stores.length + leftover.custs.length + leftover.convs.length === 0 ? 0 : 1), 300)
}
run().catch((e) => { console.error(e); process.exit(1) })
