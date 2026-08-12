type ChatBubbleProps = {
  role: 'user' | 'assistant' | 'system'
  text?: string
  source?: string | null
  isTyping?: boolean
}

// Bubble chat sederhana: user rata-kanam, assistant/system rata-kiri.
// isTyping: tampilkan "mengetik..." + animasi 3-dot — bukan balasan AI sungguhan.
export default function ChatBubble({ role, text, source, isTyping }: ChatBubbleProps) {
  const isUser = role === 'user'
  const bg = isUser
    ? 'bg-blue-600 text-white'
    : role === 'system'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-gray-200 text-gray-900'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${bg}`}>
        {isTyping ? (
          <div className="flex items-center gap-1">
            <span className="text-gray-500 font-medium">mengetik</span>
            <span className="inline-flex items-center gap-[1px] ml-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="dot-pulse"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </span>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{text}</p>
        )}
        {!isTyping && source && (
          <span className="block text-[10px] opacity-60 mt-1">{source}</span>
        )}
      </div>
    </div>
  )
}
