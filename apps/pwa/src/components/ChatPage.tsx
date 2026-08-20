import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import api, { createChatSocket } from '../services/api'
import type { Socket } from 'socket.io-client'
import ChatBubble from './ChatBubble'
import EmptyState, { type QuickActionType } from './EmptyState'
import Modal from './Modal'
import NotificationPrompt from './NotificationPrompt'
import MessageList from './MessageList'
import ProductDetailSheet from './ProductDetailSheet'
import CheckoutModal from './CheckoutModal'
import type { ChatMessage, ChatProduct, StructuredMessageType, ProductPayload } from '../types/chat'

type Store = {
  name?: string | null
  slug?: string | null
  profilePhotoUrl?: string | null
  description?: string | null
  businessCategory?: string | null
  operatingHours?: { summary?: string | null } | null
  isActive?: boolean | null
  acceptsTransfer?: boolean | null
  acceptsQris?: boolean | null
  acceptsCod?: boolean | null
}

type HistoryMsg = ChatMessage

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  if (parts.length === 0 || !parts[0]) return 'T'
  return parts.map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

// --- P-PWA.15: install-prompt state (localStorage, 7-day window) ---
const INSTALL_KEY = 'pwa_install_prompt'
const INSTALL_TTL_MS = 7 * 24 * 60 * 60 * 1000
interface InstallPromptState {
  dismissedAt?: number
  installed?: boolean
}
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
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
  const [isAdminTyping, setIsAdminTyping] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [conversationStatus, setConversationStatus] =
    useState<'open' | 'human_takeover' | 'resolved'>('open')
  const [products, setProducts] = useState<ChatProduct[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductPayload | null>(null)
  const inputDisabled = conversationStatus === 'resolved' || sending
  const inputRef = useRef<HTMLInputElement>(null)
  const renderedIds = useRef<Set<string>>(new Set())
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installBannerOpen, setInstallBannerOpen] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  // G2-F3: checkout modal state (alamat + metode bayar).
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(null)
  const [showBrowserChip, setShowBrowserChip] = useState(true)
  const [showPWAStatus, setShowPWAStatus] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const installTriggeredRef = useRef(false)

  // BUG 5: view state — 'storefront' shows EmptyState WITHOUT deleting messages.
  const [view, setView] = useState<'chat' | 'storefront'>('chat')
  // G2-E.3.2 §7/§8/§9: menu only keeps real, released actions (Hubungi Admin + Hapus Chat).
  const [modal, setModal] = useState<'confirm-delete' | null>(null)

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetDisplayMs = useRef<number>(0)
  const sendStartedAt = useRef<number>(0)

  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReadAck = useCallback(() => {
    if (!slug || !webUid || !conversationId) return
    if (readTimer.current) clearTimeout(readTimer.current)
    readTimer.current = setTimeout(() => {
      readTimer.current = null
      void api
        .post(`/pwa/${slug}/read`, { uid: webUid, conversationId })
        .catch(() => {})
    }, 1000)
  }, [slug, webUid, conversationId])

  const clearTypingTimer = () => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current)
      typingTimer.current = null
    }
  }

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2200)
  }

  useEffect(() => {
    if (!slug) return
    let uid = localStorage.getItem('garuda_pwa_uid')
    if (!uid) {
      uid = crypto.randomUUID()
      localStorage.setItem('garuda_pwa_uid', uid)
    }
    setWebUid(uid)
  }, [slug])

  useEffect(() => {
    if (!slug || !webUid) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const initRes = await api.get(`/pwa/${slug}/init`)
        if (!cancelled) setStore(initRes.data?.data?.store ?? null)
        if (!cancelled) setVapidPublicKey(initRes.data?.data?.vapidPublicKey ?? null)
        const histRes = await api.get(
          `/pwa/${slug}/history?uid=${encodeURIComponent(webUid)}`,
        )
        const histData = histRes.data?.data ?? {}
        const hist: HistoryMsg[] = histData.history ?? []
        if (!cancelled) {
          setMessages(hist)
          renderedIds.current = new Set(hist.map((m) => m.id).filter(Boolean) as string[])
          setConversationId(histData.conversationId ?? null)
        }

        api
          .get(`/pwa/${slug}/products?limit=20`)
          .then((r) => {
            if (!cancelled) {
              const prods: ChatProduct[] = r.data?.data?.products ?? []
              setProducts(prods)
            }
          })
          .catch(() => {
            if (!cancelled) setProducts([])
          })
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

  useEffect(() => {
    if (!slug || !webUid || !conversationId) return

    const socket: Socket = createChatSocket({ slug, uid: webUid, conversationId })

    socket.on('connect', () => {
      scheduleReadAck()
    })

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
      if (data.sender === 'customer') return
      if (data.sender !== 'assistant' && data.sender !== 'human_agent') return
      if (renderedIds.current.has(data.id)) return
      renderedIds.current.add(data.id)
      setMessages((m) => [...m, {
        id: data.id,
        role: data.sender === 'human_agent' ? 'agent' : 'assistant',
        content: data.content,
        source: data.source ?? null,
        type: (data.type ?? 'text') as StructuredMessageType,
        payload: data.payload ?? null,
        createdAt: data.createdAt,
      }])
      setIsAdminTyping(false)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      scheduleReadAck()
    })

    socket.on('conversation.handoff', () => setConversationStatus('human_takeover'))
    socket.on('conversation.resumed', () => setConversationStatus('open'))
    socket.on('conversation.resolved', () => {
      setConversationStatus('resolved')
      setIsAdminTyping(false)
    })
    socket.on('conversation.updated', (d: { lastMessageAt?: string | null; status?: string }) => {
      if (d?.status && (d.status === 'human_takeover' || d.status === 'open' || d.status === 'resolved')) {
        setConversationStatus(d.status)
      }
    })

    socket.on('typing.started', (d: { party?: string }) => {
      if (d?.party === 'human_agent') setIsAdminTyping(true)
    })
    socket.on('typing.stopped', (d: { party?: string }) => {
      if (d?.party === 'human_agent') setIsAdminTyping(false)
    })

    socket.on('connect_error', (err: Error & { message: string }) => {
      if (err?.message?.startsWith('unauthorized')) {
        // WS otorisasi ulang otomatis saat conversationId tersedia lagi.
      }
    })

    socket.io?.on('reconnect', () => {
      api.get(`/pwa/${slug}/history?uid=${encodeURIComponent(webUid)}`)
        .then((r) => {
          const hist: HistoryMsg[] = r.data?.data?.history ?? []
          const missing = hist.filter((m) => m.id && !renderedIds.current.has(m.id))
          missing.forEach((m) => { if (m.id) renderedIds.current.add(m.id) })
          if (missing.length) setMessages((prev) => [...prev, ...missing])
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          scheduleReadAck()
        })
        .catch(() => {})
    })

    return () => {
      socket.close()
    }
  }, [slug, webUid, conversationId, scheduleReadAck])

  const customerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportTyping = (typing: boolean) => {
    if (!slug || !webUid || !conversationId) return
    if (customerTypingTimer.current) clearTimeout(customerTypingTimer.current)
    customerTypingTimer.current = setTimeout(() => {
      customerTypingTimer.current = null
      api.post(`/pwa/${slug}/typing`, { uid: webUid, conversationId, typing })
        .catch(() => {})
    }, 300)
  }

  useEffect(() => clearTypingTimer, [])

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as unknown as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      markInstalled()
      setIsInstalled(true)
      setInstallBannerOpen(false)
      setShowBrowserChip(false)
      setShowPWAStatus(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const onSend = async (explicitText?: string) => {
    const text = (explicitText ?? input).trim()
    if (!text || sending || !webUid || !slug || inputDisabled) return
    setSending(true)
    setError(null)

    sendStartedAt.current = Date.now()
    targetDisplayMs.current = 700 + Math.floor(Math.random() * 600)
    clearTypingTimer()

    setIsTyping(true)

    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')

    try {
      const res = await api.post(`/pwa/${slug}/message`, {
        uid: webUid,
        message: text,
      })
      const body = res.data

      if (body?.conversationId && body.conversationId !== conversationId) {
        setConversationId(body.conversationId)
      }
      if (body?.messageId) {
        renderedIds.current.add(body.messageId)
      }

      const elapsed = Date.now() - sendStartedAt.current
      const delay = Math.max(targetDisplayMs.current - elapsed, 0)

      if (body?.status === 'pending_human') {
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
        if (!installTriggeredRef.current && isInstallBannerAllowed()) {
          installTriggeredRef.current = true
          setInstallBannerOpen(true)
        }

        if (delay <= 0) {
          clearTypingTimer()
          setIsTyping(false)
          setSending(false)
          reportTyping(false)
          setMessages((m) => [...m, { id: body.messageId, role: 'assistant', content: body.content, type: (body.type ?? 'text') as StructuredMessageType, payload: body.payload ?? null }])
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        } else {
          typingTimer.current = setTimeout(() => {
            clearTypingTimer()
            setIsTyping(false)
            setSending(false)
            reportTyping(false)
            setMessages((m) => [...m, { id: body.messageId, role: 'assistant', content: body.content, type: (body.type ?? 'text') as StructuredMessageType, payload: body.payload ?? null }])
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

  const handleQuickAction = (action: QuickActionType) => {
    if (action === 'chat') {
      setView('chat')
      inputRef.current?.focus()
    } else if (action === 'products') {
      showToast('Lihat semua produk di toko')
    } else if (action === 'search') {
      inputRef.current?.focus()
    }
  }

  // Append an assistant message (dipolar dengan WS message.created via renderedIds
  // agar tidak double-render ketika WS juga mengirim message.created yang sama).
  const appendAssistant = useCallback(
    (msg: {
      id?: string;
      type?: StructuredMessageType;
      content: string;
      payload?: unknown;
      source?: string | null;
      createdAt?: string;
    }) => {
      const id = msg.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setMessages((m) => [
        ...m,
        {
          id,
          role: 'assistant',
          type: msg.type,
          content: msg.content,
          payload: msg.payload,
          source: msg.source ?? null,
          createdAt: msg.createdAt ?? new Date().toISOString(),
        } as ChatMessage,
      ])
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
    [],
  )

  // P4-3: typed structured-action sender. Posts actionId+type+payload to
  // POST /pwa/:slug/action (NOT raw NL text to /message). Server resolves
  // identity and returns the authoritative result, which we render as a chat
  // bubble — no optimistic client computation (§5.5).
  const renderActionResult = useCallback((type: string, data: any) => {
    switch (type) {
      case 'ADD_TO_CART':
      case 'OPEN_CART': {
        const cart = (data?.result?.cart ?? data?.result) as any
        if (cart?.items) {
          appendAssistant({ type: 'cart', content: 'Isi keranjangmu:', payload: { items: cart.items, total: cart.total ?? null, orderId: cart.orderId } })
        }
        break
      }
      case 'OPEN_CATALOG':
      case 'SHOW_RELATED_PRODUCTS': {
        const items = (data?.result?.products ?? []) as any[]
        appendAssistant({ type: 'product_list', content: 'Daftar produk:', payload: { items } })
        break
      }
      case 'OPEN_ORDER_HISTORY': {
        const orders = (data?.result?.orders ?? []) as any[]
        appendAssistant({ type: 'order', content: 'Riwayat pesanan:', payload: { orders } })
        break
      }
      // CONTACT_ADMIN: the handoff reply is delivered via WebSocket
      // (message.created), so we intentionally do NOT append a local bubble.
      default:
        break
    }
  }, [appendAssistant])

  const sendAction = useCallback(
    async (type: string, payload?: Record<string, unknown>) => {
      if (sending || inputDisabled || !webUid || !slug) return
      setSending(true)
      setError(null)
      try {
        const res = await api.post(`/pwa/${slug}/action`, {
          uid: webUid,
          action: { actionId: crypto.randomUUID(), type, payload: payload ?? {} },
        })
        const body = res.data
        if (body?.success && body?.data) {
          renderActionResult(type, body.data)
        } else {
          setError(body?.error || 'Aksi gagal diproses')
        }
      } catch (e: any) {
        setError(e?.response?.data?.error || e?.message || 'Aksi gagal diproses')
      } finally {
        setSending(false)
      }
    },
    [sending, inputDisabled, webUid, slug, renderActionResult],
  )

  // G2-E.3.2 §10/§11/§12: "+ Keranjang" / "Tambah" → typed ADD_TO_CART action.
  const handleAddToCart = useCallback(
    (product: ProductPayload) => {
      if (!product.id || inputDisabled) return
      void sendAction('ADD_TO_CART', { productId: product.id, quantity: 1 })
    },
    [sendAction, inputDisabled],
  )

  // P4-3: "Produk Lain" → typed SHOW_RELATED_PRODUCTS action. The server returns
  // authoritative related products (same category, same store); rendered as a
  // product_list bubble — no local fabrication.
  const handleShowRelated = useCallback(
    (product: ProductPayload) => {
      if (!product.id || inputDisabled) return
      void sendAction('SHOW_RELATED_PRODUCTS', { productId: product.id })
    },
    [sendAction, inputDisabled],
  )

  // G2-E.3.2 §9: Hubungi Admin — POST /handoff (reuse engine escalation convention;
  // composeEscalateReply + human_takeover + eventBus — the same convention the
  // engine uses for auto-escalation). Real flow, not a fake admin.
  const handleContactAdmin = useCallback(async () => {
    if (!webUid || !slug) return
    try {
      const r = await api.post(`/pwa/${slug}/handoff`, {
        uid: webUid,
        conversationId: conversationId ?? undefined,
      })
      const body = r.data ?? {}
      if (body.conversationId && body.conversationId !== conversationId) {
        setConversationId(body.conversationId)
      }
      setConversationStatus('human_takeover')
      if (body?.message) {
        renderedIds.current.add(body.message.id)
        appendAssistant({
          id: body.message.id,
          type: (body.message.type ?? 'handoff') as StructuredMessageType,
          content: body.message.content,
          payload: body.message.payload ?? null,
        })
      }
      showToast('Pesan Anda diteruskan ke admin toko')
    } catch (e: any) {
      showToast(
        e?.response?.status === 401 ? 'Kirim pesan dulu untuk memulai obrolan' : 'Gagal menghubungkan ke admin',
      )
    }
  }, [slug, webUid, conversationId, appendAssistant])

  // G2-E.3.2 §7/§8: "Riwayat Pesanan" & "Bantuan" are NOT released PWA features —
  // hidden (no fake endpoints/data).
  // Hapus Chat — POST /clear (destructive, behind confirm modal).
  const handleClearChat = useCallback(async () => {
    if (!webUid || !slug) {
      setMessages([])
      setConversationId(null)
      setConversationStatus('open')
      setView('storefront')
      return
    }
    try {
      await api.post(`/pwa/${slug}/clear`, {
        uid: webUid,
        conversationId: conversationId ?? undefined,
      })
      setMessages([])
      setConversationId(null)
      setConversationStatus('open')
      setView('storefront')
      showToast('Riwayat chat berhasil dihapus')
    } catch {
      showToast('Gagal menghapus riwayat chat')
    }
  }, [slug, webUid, conversationId])

  const handleProductTap = useCallback((product: ProductPayload) => {
    setSelectedProduct(product)
  }, [])

  const handleQuickReply = (label: string) => {
    void onSend(label)
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        markInstalled()
        setIsInstalled(true)
        setInstallBannerOpen(false)
        setShowBrowserChip(false)
        setShowPWAStatus(true)
        setDeferredPrompt(null)
        showToast('Aplikasi terpasang di layar utama HP-mu')
      } else {
        markDismissed()
      }
    } catch {
      markDismissed()
    }
  }

  if (loading) {
    return (
      <main className="flex flex-col h-screen bg-background">
        <p className="text-muted-foreground p-4">Memuat…</p>
      </main>
    )
  }

  if (!store) {
    return (
      <main className="flex flex-col h-screen bg-background">
        <p className="text-foreground p-4">Toko tidak ditemukan</p>
      </main>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Browser chip — only visible pre-install */}
      {showBrowserChip && !isInstalled && (
        <div className="browserchip flex items-center gap-2 bg-muted mx-3 mb-2 px-3 py-2 rounded-xl text-xs text-muted-foreground font-medium flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          qlobot.web.id/c/{slug}
        </div>
      )}

      {/* PWA status badge */}
      {showPWAStatus && (
        <div className="flex-shrink-0 px-3 mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            ● APP
          </span>
        </div>
      )}

      {/* App header */}
      <header className="sticky top-0 z-30 bg-background flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
        {/* BUG 5: back to storefront WITHOUT deleting chat history (beda Hapus Chat) */}
        {view === 'chat' && (
          <button
            type="button"
            aria-label="Kembali ke toko"
            onClick={() => setView('storefront')}
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-primary hover:bg-muted transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <polyline points="4 12 9 17 20 6" />
            </svg>
          </button>
        )}
        <div className="relative flex-shrink-0">
          {/* §4: merchant avatar = store.profilePhotoUrl (authoritative). Fallback:
              generic gradient + initials (never a product/mock image). */}
          {store.profilePhotoUrl ? (
            <img
              src={store.profilePhotoUrl}
              alt={store.name || 'Merchant'}
              className="w-11 h-11 rounded-full object-cover border-2 border-background"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-white font-serif font-semibold text-base border-2 border-background"
              style={{ background: 'linear-gradient(160deg, #3a6e52, #1E3A2B)' }}
            >
              {getInitials(store.name || 'T')}
            </div>
          )}
          <div
            className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-background"
            style={{ background: 'var(--marigold)' }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#241505" strokeWidth="3">
              <polyline points="4 12 9 17 20 6" />
            </svg>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="font-serif font-semibold text-base text-primary truncate">{store.name || 'Toku'}</h2>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
            {/* §2: render only authoritative status data. operatingHours.summary is
                real; response-time ("Balas < 5 menit") & literal "Online" are NOT
                in the schema → hidden. */}
            {(store.operatingHours?.summary || (store.isActive && 'Aktif')) ? (
              <span className="text-[11px] text-muted-foreground font-medium">
                {store.operatingHours?.summary || 'Aktif'}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 relative">
          {/* §10/§12: no frontend cart badge. Tap → open chat + ask the backend
              authoritatively ("lihat keranjang" → engine → CartAuthority). */}
          <button
            type="button"
            onClick={() => { setView('chat'); void sendAction('OPEN_CART') }}
            className="w-9 h-9 rounded-full flex items-center justify-center text-primary hover:bg-muted transition-colors"
            aria-label="Keranjang"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-primary hover:bg-muted transition-colors"
            aria-label="Menu"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="12" cy="5" r="1.2" />
              <circle cx="12" cy="12" r="1.2" />
              <circle cx="12" cy="19" r="1.2" />
            </svg>
          </button>

          {/* Menu dropdown */}
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="menu-dropdown open absolute top-12 right-4 z-50 bg-white rounded-2xl shadow-xl border border-border p-1.5 w-52">
                {/* §9: Hubungi Admin — triggers the EXISTING escalation convention (/handoff). */}
                <div
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-foreground cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => { setMenuOpen(false); void handleContactAdmin() }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 11a9 9 0 0 1 18 0v5a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3h4M3 11v5a3 3 0 0 0 3 3h1a3 3 0 0 0 3-3v-2a3 3 0 0 0-3-3H3" />
                  </svg>
                  Hubungi Admin
                </div>
                <div className="h-px bg-border mx-1 my-1" />
                {/* Hapus Chat — destructive; shown behind confirm modal (history kept
                    until confirmed). Distinct from the back-button nav (§5/§6). */}
                <div
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold cursor-pointer hover:bg-red-50 transition-colors"
                  style={{ color: 'var(--clay)' }}
                  onClick={() => { setMenuOpen(false); setModal('confirm-delete') }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Hapus Chat
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Install banner */}
      {installBannerOpen && !isInstalled && (
        <div className="install-banner mx-3 mb-3 rounded-2xl p-3 flex items-center gap-3 flex-shrink-0" style={{ background: 'linear-gradient(120deg, #213E2D, #1E3A2B 60%)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--marigold)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#241505" strokeWidth="2.3">
              <path d="M12 3v13" />
              <polyline points="7 11 12 16 17 11" />
              <path d="M4 19h16" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-bold leading-tight">Pasang {store.name || 'Toko'} di layar utama HP-mu</p>
            <span className="text-white/70 text-[11px]">Buka lebih cepat, terasa seperti aplikasi asli</span>
          </div>
          <button
            onClick={handleInstall}
            className="flex-shrink-0 text-white text-xs font-bold px-4 py-2 rounded-full border-0 cursor-pointer"
            style={{ background: 'var(--marigold)', color: '#241505' }}
          >
            Install
          </button>
        </div>
      )}

      {/* Installed chip */}
      {isInstalled && (
        <div className="installed-chip">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
            <polyline points="4 12 9 17 20 6" />
          </svg>
          Terpasang sebagai aplikasi
        </div>
      )}

      {/* Notification prompt */}
      <NotificationPrompt
        slug={slug}
        uid={webUid}
        conversationId={conversationId}
        vapidPublicKey={vapidPublicKey}
      />

      {/* BUG 5: storefront view renders EmptyState WITHOUT clearing `messages`;
          chat view renders the MessageList (history preserved when going back). */}
      {view === 'storefront' ? (
        <EmptyState
          store={{ name: store.name, profilePhotoUrl: store.profilePhotoUrl, operatingHours: store.operatingHours, isActive: store.isActive }}
          products={products}
          onQuickAction={handleQuickAction}
          onProductTap={handleProductTap}
          onAddToCart={handleAddToCart}
        />
      ) : (
        <MessageList
          messages={messages}
          bottomRef={bottomRef}
          showEmptyState={true}
          store={{ name: store.name, profilePhotoUrl: store.profilePhotoUrl, operatingHours: store.operatingHours, isActive: store.isActive }}
          products={products}
          onQuickAction={handleQuickAction}
          onQuickReply={handleQuickReply}
          onProductTap={handleProductTap}
          onAddToCart={handleAddToCart}
          onShowRelated={handleShowRelated}
          onCheckout={setCheckoutOrderId}
          submitting={sending}
          trailing={
          <>
            {isTyping && <ChatBubble role="assistant" isTyping />}
            {isAdminTyping && (
              <div className="text-xs text-muted-foreground mb-1" aria-label="admin typing">
                Admin sedang mengetik…
              </div>
            )}
            {(conversationStatus === 'human_takeover' || conversationStatus === 'resolved') && (
              <div
                className={`text-xs px-3 py-1 rounded-md mb-1 ${
                  conversationStatus === 'resolved'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-amber-500/15 text-amber-800 border border-amber-200'
                }`}
                aria-label={conversationStatus === 'resolved' ? 'conversation resolved' : 'human takeover'}
              >
                {conversationStatus === 'resolved'
                  ? 'Percakapan telah diselesaikan oleh admin.'
                  : 'Pesan Anda diteruskan ke admin. Mohon tunggu.'}
              </div>
            )}
            {error && (
              <div className="text-destructive text-sm p-2">{error}</div>
            )}
          </>
        }
        />
      )}

      {/* G2-E.3.2 §7/§8: "Riwayat Pesanan" & "Bantuan" hidden (not released —
          no fake endpoints/data). Only the destructive Hapus Chat confirm remains. */}
      <Modal
        title="Hapus Chat?"
        open={modal === 'confirm-delete'}
        onClose={() => setModal(null)}
        actionLabel="Ya, Hapus"
        actionVariant="destructive"
        onAction={handleClearChat}
      >
        <p className="text-sm text-foreground/80">Riwayat obrolan ini akan dihapus secara permanen dan kembali ke tampilan toko.</p>
      </Modal>

      {/* G2-F3: checkout modal — alamat + pilih metode bayar (transfer/qris/cod). */}
      <CheckoutModal
        open={!!checkoutOrderId}
        onClose={() => setCheckoutOrderId(null)}
        storeSlug={slug!}
        uid={webUid}
        orderId={checkoutOrderId ?? ''}
        accepts={{
          transfer: !!store?.acceptsTransfer,
          qris: !!store?.acceptsQris,
          cod: !!store?.acceptsCod,
        }}
        onDone={(msg) => showToast(msg)}
      />

      <ProductDetailSheet
        productId={selectedProduct?.id ?? null}
        storeSlug={slug!}
        onClose={() => setSelectedProduct(null)}
      />

      {/* Composer — only in chat view; storefront view uses EmptyState "Tanya Toko" FAB */}
      {view === 'chat' && (
      <footer className="sticky bottom-0 bg-background border-t border-border flex-shrink-0">
        <div className="px-3 pt-2 pb-2">
          {/* Shortcut chips */}
          <div className="flex gap-2 overflow-x-auto chat-scroll pb-2 mb-1">
            <button
              type="button"
              onClick={() => void sendAction('OPEN_CATALOG')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-primary bg-muted hover:bg-muted/80 transition-colors"
            >
              📖 Katalog
            </button>
            <button
              type="button"
              onClick={() => void sendAction('OPEN_ORDER_HISTORY')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-primary bg-muted hover:bg-muted/80 transition-colors"
            >
              📦 Status Pesanan
            </button>
            <button
              type="button"
              onClick={() => void sendAction('CONTACT_ADMIN')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-primary bg-muted hover:bg-muted/80 transition-colors"
            >
              🎧 Hubungi CS
            </button>
          </div>

          {/* Input row */}
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              className="flex-1 min-w-0 border border-border bg-muted rounded-full px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground/70 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-all"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                reportTyping(e.target.value.length > 0)
              }}
              disabled={inputDisabled}
              placeholder={
                conversationStatus === 'resolved'
                  ? 'Percakapan telah selesai'
                  : conversationStatus === 'human_takeover'
                  ? 'Sedang ditangani oleh admin...'
                  : 'Ketik pesan…'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) onSend()
              }}
              aria-label="Pesan chat"
            />
            <button
              onClick={() => onSend()}
              disabled={inputDisabled || !input.trim()}
              className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:brightness-110 active:scale-95"
              style={{ background: 'var(--forest)' }}
              aria-label="Kirim"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-ink text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap" style={{ animation: 'fadeInUp .25s ease' }}>
          {toastMsg}
        </div>
      )}
    </div>
  )
}
