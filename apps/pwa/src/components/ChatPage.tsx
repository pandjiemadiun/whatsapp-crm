import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import api, { createChatSocket } from '../services/api'
import type { Socket } from 'socket.io-client'
import ChatBubble from './ChatBubble'

type Store = {
  name?: string | null
  profilePhotoUrl?: string | null
}

type HistoryMsg = {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  source?: string | null
  /** FASE 2: structured type/payload (kanonis sama WS message.created + HTTP). */
  type?: string
  payload?: unknown
  createdAt?: string
}

// --- P-PWA.15: install-prompt state (localStorage, 7-day window) ---
// TIDAK boolean polos: { dismissedAt, installed }. Dalam 7 hari setelah dismiss,
// banner tidak muncul; sudah lewat 7 hari (atau belum pernah dismiss) → muncul lagi.
const INSTALL_KEY = 'pwa_install_prompt'
const INSTALL_TTL_MS = 7 * 24 * 60 * 60 * 1000
interface InstallPromptState {
  dismissedAt?: number
  installed?: boolean
}
// beforeinstallprompt tidak ada di lib.dom; Safari/iOS TIDAK memicu event ini.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}
function readInstallState(): InstallPromptState {
  try {
    const raw = localStorage.getItem(INSTALL_KEY)
    return raw ? (JSON.parse(raw) as InstallPromptState) : {}
  } catch {
    return {}
  }
}
function isInstallBannerAllowed(): boolean {
  const s = readInstallState()
  if (s.installed) return false
  if (s.dismissedAt && Date.now() - s.dismissedAt < INSTALL_TTL_MS) return false
  return true
}
function markDismissed() {
  const cur = readInstallState()
  localStorage.setItem(INSTALL_KEY, JSON.stringify({ ...cur, dismissedAt: Date.now() }))
}
function markInstalled() {
  const cur = readInstallState()
  localStorage.setItem(INSTALL_KEY, JSON.stringify({ ...cur, installed: true }))
}

