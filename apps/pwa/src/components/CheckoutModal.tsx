import { useEffect, useState } from 'react'
import api from '../services/api'
import type { PaymentInfo } from '../types/chat'

interface CheckoutModalProps {
  open: boolean
  onClose: () => void
  storeSlug: string
  uid: string | null
  orderId: string
  /** Store-accepted methods (dari Store.accepts*). JANGAN hardcode. */
  accepts: { transfer: boolean; qris: boolean; cod: boolean }
  onDone: (msg: string) => void
}

type Step = 'form' | 'proof' | 'done'

/**
 * PWA checkout flow (G2-F3):
 *  - form: alamat + pilih metode bayar (transfer/qris/cod sesuai Store.accepts*)
 *  - cod: SELESAI (tetap waiting_address, TIDAK ada payment-report)
 *  - transfer/qris: setelah checkout, tampilkan rekening/QRIS + upload bukti
 *    -> panggil payment-report (endpoint terpisah)
 */
export default function CheckoutModal({
  open,
  onClose,
  storeSlug,
  uid,
  orderId,
  accepts,
  onDone,
}: CheckoutModalProps) {
  const [address, setAddress] = useState('')
  const [method, setMethod] = useState<'transfer' | 'qris' | 'cod' | null>(null)
  const [step, setStep] = useState<Step>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [proofUrl, setProofUrl] = useState<string | null>(null)

  // Reset state tiap kali modal dibuka.
  useEffect(() => {
    if (open) {
      setAddress('')
      setMethod(null)
      setStep('form')
      setError(null)
      setLoading(false)
      setPaymentInfo(null)
      setFile(null)
      setProofUrl(null)
    }
  }, [open])

  if (!open) return null

  const availableMethods: Array<{ key: 'transfer' | 'qris' | 'cod'; label: string }> = []
  if (accepts.transfer) availableMethods.push({ key: 'transfer', label: 'Transfer Bank' })
  if (accepts.qris) availableMethods.push({ key: 'qris', label: 'QRIS' })
  if (accepts.cod) availableMethods.push({ key: 'cod', label: 'Bayar di Tempat (COD)' })

  const submitCheckout = async () => {
    if (!uid) return setError('Sesi pelanggan tidak valid')
    if (!address.trim()) return setError('Alamat pengiriman wajib diisi')
    if (!method) return setError('Pilih metode pembayaran')
    setLoading(true)
    setError(null)
    try {
      const res = await api.post(`/pwa/${storeSlug}/checkout`, {
        uid,
        orderId,
        address: address.trim(),
        paymentMethod: method,
      })
      const body = res.data
      if (!body?.success) throw new Error(body?.error || 'Checkout gagal')
      if (method === 'cod') {
        setStep('done')
        onDone('Pesanan diterima, akan diproses')
        return
      }
      // transfer/qris -> ambil info pembayaran untuk tampilan rekening/QRIS
      const infoRes = await api.get(`/pwa/${storeSlug}/payment-info`)
      setPaymentInfo(infoRes.data?.data ?? null)
      setStep('proof')
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Checkout gagal')
    } finally {
      setLoading(false)
    }
  }

  const uploadProof = async (): Promise<string | null> => {
    if (!file) return null
    const form = new FormData()
    form.append('proof', file)
    const res = await api.post(`/pwa/${storeSlug}/payment-proof-upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data?.data?.url ?? null
  }

  const submitProof = async () => {
    if (!uid || !method) return setError('Data pembayaran tidak lengkap')
    setLoading(true)
    setError(null)
    try {
      const url = await uploadProof()
      if (!url) throw new Error('Gagal upload bukti pembayaran')
      setProofUrl(url)
      const res = await api.post(`/pwa/${storeSlug}/payment-report`, {
        uid,
        orderId,
        paymentMethod: method,
        proofUrl: url,
      })
      if (!res.data?.success) throw new Error(res.data?.error || 'Lapor bukti gagal')
      setStep('done')
      onDone('Bukti pembayaran diterima, menunggu konfirmasi admin')
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Lapor bukti gagal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-serif font-semibold text-base text-primary">Checkout Pesanan</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          {error && (
            <div className="text-destructive text-sm p-2 mb-3 bg-red-50 rounded-md">{error}</div>
          )}

          {step === 'form' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Alamat Pengiriman</label>
                <textarea
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-ring"
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Nama penerima, alamat lengkap, patokan..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Metode Pembayaran</label>
                {availableMethods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Toko belum mengaktifkan metode pembayaran.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {availableMethods.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setMethod(m.key)}
                        className={`text-left px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                          method === m.key
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={loading || availableMethods.length === 0}
                onClick={submitCheckout}
                className="w-full rounded-full py-3 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--forest)' }}
              >
                {loading ? 'Memproses...' : 'Lanjutkan'}
              </button>
            </div>
          )}

          {step === 'proof' && method && paymentInfo && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-foreground/80">
                Silakan transfer sesuai metode <b>{method === 'qris' ? 'QRIS' : 'transfer bank'}</b> di bawah,
                lalu unggah bukti pembayaran.
              </p>

              {method === 'qris' && paymentInfo.qrisImageUrl && (
                <div className="flex flex-col items-center gap-2">
                  <img src={paymentInfo.qrisImageUrl} alt="QRIS" className="w-48 h-48 object-contain border border-border rounded-xl" />
                  <span className="text-xs text-muted-foreground">Scan QRIS di aplikasi e-wallet/mbanking</span>
                </div>
              )}

              {method === 'transfer' && paymentInfo.bankAccounts.length > 0 && (
                <div className="flex flex-col gap-2">
                  {paymentInfo.bankAccounts.map((b, i) => (
                    <div key={i} className="rounded-xl border border-border p-3">
                      <div className="text-sm font-bold">{b.bankName}</div>
                      <div className="text-sm">{b.accountNumber} a.n. {b.accountName}</div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold mb-1">Upload Bukti Pembayaran</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm"
                />
                {proofUrl && <span className="text-xs text-success">Bukti terunggah ✓</span>}
              </div>

              <button
                type="button"
                disabled={loading || !file}
                onClick={submitProof}
                className="w-full rounded-full py-3 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--forest)' }}
              >
                {loading ? 'Mengirim...' : 'Kirim Bukti Pembayaran'}
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center text-success">
                ✓
              </div>
              <p className="text-sm font-semibold text-center">
                {method === 'cod'
                  ? 'Pesanan diterima, akan diproses.'
                  : 'Bukti pembayaran diterima, menunggu konfirmasi admin.'}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-6 py-2.5 text-sm font-bold text-white"
                style={{ background: 'var(--forest)' }}
              >
                Selesai
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
