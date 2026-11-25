/**
 * For You — a personal recommendation desk.
 *
 * The conversation goes through /api/books/recommend. The model writes the
 * bookseller's note and picks catalogue queries; the returned books are real
 * Google Books results with a reason attached to each.
 */

import { useEffect, useRef, useState } from 'react'
import { getAuthToken } from 'deepspace'
import { BookOpen, CornerDownLeft, RotateCcw, Send } from 'lucide-react'
import { BookCard } from '../../../components/books/BookCard'
import { Button, Textarea } from '../../../components/ui'
import { cn } from '../../../lib/utils'
import type { Book } from '../../../lib/books'

type Turn = { role: 'user' | 'assistant'; content: string }

type RecommendedBook = Book & { reason: string }

interface RecommendResponse {
  reply?: string
  books?: RecommendedBook[]
  error?: string
}

const OPENERS = [
  'Something quiet and beautiful for a rainy Sunday',
  'A page-turner I can finish in a weekend',
  'A book that would make me see the world differently',
]

const INITIAL_TURN: Turn = {
  role: 'assistant',
  content:
    'Pull up a chair. Tell me what you are in the mood for — a mood, a memory, a kind of story — and I will see what the shelves have to offer.',
}

export default function ForYouPage() {
  const [turns, setTurns] = useState<Turn[]>([INITIAL_TURN])
  const [input, setInput] = useState('')
  const [books, setBooks] = useState<RecommendedBook[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endOfChat = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endOfChat.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [turns, loading])

  async function ask(question: string) {
    const message = question.trim()
    if (!message || loading) return

    const history = turns.slice(-8)
    setTurns((current) => [...current, { role: 'user', content: message }])
    setInput('')
    setLoading(true)
    setError('')

    try {
      const token = await getAuthToken()
      if (!token) throw new Error('Sign in to talk with the bookseller.')

      const response = await fetch('/api/books/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message, history }),
      })
      const data = (await response.json()) as RecommendResponse

      if (!response.ok) throw new Error(data.error ?? 'The bookseller is unavailable right now.')

      setTurns((current) => [
        ...current,
        { role: 'assistant', content: data.reply ?? 'Let me think about that one.' },
      ])
      setBooks(data.books ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setTurns([INITIAL_TURN])
    setBooks([])
    setError('')
    setInput('')
  }

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

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-12">
          {/* Conversation */}
          <section className="lg:sticky lg:top-24 lg:self-start" aria-label="Recommendation chat">
            <div className="flex h-[30rem] flex-col rounded-lg border border-border bg-card shadow-[0_18px_40px_-28px_rgba(40,41,35,0.35)]">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-sage">
                  <BookOpen className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="font-serif text-base leading-none">The bookseller</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Here to help you browse
                  </p>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Start a new conversation"
                  title="Start over"
                  className="ml-auto rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {turns.map((turn, index) => (
                  <div
                    key={index}
                    className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <p
                      className={cn(
                        'max-w-[88%] rounded-lg px-4 py-3 text-[13px] leading-relaxed',
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
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
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
                {books.length === 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {OPENERS.map((opener) => (
                      <button
                        key={opener}
                        type="button"
                        disabled={loading}
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
                    loading={loading}
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

          {/* Recommendations */}
          <section aria-label="Recommended books">
            <div className="mb-6 border-b border-border pb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">
                Picked for you
              </p>
              <h2 className="mt-1.5 font-serif text-2xl text-foreground">
                {books.length > 0 ? 'From the recommendation desk' : 'Waiting for your first request'}
              </h2>
            </div>

            {books.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 xl:grid-cols-4">
                {books.map((book) => (
                  <BookCard
                    key={`${book.source}:${book.sourceId}`}
                    book={book}
                    reason={book.reason}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/60 px-6 py-16 text-center">
                <p className="font-serif text-xl italic text-foreground">
                  “Tell me what you love, and I will find you something to love next.”
                </p>
                <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Your books, with a note on why each one was chosen, will appear
                  here after you chat with the bookseller.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