export default function ChatPage() {
  const { slug } = useParams<{ slug: string }>()
  const [store, setStore] = useState<Store | null>(null)
  const [messages, setMessages] = useState<HistoryMsg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [webUid, setWebUid] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAdminTyping, setIsAdminTyping] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  // Dedup kunci utama: satu messageId → render sekali (HTTP + WS identik).
  const renderedIds = useRef<Set<string>>(new Set())
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installBannerOpen, setInstallBannerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const installTriggeredRef = useRef(false) // trigger banner sekali per sesi (setelah balasan AI pertama)

  // P-PWA.14: timer + target untuk "delay natural".
  // - targetDisplayMs dihitung SEKALI saat pesan dikirim (700-1300ms).
  // - balasan muncul pada max(targetDisplayTime, waktu response datang):
  //   AI cepat -> tunggu sampai target; AI lambat -> langsung, tak ada delay di atas arrival.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetDisplayMs = useRef<number>(0)
  const sendStartedAt = useRef<number>(0)

  const clearTypingTimer = () => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current)
      typingTimer.current = null
    }
  }

  // --- Identity (webUid) persisten di localStorage, satu per browser ---
  // crypto.randomUUID() bawaan browser; tidak perlu library ekstra.
  useEffect(() => {
    if (!slug) return
    let uid = localStorage.getItem('garuda_pwa_uid')
    if (!uid) {
      uid = crypto.randomUUID()
      localStorage.setItem('garuda_pwa_uid', uid)
    }
    setWebUid(uid)
  }, [slug])

  // --- Mount: init (identitas toko) lalu history percakapan ---
  useEffect(() => {
    if (!slug || !webUid) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const initRes = await api.get(`/pwa/${slug}/init`)
        // API envelope: { success:true, data:{ store } }. `store` ada DI `.data`,
        // BUKAN top-level; bila dibaca `.store` langsung selalu undefined ->
        // setStore(null) -> "Toko tidak ditemukan" meski API mengembalikan 200 + store.
        if (!cancelled) setStore(initRes.data?.data?.store ?? null)
        const histRes = await api.get(
          `/pwa/${slug}/history?uid=${encodeURIComponent(webUid)}`,
        )
        // envelope sama: { success:true, data:{ history, conversationId } } — baca di .data.
        const histData = histRes.data?.data ?? {}
        const hist: HistoryMsg[] = histData.history ?? []
        if (!cancelled) {
          setMessages(hist)
          // seed dedup set supaya WS event.created yang sama tidak double-render.
          renderedIds.current = new Set(hist.map((m) => m.id).filter(Boolean) as string[])
          setConversationId(histData.conversationId ?? null)
        }
      } catch (e: any) {
        if (!cancelled) {
          if (e?.response?.status === 404) setStore(null)
          else setError(e?.message ?? 'Gagal memuat data toko')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, webUid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // FASE 1 — Web realtime foundation.
  // Hubungkan WS HANYA bila sudah ada identitas lengkap (slug + webUid + conversationId).
  // server auth: query slug+uid+conversationId → store + customer + conversation ownership
  // (multi-tenant isolated, lihat realtime.service.ts authGuard).
  useEffect(() => {
    if (!slug || !webUid || !conversationId) return

    const socket: Socket = createChatSocket({ slug, uid: webUid, conversationId })

    socket.on('connect', () => {})

    // message.created: HTTP messageId = WS data.id (HARD RULE #3) → dedup.
    socket.on('message.created', (data: {
      id: string
      sender: string
      type?: string
      content: string
      source?: string
      confidence?: number | null
      createdAt?: string
      payload?: unknown
    }) => {
      // hanya proses balasan assistant yang masuk via WS (customer bubble via HTTP optimis)
      if (data.sender !== 'assistant') return
      if (renderedIds.current.has(data.id)) return // dedup HTTP+WS
      renderedIds.current.add(data.id)
      setMessages((m) => [...m, {
        id: data.id,
        role: 'assistant',
        content: data.content,
        source: data.source ?? null,
        type: data.type ?? 'text', // FASE 2: kanonis dari engine (default text)
        payload: data.payload ?? null,
        createdAt: data.createdAt,
      }])
      setIsAdminTyping(false)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })

    // admin/customer typing indicator (FASE 1 foundation)
    socket.on('typing.started', (d: { party?: string }) => {
      if (d?.party === 'human_agent') setIsAdminTyping(true)
    })
    socket.on('typing.stopped', (d: { party?: string }) => {
      if (d?.party === 'human_agent') setIsAdminTyping(false)
    })

    socket.on('connect_error', (err: Error & { message: string }) => {
      // unauthorized → WS mati; ChatPage tetap pakai HTTP/response.
      if (err?.message?.startsWith('unauthorized')) {
        // WS otorisasi ulang otomatis saat conversationId tersedia lagi.
      }
    })

    socket.io?.on('reconnect', () => {
      // history catch-up: ambil history, append missing (dedup by id)
      api.get(`/pwa/${slug}/history?uid=${encodeURIComponent(webUid)}`)
        .then((r) => {
          const hist: HistoryMsg[] = r.data?.data?.history ?? []
          const missing = hist.filter((m) => m.id && !renderedIds.current.has(m.id))
          missing.forEach((m) => { if (m.id) renderedIds.current.add(m.id) })
          if (missing.length) setMessages((prev) => [...prev, ...missing])
        })
        .catch(() => {})
    })

    return () => {
      socket.close()
    }
  }, [slug, webUid, conversationId])

  // FASE 1 — customer typing → POST /typing → EventBus → room admin (store:{storeId}:admin).
  // Throttle sisi client 1s; server juga throttle 1s.
  const customerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportTyping = (typing: boolean) => {
    if (!slug || !webUid || !conversationId) return
    if (customerTypingTimer.current) clearTimeout(customerTypingTimer.current)
    customerTypingTimer.current = setTimeout(() => {
      customerTypingTimer.current = null
      api.post(`/pwa/${slug}/typing`, { uid: webUid, conversationId, typing })
        .catch(() => {})
    }, 300) // debounce kirim
  }

  // 4. clear timer bila komponen unmount (hindari memory leak + setState pasca-unmount)
  useEffect(() => clearTypingTimer, [])


  // P-PWA.15: tangkap beforeinstallprompt (Chrome/Edge/Android) untuk banner
  // "Tambah ke Beranda". Safari/iOS TIDAK memicu event ini -> di situ banner menampilkan
  // instruksi manual; tidak pernah memaksa auto-prompt di Safari.
  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as unknown as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      markInstalled()
      setInstallBannerOpen(false)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const onSend = async () => {
    if (!input.trim() || sending || !webUid || !slug) return
    setSending(true)
    setError(null)
    const text = input.trim()

    // 2. target display duration (700-1300ms) — dihitung SEKALI saat kirim
    sendStartedAt.current = Date.now()
    targetDisplayMs.current = 700 + Math.floor(Math.random() * 600)
    clearTypingTimer()

    // 1. tampilkan "mengetik..." SEGERA setelah user kirim (optimistic)
    setIsTyping(true)

    // Optimistic: tampilkan user bubble sebelum response balik
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')

    try {
      const res = await api.post(`/pwa/${slug}/message`, {
        uid: webUid,
        message: text,
      })
      const body = res.data

      // Conversation ID baru saja dibuat (first message) → perbarui state & ikatan WS.
      if (body?.conversationId && body.conversationId !== conversationId) {
        setConversationId(body.conversationId)
      }
      // messageId = conversation_history.id (HARD RULE #3). Seed dedup supaya WS
      // 'message.created' dengan id yang sama tidak double-render.
      if (body?.messageId) {
        renderedIds.current.add(body.messageId)
      }

      const elapsed = Date.now() - sendStartedAt.current
      // 3. balasan muncul pada max(targetDisplayTime, waktu response datang).
      //    delay = target - elapsed (0 bila AI lebih lambat dari target).
      const delay = Math.max(targetDisplayMs.current - elapsed, 0)

      if (body?.status === 'pending_human') {
        // human_takeover: bukan balasan AI berjenjang -> tampilkan segera
        clearTypingTimer()
        setIsTyping(false)
        setSending(false)
        reportTyping(false)
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            content: 'Pesan diteruskan ke admin, mohon tunggu',
          },
        ])
      } else if (body?.success && body.content != null) {
        // P-PWA.15: trigger banner install SETELAH balasan AI pertama di sesi ini (sekali).
        // Safari/iOS (deferredPrompt null) -> banner nanti menampilkan instruksi manual.
        if (!installTriggeredRef.current && isInstallBannerAllowed()) {
          installTriggeredRef.current = true
          setInstallBannerOpen(true)
        }

        // Balasan AI asli: tunggu sampai max(target, arrival).
        // AI lambat (elapsed >= target -> delay <= 0): tampilkan LANGSUNG, tak pakai timer.
        if (delay <= 0) {
          clearTypingTimer()
          setIsTyping(false)
          setSending(false)
          reportTyping(false)
          setMessages((m) => [...m, { id: body.messageId, role: 'assistant', content: body.content, type: body.type ?? 'text', payload: body.payload ?? null }])
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        } else {
          typingTimer.current = setTimeout(() => {
            clearTypingTimer()
            setIsTyping(false)
            setSending(false)
            reportTyping(false)
            setMessages((m) => [...m, { id: body.messageId, role: 'assistant', content: body.content, type: body.type ?? 'text', payload: body.payload ?? null }])
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
            typingTimer.current = null
          }, delay)
        }
      } else {
        clearTypingTimer()
        setIsTyping(false)
        setSending(false)
        setMessages((m) => [
          ...m,
          { role: 'system', content: 'Tidak ada balasan dari sistem' },
        ])
      }
    } catch (e: any) {
      // 5. error (network / 429): tampilkan SECEARA LANGSUNG — jangan nunggu target
      clearTypingTimer()
      setIsTyping(false)
      setSending(false)
      if (e?.response?.status === 429) {
        setError('Sesi sedang sibanyak, mohon kirim lagi.')
      } else {
        setError(e?.message ?? 'Gagal mengirim pesan')
      }
    }
  }

  if (loading) {
    return (
      <main className="p-4 pb-16">
        <p className="text-gray-500">Memuat…</p>
      </main>
    )
  }

  // store null setelah load = toko tidak ditemukan (404 pada init)
  if (!store) {
    return (
      <main className="p-6">
        <p className="text-gray-700">Toko tidak ditemukan</p>
      </main>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* header: nama toko + logo */}
      <header className="p-3 border-b flex items-center gap-3">
        {store.profilePhotoUrl ? (
          <img
            src={store.profilePhotoUrl}
            alt={store.name || 'Toko'}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xs">
            Logo
          </div>
        )}
        <span className="font-medium">{store.name || 'Toku'}</span>
      </header>

      {/* area chat */}
      <main className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <ChatBubble role="assistant" text="Halo! Ada yang bisa dibantu?" />
        ) : (
          messages.map((m, i) => (
            <ChatBubble
              key={m.id || `msg-${i}`}
              role={m.role}
              text={m.content}
              source={m.source}
            />
          ))
        )}
        {isTyping && <ChatBubble role="assistant" isTyping />}
        {isAdminTyping && (
          <div className="text-xs text-gray-500 mb-1" aria-label="admin typing">
            Admin sedang mengetik…
          </div>
        )}
        {error && (
          <div className="text-red-600 text-sm p-2">{error}</div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* input + tombol kirim */}
      <footer className="p-3 border-t flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm outline-none"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            // customer typing → /typing → EventBus → room admin (store:{storeId}:admin)
            reportTyping(e.target.value.length > 0)
          }}
          disabled={sending}
          placeholder="Ketik pesan..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) onSend()
          }}
        />
        <button
          onClick={onSend}
          disabled={sending || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {sending ? 'Mengirim…' : 'Kirim'}
        </button>
      </footer>

      {/* P-PWA.15: banner pasang / instruksi Safari (setelah balasan AI pertama) */}
      {installBannerOpen && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-sm w-[90%]">
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3">
            <span className="text-sm text-gray-700 flex-1">
              {deferredPrompt
                ? 'Pasang QloBot di layar utama untuk akses cepat?'
                : 'Buka di browser, ketuk "Tambah ke Beranda" untuk akses cepat.'}
            </span>
            {deferredPrompt && (
              <button
                onClick={async () => {
                  try {
                    await deferredPrompt.prompt()
                    const choice = await deferredPrompt.userChoice
                    if (choice.outcome === 'accepted') {
                      markInstalled()
                      setInstallBannerOpen(false)
                      setDeferredPrompt(null)
                    } else {
                      markDismissed()
                    }
                  } catch {
                    markDismissed()
                  }
                }}
                className="text-xs font-medium text-blue-600 whitespace-nowrap"
              >
                Pasang
              </button>
            )}
            <button
              onClick={() => {
                markDismissed()
                setInstallBannerOpen(false)
              }}
              className="text-gray-400 hover:text-gray-700"
              aria-label="Tutup"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
