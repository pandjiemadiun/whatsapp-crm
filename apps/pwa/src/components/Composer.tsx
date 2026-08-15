import { forwardRef } from 'react'
import type { SenderRole } from '../types/chat'

export interface ComposerProps {
  value: string
  /** Raw string value on each keystroke (ChatPage wires typing reports here). */
  onInput: (value: string) => void
  onSend: () => void
  sending: boolean
  /** resolved or sending => input + send disabled */
  disabled: boolean
  placeholder?: string
  onShortcut?: (label: string) => void
}

/** Composer (Step 11 — presentation only). Preserves Enter-to-send; adds Shift+Enter
 *  newline (textarea). No API change, no message identity change, no dedup change. */
const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onInput, onSend, sending: _sending, disabled, placeholder, onShortcut },
  ref,
) {
  const lines = value.split('\n')
  const isEmpty = lines.every((l) => l.trim() === '')

  return (
    <footer className="border-t border-border bg-white flex-shrink-0">
      <div className="px-3 pt-2 pb-2">
        {/* Shortcut chips */}
        {onShortcut && (
          <div className="flex gap-2 overflow-x-auto chat-scroll pb-2 mb-1.5">
            <button
              type="button"
              onClick={() => onShortcut('📖 Katalog')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors"
              style={{ background: 'var(--forest-pale)', color: 'var(--forest)' }}
            >
              📖 Katalog
            </button>
            <button
              type="button"
              onClick={() => onShortcut('📦 Status Pesanan')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors"
              style={{ background: 'var(--forest-pale)', color: 'var(--forest)' }}
            >
              📦 Status Pesanan
            </button>
            <button
              type="button"
              onClick={() => onShortcut('🎧 Hubungi CS')}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors"
              style={{ background: 'var(--forest-pale)', color: 'var(--forest)' }}
            >
              🎧 Hubungi CS
            </button>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-2">
          <textarea
            ref={ref}
            className="flex-1 min-w-0 border border-border bg-muted rounded-full px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none resize-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-all"
            value={value}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            disabled={disabled}
            placeholder={placeholder}
            aria-label="Ketik pesan"
            rows={1}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || isEmpty}
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
  )
})

export default Composer

// Re-export so consumers can reference the canonical role set if needed.
export type { SenderRole }
