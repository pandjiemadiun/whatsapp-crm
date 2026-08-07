import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MessageSquare, User, Bot, Clock, Loader2, Inbox,
  Send, Phone,
} from 'lucide-react';
import api from '../services/api';

interface ConversationListItem {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  lastMessageAt: string | null;
  lastMessage?: string | null;
  aiResponseCount: number;
  faqResponseCount: number;
}

interface HistoryItem {
  id: string;
  role: string;
  content: string;
  source: string | null;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  lastMessageAt: string | null;
  aiResponseCount: number;
  faqResponseCount: number;
  history: HistoryItem[];
}

type FilterTab = 'all' | 'needs_me' | 'bot_answered' | 'resolved';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Baru saja';
  if (diffMin < 60) return `${diffMin} mnt`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function SkeletonRow() {
  return (
    <div className="p-4 border-b border-line dark:border-dline">
      <div className="h-4 w-3/4 rounded bg-line animate-pulse mb-2" />
      <div className="h-3 w-1/2 rounded bg-line animate-pulse" />
    </div>
  );
}

function SkeletonBubble() {
  return (
    <div className="space-y-3 p-6">
      <div className="h-16 w-3/4 rounded-xl bg-line animate-pulse" />
      <div className="h-16 w-1/2 rounded-xl bg-line animate-pulse ml-auto" />
      <div className="h-16 w-2/3 rounded-xl bg-line animate-pulse" />
    </div>
  );
}

const FILTER_TABS: Array<{ key: FilterTab; label: string }> = [
  { key: 'all', label: 'Semua' },
  { key: 'needs_me', label: 'Perlu Kamu' },
  { key: 'bot_answered', label: 'Dijawab Bot' },
  { key: 'resolved', label: 'Selesai' },
];

