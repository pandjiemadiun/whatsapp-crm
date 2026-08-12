import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
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
}

export default function ChatPage() {
  const { slug } = useParams<{ slug: string }>()
  const [store, setStore] = useState<Store | null>(null)
  const [messages, setMessages] = useState<HistoryMsg[]>([])
  const [webUid, setWebUid] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)

  // P-PWA.14: timer + target untuk "delay natural".
  // - targetDisplayMs dihitung SEKALI saat pesan dikirim (700-1300ms).
  // - balasan ditampilkan pada max(targetDisplayMs, waktu response benar-benyra datang):
  //   AI cepat -> tetap tunggu sampai target; AI lambat -> tampilkan langsung,
  //   TIDAK pernah menambah delay di atas waktu respon asli.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetDisplayMs = useRef<number>(0)
  const sendStartedAt = useRef<number>(0)

  const clearTypingTimer = () => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current)
      typingTimer.current = null
    }
  }
  const bottomRef = useRef<HTMLDivElement>(null)

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
        if (!cancelled) setStore(initRes.data?.store ?? null)
        const histRes = await api.get(
          `/pwa/${slug}/history?uid=${encodeURIComponent(webUid)}`,
        )
        if (!cancelled) setMessages(histRes.data?.history ?? [])
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

  // 4. clear timer bila komponen unmount (hindari memory leak + setState pasca-unmount)
  useEffect(() => clearTypingTimer, [])

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
      const elapsed = Date.now() - sendStartedAt.current
      // 3. balasan muncul pada max(targetDisplayTime, waktu response datang) —
      //    tidak ada tambahan delay di ATAS target, tidak kurangi saat AI lambat.
      const delay = Math.max(targetDisplayMs.current - elapsed, 0)

      if (body?.status === 'pending_human') {
        // human_takeover: bukan balasan AI berjenjang -> tampilkan segera
        clearTypingTimer()
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            content: 'Pesan diteruskan ke admin, mohon tunggu',
          },
        ])
      } else if (body?.success && body.content != null) {
        // Balasan AI asli: tunggu sampai max(target, arrival).
        // AI lambat (elapsed >= target -> delay <= 0): tampilkan LANGSUNG, tak pakai timer.
        if (delay <= 0) {
          clearTypingTimer()
          setIsTyping(false)
          setSending(false)
          setMessages((m) => [...m, { role: 'assistant', content: body.content }])
        } else {
          typingTimer.current = setTimeout(() => {
            clearTypingTimer()
            setIsTyping(false)
            setSending(false)
            setMessages((m) => [...m, { role: 'assistant', content: body.content }])
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
        setError('Sesi sedang sibuk, mohon kirim lagi.')
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
          onChange={(e) => setInput(e.target.value)}
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
    </div>
  )
}
