/**
 * For You — a persistent recommendation desk.
 *
 * The conversation is stored in the SDK's owner-scoped ai-chats / ai-messages
 * collections. The bookseller endpoint grounds every shelf in Google Books,
 * writes both turns server-side, and keeps each book's reason with the message.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { getAuthToken, useAuth, useQuery } from 'deepspace'
import {
  BookOpen,
  CornerDownLeft,
  History,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { BookCard } from '../../../components/books/BookCard'
import { useBookDetails } from '../../../components/books/BookDetailsContext'
import { BookCover } from '../../../components/books/BookCover'
import { Button, ConfirmModal, Textarea, cn, useToast } from '../../../components/ui'
import type { Book } from '../../../lib/books'
import { buildPreferenceSummary, type PreferenceSummary } from '../../../lib/preferences'
import { useBookInteractions } from '../../../lib/useBookInteractions'
import { useRecommendationChats, type ChatSummary } from '../../../lib/useRecommendationChats'
import { useSavedBooks } from '../../../lib/useSavedBooks'

type RecommendedBook = Book & { reason: string }

interface RecommendResponse {
  reply?: string
  books?: RecommendedBook[]
  assistantId?: string
  basis?: 'personal' | 'starter'
  error?: string
}

interface RecommendationPart {
  type?: string
  books?: RecommendedBook[]
}

interface ChatMessageData {
  chatId: string
  userId: string
  role: string
  content: string
  parts?: RecommendationPart[]
}

interface DisplayTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  books: RecommendedBook[]
}

interface PendingTurn {
  userMessageId: string
  message: string
  assistantId?: string
  reply?: string
  books?: RecommendedBook[]
}

const OPENERS = [
  'Something quiet and beautiful for a rainy Sunday',
  'A page-turner I can finish in a weekend',
  'A book that would make me see the world differently',
]

const WELCOME =
  'Pull up a chair. Tell me what you are in the mood for — a mood, a memory, a kind of story — and I will see what the shelves have to offer.'

function dateLabel(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface HistoryPanelProps {
  chats: ChatSummary[]
  loading: boolean
  activeChatId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (chat: ChatSummary) => void
  className?: string
}

function HistoryPanel({
  chats,
  loading,
  activeChatId,
  onSelect,
  onNew,
  onDelete,
  className,
}: HistoryPanelProps) {
  return (
    <div className={cn('flex h-full flex-col rounded-lg border border-border bg-card', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="font-serif text-base text-foreground">Conversations</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNew}
          data-testid="new-chat"
          className="h-7 rounded-full px-2.5 text-[10px] uppercase tracking-[0.12em] text-primary hover:text-primary"
        >
          <Plus className="size-3" aria-hidden /> New
        </Button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2" data-testid="chat-history">
        {loading ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-10 animate-pulse rounded-md bg-secondary" />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            No conversations yet. Your first question starts one.
          </p>
        ) : (
          chats.map((chat) => {
            const active = chat.recordId === activeChatId
            return (
              <div
                key={chat.recordId}
                className={cn(
                  'group flex items-center gap-1 rounded-md border px-2 py-2 transition',
                  active
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-transparent hover:border-border hover:bg-secondary/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(chat.recordId)}
                  aria-current={active ? 'true' : undefined}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className={cn(
                      'block truncate text-[12px]',
                      active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {chat.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground/70">
                    {active ? 'Current conversation' : dateLabel(chat.updatedAt) || 'Conversation'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(chat)}
                  aria-label={`Delete ${chat.title}`}
                  title={`Delete ${chat.title}`}
                  className="rounded p-1 text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default function ForYouPage() {
  const { userId } = useAuth()
  const ownerId = userId ?? '__anonymous__'
  const { success, error: notifyError } = useToast()
  const { openDetails } = useBookDetails()

  const saved = useSavedBooks()
  const interactions = useBookInteractions()
  const chats = useRecommendationChats()
  const { activeChatId, setActiveChat, createChat, deleteChat } = chats

  const { records: recentChatMessages } = useQuery<ChatMessageData>('ai-messages', {
    where: { userId: ownerId },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 30,
  })

  const recentRequests = recentChatMessages
    .filter((record) => record.data.role === 'user')
    .map((record) => record.data.content)
    .slice(0, 8)

  const preferences = useMemo<PreferenceSummary>(
    () =>
      buildPreferenceSummary(
        userId ?? '',
        saved.savedBooks,
        interactions.interactions,
        recentRequests,
      ),
    [userId, saved.savedBooks, interactions.interactions, recentRequests],
  )
  const preferenceKey = JSON.stringify(preferences)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<PendingTurn | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatToDelete, setChatToDelete] = useState<ChatSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const endOfChat = useRef<HTMLDivElement>(null)

  const [personalBooks, setPersonalBooks] = useState<RecommendedBook[]>([])
  const [personalBasis, setPersonalBasis] = useState<'personal' | 'starter'>('starter')
  const [personalLoading, setPersonalLoading] = useState(true)
  const [personalError, setPersonalError] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  const { records: messageRecords } = useQuery<ChatMessageData>('ai-messages', {
    where: { chatId: activeChatId ?? '__none__', userId: ownerId },
    orderBy: 'createdAt',
    orderDir: 'asc',
    limit: 200,
  })

  const messages: DisplayTurn[] = messageRecords
    .filter((record) => record.data.role === 'user' || record.data.role === 'assistant')
    .map((record) => {
      const part = Array.isArray(record.data.parts)
        ? record.data.parts.find((entry) => entry?.type === 'dogear.recommendations')
        : undefined
      return {
        id: record.recordId,
        role: record.data.role === 'user' ? 'user' : 'assistant',
        content: record.data.content,
        books: part?.books ?? [],
      }
    })

  const pendingTurns: DisplayTurn[] = []
  if (pending) {
    pendingTurns.push({ id: pending.userMessageId, role: 'user', content: pending.message, books: [] })
    if (pending.assistantId) {
      pendingTurns.push({
        id: pending.assistantId,
        role: 'assistant',
        content: pending.reply ?? '',
        books: pending.books ?? [],
      })
    }
  }
  const visibleTurns = [
    ...messages,
    ...pendingTurns.filter((turn) => !messages.some((message) => message.id === turn.id)),
  ]

  useEffect(() => {
    endOfChat.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [visibleTurns.length, sending])

  // Once the persisted assistant row appears, drop the local overlay so the
  // response is only ever rendered from the database-backed subscription.
  useEffect(() => {
    if (pending?.assistantId && messages.some((turn) => turn.id === pending.assistantId)) {
      setPending(null)
    }
  }, [messages, pending])

  useEffect(() => {
    if (!userId) {
      setPersonalBooks([])
      setPersonalLoading(false)
      return
    }
    // Wait for both owned collections before building a profile. The worker
    // reloads them too, but this avoids a needless starter request on mount.
    if (saved.loading || interactions.loading) return
    let cancelled = false
    setPersonalLoading(true)
    setPersonalError('')

    async function loadPersonalShelf() {
      try {
        const token = await getAuthToken()
        if (!token) throw new Error('Sign in to get recommendations.')
        const response = await fetch('/api/books/personal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ preferences }),
        })
        const data = (await response.json()) as RecommendResponse
        if (!response.ok) throw new Error(data.error ?? 'Could not build your shelf.')
        if (cancelled) return
        setPersonalBooks(data.books ?? [])
        setPersonalBasis(data.basis ?? 'starter')
      } catch (err) {
        if (!cancelled) {
          setPersonalBooks([])
          setPersonalError(err instanceof Error ? err.message : 'Could not build your shelf.')
        }
      } finally {
        if (!cancelled) setPersonalLoading(false)
      }
    }

    void loadPersonalShelf()
    return () => {
      cancelled = true
    }
    // preferenceKey reflects the actual library/swipe content, not just identity.
  }, [userId, preferenceKey, refreshCount, saved.loading, interactions.loading])

  async function ask(question: string) {
    const message = question.trim()
    if (!message || sending) return

    setSending(true)
    setError('')
    setInput('')
    const userMessageId = `umsg-${Date.now()}-${crypto.randomUUID()}`
    setPending({ userMessageId, message })

    try {
      let chatId = activeChatId
      if (!chatId) chatId = await createChat()

      const token = await getAuthToken()
      if (!token) throw new Error('Sign in to talk with the bookseller.')

      const response = await fetch('/api/books/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, chatId, messageId: userMessageId, preferences }),
      })
      const data = (await response.json()) as RecommendResponse
      if (!response.ok) throw new Error(data.error ?? 'The bookseller is unavailable right now.')

      setPending({
        userMessageId,
        message,
        assistantId: data.assistantId,
        reply: data.reply,
        books: data.books,
      })
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  async function confirmDelete() {
    if (!chatToDelete) return
    setDeleting(true)
    try {
      await deleteChat(chatToDelete.recordId)
      success('Conversation deleted', `“${chatToDelete.title}” is gone.`)
      setChatToDelete(null)
      setHistoryOpen(false)
    } catch (err) {
      notifyError('Could not delete the conversation', err instanceof Error ? err.message : undefined)
    } finally {
      setDeleting(false)
    }
  }

  function startNewChat() {
    setActiveChat(null)
    setPending(null)
    setError('')
    setInput('')
    setHistoryOpen(false)
  }

  const historyPanel = (
    <HistoryPanel
      chats={chats.chats}
      loading={chats.chatLoading}
      activeChatId={activeChatId}
      onSelect={(id) => {
        setActiveChat(id)
        setPending(null)
        setError('')
        setHistoryOpen(false)
      }}
      onNew={startNewChat}
      onDelete={setChatToDelete}
    />
  )

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <header className="max-w-3xl">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
            A personal recommendation desk
          </p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight sm:text-5xl">
            A shelf with your <span className="italic text-primary">name on it.</span>
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            No forms, no star ratings. Just tell our bookseller what you are
            looking for, in your own words, and see what comes back.
          </p>
        </header>

        <div className="mt-12 grid gap-8 xl:grid-cols-[220px_minmax(0,360px)_minmax(0,1fr)] xl:gap-8">
          <aside className="hidden h-[34rem] xl:block" aria-label="Conversation history">
            {historyPanel}
          </aside>

          {/* Conversation */}
          <section
            className="xl:sticky xl:top-24 xl:self-start"
            aria-label="Recommendation chat"
            data-testid="recommendation-chat"
          >
            <div className="flex h-[34rem] flex-col rounded-lg border border-border bg-card shadow-[0_18px_40px_-28px_rgba(40,41,35,0.35)]">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-sage">
                  <BookOpen className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-serif text-base leading-none">
                    {chats.chats.find((chat) => chat.recordId === activeChatId)?.title ?? 'The bookseller'}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Saved in your conversations
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  aria-label="Open conversation history"
                  className="ml-auto rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground xl:hidden"
                >
                  <History className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={startNewChat}
                  aria-label="Start a new conversation"
                  title="Start a new conversation"
                  className="rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <Plus className="size-4" />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {visibleTurns.length === 0 && (
                  <div className="rounded-lg border border-border bg-background px-4 py-5">
                    <span className="font-serif text-[15px] leading-relaxed text-foreground">{WELCOME}</span>
                    <p className="mt-3 text-[10px] uppercase tracking-[0.14em] text-sage">
                      Your conversations stay here after you leave
                    </p>
                  </div>
                )}

                {visibleTurns.map((turn) => (
                  <div
                    key={turn.id}
                    className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                    data-testid="chat-message"
                  >
                    <div className={cn('max-w-[90%]', turn.role === 'user' ? 'text-right' : 'text-left')}>
                      <p
                        className={cn(
                          'rounded-lg px-4 py-3 text-[13px] leading-relaxed',
                          turn.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-background text-foreground',
                        )}
                      >
                        {turn.role === 'assistant' ? (
                          <span className="font-serif text-[15px] leading-relaxed">{turn.content}</span>
                        ) : (
                          turn.content
                        )}
                      </p>

                      {turn.books.length > 0 && (
                        <div className="mt-2 space-y-1.5" data-testid="chat-recommendations">
                          {turn.books.map((book) => (
                            <button
                              key={`${book.source}:${book.sourceId}`}
                              type="button"
                              data-testid="chat-book-details"
                              aria-label={`View details for ${book.title}`}
                              onClick={() => openDetails(book)}
                              className="flex w-full gap-2.5 rounded-md border border-border bg-background p-2 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <div className="w-10 shrink-0">
                                <BookCover book={book} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-serif text-[13px] leading-tight text-foreground">
                                  {book.title}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {book.authors.join(', ') || 'Unknown author'}
                                </p>
                                {book.reason && (
                                  <p className="mt-1 text-[11px] leading-relaxed text-sage">
                                    {book.reason}
                                  </p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {sending && (
                  <div className="flex justify-start" data-testid="chat-loading">
                    <p className="rounded-lg border border-border bg-background px-4 py-3 font-serif text-sm italic text-muted-foreground">
                      Checking the shelves…
                    </p>
                  </div>
                )}

                {error && (
                  <p role="alert" className="rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive">
                    {error}
                  </p>
                )}
                <div ref={endOfChat} />
              </div>

              <div className="border-t border-border p-4">
                {visibleTurns.length === 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {OPENERS.map((opener) => (
                      <button
                        key={opener}
                        type="button"
                        disabled={sending}
                        onClick={() => void ask(opener)}
                        className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
                      >
                        {opener}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void ask(input)
                  }}
                  className="flex items-end gap-2"
                >
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void ask(input)
                      }
                    }}
                    rows={2}
                    aria-label="Tell the bookseller what you want to read"
                    placeholder="I am in the mood for…"
                    className="min-h-0 flex-1 resize-none border-input bg-background text-[13px] focus-visible:ring-primary/30"
                  />
                  <Button
                    type="submit"
                    loading={sending}
                    disabled={!input.trim()}
                    size="icon"
                    aria-label="Ask the bookseller"
                    className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Send className="size-4" />
                  </Button>
                </form>
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <CornerDownLeft className="size-3" /> Enter to send · Shift + Enter for a new line
                </p>
              </div>
            </div>
          </section>

          {/* Personalized shelf — separate from the conversation. */}
          <section aria-label="Recommended books" data-testid="personal-recommendations">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">
                  <Sparkles className="size-3" aria-hidden /> Picked for you
                </p>
                <h2 className="mt-1.5 font-serif text-2xl text-foreground">
                  {personalBasis === 'personal' ? 'From your reading trail' : 'A starter shelf'}
                </h2>
                <p className="mt-1.5 max-w-md text-[11px] leading-relaxed text-muted-foreground">
                  {personalBasis === 'personal'
                    ? 'Built from the books you have saved, swiped on, and read.'
                    : 'Like and pass a few books on Discover and this shelf will learn your taste.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRefreshCount((value) => value + 1)}
                aria-label="Refresh recommendations"
                className="rounded-full border border-border p-2 text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <RefreshCw className={cn('size-3.5', personalLoading && 'animate-spin')} />
              </button>
            </div>

            {personalError && (
              <p role="alert" className="mb-5 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive">
                {personalError}
              </p>
            )}

            {personalLoading ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="animate-pulse">
                    <div className="aspect-[2/3] rounded-sm bg-secondary" />
                    <div className="mt-3 h-3 w-4/5 rounded bg-secondary" />
                    <div className="mt-2 h-2 w-3/5 rounded bg-secondary" />
                  </div>
                ))}
              </div>
            ) : personalBooks.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 xl:grid-cols-4">
                {personalBooks.map((book) => (
                  <BookCard
                    key={`${book.source}:${book.sourceId}`}
                    book={book}
                    reason={book.reason}
                    onOpenDetails={openDetails}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/60 px-6 py-16 text-center">
                <p className="font-serif text-xl italic text-foreground">
                  “Tell me what you love, and I will find you something to love next.”
                </p>
                <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Ask the bookseller, or browse the stack on Discover, and a shelf
                  with a note for each book will appear here.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Conversation history drawer below the sidebar breakpoint. */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close conversation history"
            onClick={() => setHistoryOpen(false)}
            className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-label="Conversation history"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-background p-3 shadow-xl"
          >
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close conversation history"
              className="mb-2 self-end rounded-full p-2 text-muted-foreground hover:bg-secondary"
            >
              <X className="size-4" />
            </button>
            <div className="min-h-0 flex-1">{historyPanel}</div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!chatToDelete}
        onClose={() => setChatToDelete(null)}
        onConfirm={() => void confirmDelete()}
        loading={deleting}
        title="Delete this conversation?"
        description={`“${chatToDelete?.title ?? ''}” and all of its messages will be removed. This cannot be undone.`}
        confirmText="Delete conversation"
      />
    </main>
  )
}
