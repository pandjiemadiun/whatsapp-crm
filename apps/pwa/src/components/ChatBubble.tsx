import type { ReactNode } from 'react';

type ChatBubbleProps = {
  role: 'user' | 'assistant' | 'system' | 'agent'
  text?: string
  source?: string | null
  isTyping?: boolean
  children?: ReactNode
}

export default function ChatBubble({ role, text, source, isTyping, children }: ChatBubbleProps) {
  const isUser = role === 'user'
  const isAgent = role === 'agent'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[75%] px-3 py-2.5 text-[13px] leading-relaxed"
          style={{
            background: 'var(--forest)',
            color: '#fff',
            borderRadius: '15px 15px 4px 15px',
          }}
        >
          {isTyping ? (
            <div className="flex items-center gap-1">
              <span className="text-white/70 font-medium">mengetik</span>
              <span className="inline-flex items-center gap-[1px] ml-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="dot-pulse"
                    style={{ animationDelay: `${i * 0.12}s`, background: 'rgba(255,255,255,0.6)' }}
                  />
                ))}
              </span>
            </div>
          ) : children ? (
            children
          ) : (
            <p className="whitespace-pre-wrap break-words text-white m-0">{text}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div
        className="max-w-[75%] px-3 py-2.5 text-[13px] leading-relaxed border"
        style={{
          background: '#fff',
          color: 'var(--ink)',
          borderColor: 'var(--line)',
          borderRadius: '15px 15px 15px 4px',
        }}
      >
        {isTyping ? (
          <div className="flex items-center gap-1.5">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : children ? (
          children
        ) : (
          <p className="whitespace-pre-wrap break-words text-foreground m-0">{text}</p>
        )}
        {!isTyping && isAgent && (
          <span className="block text-[10px] opacity-60 mt-1">🤖</span>
        )}
        {!isTyping && source && (
          <span className="block text-[10px] opacity-60 mt-1">{source}</span>
        )}
      </div>
    </div>
  )
}
