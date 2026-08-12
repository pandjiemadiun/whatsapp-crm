type ChatBubbleProps = {
  role: 'user' | 'assistant' | 'system'
  text: string
  source?: string | null
}

// Bubble chat sederhana: user rata-kanan, assistant/system rata-kiri.
export default function ChatBubble({ role, text, source }: ChatBubbleProps) {
  const isUser = role === 'user'
  const bg = isUser
    ? 'bg-blue-600 text-white'
    : role === 'system'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-gray-200 text-gray-900'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${bg}`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {source && (
          <span className="block text-[10px] opacity-60 mt-1">{source}</span>
        )}
      </div>
    </div>
  )
}
