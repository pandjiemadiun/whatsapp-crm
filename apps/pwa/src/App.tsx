import { useEffect, useState } from 'react'
import api from './services/api'

// PWA scaffold (P-PWA.11) — HANYA bukti koneksi, BUKAN UI final.
// Fetch GET /api/pwa/:slug/init lewat proxy Vite (dev) / same-origin (prod),
// render raw JSON. App publik & no-auth → api.ts TANPA interceptor Authorization
// (beda dengan apps/dashboard yang memakai Bearer token).
const STORE_SLUG = 'pwa11-e2e-test'

function App() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // baseURL='/api' → request menjadi /api/pwa/:slug/init
    api
      .get(`/pwa/${STORE_SLUG}/init`)
      .then((res) => {
        setData(res.data)
        setError(null)
      })
      .catch((e: any) => {
        setError(
          e?.response?.data ? JSON.stringify(e.response.data) : e?.message,
        )
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold mb-4">PWA scaffold (P-PWA.11)</h1>
      {loading && <p>Loading…</p>}
      {error && (
        <pre className="bg-red-50 text-red-700 p-3 rounded text-xs">{error}</pre>
      )}
      {data && (
        <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </main>
  )
}

export default App
