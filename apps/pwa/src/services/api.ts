import axios from 'axios'
import { io, type Socket } from 'socket.io-client'

// PWA publik (no-auth). Base URL relatif '/api':
//  - dev  : diteruskan Vite proxy -> http://localhost:3000 (api pm2)
//  - prod : resolved same-origin dengan host yang melayani PWA (qlobot.web.id)
// TIDAK ada interceptor Authorization (beda apps/dashboard yang memakai Bearer token).
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

export default api

/**
 * FASE 1 — Web realtime foundation.
 * Socket.IO client untuk path yang SAMA dengan server (realtime.service: WS_PATH = '/api/ws').
 * `transports: ['websocket']` agar pakai WS bersih (bukan polling); reconnection otomatis
 * oleh socket.io-client (reconnect, exponential backoff). Server auth pakai query
 * (web: slug+uid+conversationId) — bukan Bearer (itu admin, FASE 3).
 */
export const WS_BASE_ORIGIN = import.meta.env.DEV ? 'http://localhost:3000' : '' // '' = same-origin
export const WS_TRANSPORT_PATH = '/api/ws'

// Server Socket.IO path '/api/ws' → client path option '/api/ws' (engine.io di bawah path ini).
export const createChatSocket = (query: Record<string, string | number>): Socket => {
  return io(WS_BASE_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : ''), {
    path: WS_TRANSPORT_PATH,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    query,
  })
}
