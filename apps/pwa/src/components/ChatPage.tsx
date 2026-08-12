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

  const onSend = async () => {
    if (!input.trim() || sending || !webUid || !slug) return
    setSending(true)
    setError(null)
    const text = input.trim()

    // Optimistic: tampilkan user bubble sebelum response balik
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')

    try {
      const res = await api.post(`/pwa/${slug}/message`, {
        uid: webUid,
        message: text,
      })
      const body = res.data
      if (body?.status === 'pending_human') {
        // human_takeover: teruskan ke admin, bukan error
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            content: 'Pesan diteruskan ke admin, mohon tunggu',
          },
        ])
      } else if (body?.success && body.content != null) {
        setMessages((m) => [...m, { role: 'assistant', content: body.content }])
      } else {
        setMessages((m) => [
          ...m,
          { role: 'system', content: 'Tidak ada balasan dari sistem' },
        ])
      }
    } catch (e: any) {
      // 429 mutex / network error -> tampilkan di area chat (bukan alert),
      // tombol kirim tetap bisa dipakai lagi
      if (e?.response?.status === 429) {
        setError('Sesi sedang sibuk, mohon kirim lagi.')
      } else {
        setError(e?.message ?? 'Gagal mengirim pesan')
      }
    } finally {
      setSending(false)
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