export default function ConversationInbox() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // ── MatchMedia for responsive behavior ──
  const [isLg, setIsLg] = useState(false);
  useEffect(() => {
    const check = () => setIsLg(window.matchMedia('(min-width: 1024px)').matches);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    api.get('/conversations')
      .then((res) => setConversations(res.data.data))
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, []);

  // ── Auto-select default tab ──
  useEffect(() => {
    const human = conversations.filter((c) => c.status === 'human_takeover').length;
    if (human > 0 && activeTab === 'all') {
      setActiveTab('needs_me');
    }
  }, [conversations, activeTab]);

  const openConversation = async (id: string) => {
    setSelectedId(id);
    setShowDetail(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/conversations/${id}`);
      setDetail(res.data.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setShowDetail(false);
    setSelectedId(null);
    setDetail(null);
  };

  const refreshDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await api.get(`/conversations/${selectedId}`);
      setDetail(res.data.data);
    } catch {}
  }, [selectedId]);

  const handleTakeOver = async () => {
    if (!selectedId) return;
    setTakingOver(true);
    try {
      const res = await api.put(`/conversations/${selectedId}/status`, { status: 'human_takeover' });
      if (res.data.success) {
        await refreshDetail();
        const listRes = await api.get('/conversations');
        setConversations(listRes.data.data);
      }
    } catch {}
    setTakingOver(false);
  };

  const handleResumeAI = async () => {
    if (!selectedId) return;
    setResuming(true);
    try {
      const res = await api.put(`/conversations/${selectedId}/status`, { status: 'open' });
      if (res.data.success) {
        await refreshDetail();
        const listRes = await api.get('/conversations');
        setConversations(listRes.data.data);
      }
    } catch {}
    setResuming(false);
  };

  const handleSend = async () => {
    if (!selectedId || !replyText.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/conversations/${selectedId}/reply`, { message: replyText.trim() });
      if (res.data.success) {
        setReplyText('');
        if (replyRef.current) replyRef.current.style.height = 'auto';
        await refreshDetail();
        const listRes = await api.get('/conversations');
        setConversations(listRes.data.data);
      }
    } catch {}
    setSending(false);
  };

  const handleReplyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    setReplyText(el.value);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'open') {
      return (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-brand bg-brand-soft border border-brand-light rounded-full px-2 py-0.5">
          Dijawab bot
        </span>
      );
    }
    if (status === 'human_takeover') {
      return (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
          Perlu kamu
        </span>
      );
    }
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
        Selesai
      </span>
    );
  };

  // ── Filter logic ──
  const filtered = conversations.filter((c) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'needs_me') return c.status === 'human_takeover';
    if (activeTab === 'bot_answered') return c.status === 'open';
    if (activeTab === 'resolved') return c.status !== 'open' && c.status !== 'human_takeover';
    return true;
  });

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const selected = conversations.find((c) => c.id === selectedId);
  const isTakenOver = detail?.status === 'human_takeover';

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-muted hover:text-ink transition shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-display font-bold text-navy dark:text-surface">Inbox</h1>
          <p className="text-sm text-muted">Percakapan customer</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-surface dark:bg-dline rounded-lg text-sm font-medium overflow-x-auto">
        {FILTER_TABS.map((tab) => {
          const count = tab.key === 'all'
            ? conversations.length
            : tab.key === 'needs_me'
            ? conversations.filter((c) => c.status === 'human_takeover').length
            : tab.key === 'bot_answered'
            ? conversations.filter((c) => c.status === 'open').length
            : conversations.filter((c) => c.status !== 'open' && c.status !== 'human_takeover').length;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setShowDetail(false); }}
              className={`flex-1 whitespace-nowrap shrink-0 py-2 px-3 rounded-md text-sm transition ${
                activeTab === tab.key
                  ? 'bg-surface dark:bg-dcard text-brand shadow border border-line dark:border-dline'
                  : 'text-muted hover:text-ink hover:bg-surface dark:hover:bg-dline'
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[384px_1fr] gap-0 border border-line dark:border-dline rounded-xl overflow-hidden" style={{ minHeight: 'calc(100vh - 280px)' }}>
        {/* ── Left Panel: Conversation List ── */}
        <div className={`lg:block border-r border-line dark:border-dline ${showDetail && !isLg ? 'hidden' : 'block'}`}>
          <div className="bg-surface dark:bg-dcard overflow-hidden flex flex-col h-full">
            <div className="px-4 py-3 border-b border-line dark:border-dline bg-surface dark:bg-dline/50">
              <h2 className="text-sm font-semibold text-muted">Daftar Percakapan</h2>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-line dark:divide-dline">
              {listLoading ? (
                <>
                  <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
                </>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Inbox className="w-10 h-10 text-muted dark:text-gray-500 mb-3" />
                  <p className="text-sm text-muted">Tidak ada percakapan</p>
                </div>
              ) : (
                <>
                  {visible.map((conv) => {
                    const isActive = selectedId === conv.id;
                    const displayName = conv.customerName || conv.customerPhone || conv.customerId;
                    return (
                      <button
                        key={conv.id}
                        onClick={() => openConversation(conv.id)}
                        className={`w-full text-left px-4 py-3 transition ${
                          isActive ? 'bg-brand-soft dark:bg-brand/10 border-l-2 border-l-brand' : 'hover:bg-surface dark:hover:bg-dline'
                        }`}
                      >
                        <div className="flex items-start gap-3">
<div className="w-8 h-8 rounded-full bg-brand-soft dark:bg-brand/20 text-brand flex items-center justify-center text-xs font-semibold shrink-0">
                            {conv.customerName ? conv.customerName.trim().charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-sm font-medium text-ink dark:text-surface truncate">
                                {displayName}
                              </span>
                              {statusBadge(conv.status)}
                            </div>
                            <p className="text-xs text-muted truncate">
                              {conv.lastMessage || 'Ketuk untuk membuka'}
                            </p>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted dark:text-gray-500 mt-0.5">
                              <Clock className="w-3 h-3" />
                              <span>{formatDate(conv.lastMessageAt)}</span>
                              {conv.aiResponseCount > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Bot className="w-3 h-3" />{conv.aiResponseCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Load more */}
                  {hasMore && (
                    <div className="p-3 text-center border-t border-line dark:border-dline">
                      <button
                        onClick={() => setVisibleCount((v) => v + 20)}
                        className="text-sm text-brand hover:text-brand-deep font-medium"
                      >
                        Muat lebih banyak
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Panel: Message History ── */}
        <div className={`lg:block ${showDetail || isLg ? 'block' : 'hidden'}`}>
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Detail header */}
            <div className="px-4 py-3 border-b border-line dark:border-dline flex items-center gap-3">
              {!isLg && (
                <button
                  onClick={closeDetail}
                  className="text-muted hover:text-ink transition shrink-0 lg:hidden"
                  aria-label="Kembali"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              {selected ? (
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-ink dark:text-surface truncate">
                    {selected.customerName || selected.customerPhone || selected.customerId}
                  </h2>
                  <p className="text-xs text-muted">
                    FAQ: {selected.faqResponseCount} · AI: {selected.aiResponseCount}
                    {selected.customerPhone && (
                      <> · <Phone className="w-3 h-3 inline" /> {selected.customerPhone}</>
                    )}
                  </p>
                </div>
              ) : (
<h2 className="text-sm font-semibold text-muted">Pesan</h2>
              )}
            </div>

            {/* Action buttons (take over / resume) */}
            {selected && (
              <div className="px-4 py-2 border-b border-line dark:border-dline flex items-center gap-2">
                {!isTakenOver && (
                  <button
                    onClick={handleTakeOver}
                    disabled={takingOver}
                    className="text-xs font-medium text-amber-700 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition"
                  >
                    {takingOver ? 'Mengambil...' : 'Ambil alih'}
                  </button>
                )}
                {isTakenOver && (
                  <button
                    onClick={handleResumeAI}
                    disabled={resuming}
                    className="text-xs font-medium text-brand bg-brand-soft dark:bg-brand/20 border border-brand-light px-2.5 py-1 rounded-lg hover:bg-brand-light transition"
                  >
                    {resuming ? 'Melanjutkan...' : 'Lanjutkan AI'}
                  </button>
                )}
              </div>
            )}

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto">
              {!selectedId ? (
                <div className="flex flex-col items-center justify-center py-16 text-center h-full">
                  <MessageSquare className="w-10 h-10 text-muted dark:text-gray-500 mb-3" />
                  <p className="text-sm text-muted">Pilih percakapan untuk melihat pesan</p>
                </div>
              ) : detailLoading ? (
                <SkeletonBubble />
              ) : detail && detail.history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
<MessageSquare className="w-10 h-10 text-muted dark:text-gray-500 mb-3" />
                  <p className="text-sm text-muted">Belum ada pesan</p>
                </div>
              ) : detail ? (
                <div className="p-4 space-y-4">
                  {detail.history.map((msg) => {
                    const isUser = msg.role === 'user';
                    const isAgent = msg.role === 'agent';
                    return (
                      <div key={msg.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                        <div
                          className={`max-w-[85%] lg:max-w-[70%] rounded-xl px-4 py-2.5 text-sm ${
                            isUser
                              ? 'bg-line/10 dark:bg-dline text-ink dark:text-surface rounded-bl-sm'
                              : isAgent
                                ? 'bg-amber-50 dark:bg-amber-900/20 text-ink dark:text-surface rounded-br-sm border border-amber-200 dark:border-amber-800'
                                : 'bg-brand-soft dark:bg-brand/10 text-ink dark:text-surface rounded-br-sm'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            {isUser ? (
                              <User className="w-3 h-3 text-muted" />
                            ) : (
                              <Bot
                                className={`w-3 h-3 ${
                                  isAgent ? 'text-amber-600' : 'text-brand'
                                }`}
                              />
                            )}
                            <span className="text-[10px] font-medium text-muted dark:text-gray-500">
                              {isUser ? 'Customer' : isAgent ? 'Agent' : 'Assistant'}
                            </span>
                            {msg.source && (
                              <span className="text-[9px] uppercase font-semibold text-muted dark:text-gray-500 bg-line/10 dark:bg-dline px-1 rounded">
                                {msg.source}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <p className="text-[10px] text-muted dark:text-gray-500 mt-1 text-right">
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-sm text-muted">Gagal memuat percakapan</p>
                </div>
              )}
            </div>

            {/* Sticky reply — only if conversation selected + not taken over */}
            {selectedId && !isTakenOver && (
              <div className="border-t border-line dark:border-dline p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={replyRef}
                    value={replyText}
                    onChange={handleReplyChange}
                    onKeyDown={handleReplyKeyDown}
                    placeholder="Ketik balasan... (Enter kirim, Shift+Enter baru baris)"
                    defaultValue=""
                    rows={1}
                    disabled={sending}
                    className="flex-1 px-3 py-1.5 border border-line dark:border-dline rounded-lg text-sm resize-none bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim() || sending}
                    className="w-9 h-9 rounded-lg bg-brand text-white flex items-center justify-center hover:bg-brand-deep disabled:bg-brand/50 focus-visible:ring-2 focus:ring-brand transition shrink-0"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            {selectedId && isTakenOver && (
              <div className="border-t border-line dark:border-dline p-3 bg-surface dark:bg-dline/50">
                <p className="text-xs text-muted text-center">
                  Anda sedang mengambil alih. Klik "Lanjutkan AI" untuk kembali ke mode AI.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
