/* home pattern: single-column-narrative — search-led discovery above curated shelves. */
/**
 * Discover — the front of the bookstore.
 *
 * Every cover on this page comes from the Google Books worker route. Curated
 * shelves are fetched on mount; if the integration is unavailable the shelves
 * say so rather than filling in invented books.
 */

import { useEffect, useState } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { APP_NAME } from '../../constants'
import { BookCard } from '../../components/books/BookCard'
import { useBookDetails } from '../../components/books/BookDetailsContext'
import { BookShelf } from '../../components/books/BookShelf'
import { SwipeDiscovery } from '../../components/books/SwipeDiscovery'
import { Button, SearchInput } from '../../components/ui'
import {
  BROWSE_TOPICS,
  CURATED_SHELVES,
  searchBooks,
  type Book,
} from '../../lib/books'
import { cn } from '../../lib/utils'

const FEATURED_QUERY = 'bestseller literary fiction'

export default function HomePage() {
  const { isSignedIn, user } = useAuthProfileReady({ requireUser: true })
  const { openDetails } = useBookDetails()

  const [query, setQuery] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const [shelves, setShelves] = useState<Record<string, Book[]>>({})
  const [featured, setFeatured] = useState<Book[]>([])
  const [shelvesLoading, setShelvesLoading] = useState(true)

  // Fill the shelves from real search results on first visit.
  useEffect(() => {
    let cancelled = false

    async function loadShelves() {
      const jobs = [
        ...CURATED_SHELVES.map((shelf) => ({ id: shelf.id, query: shelf.query })),
        { id: 'featured', query: FEATURED_QUERY },
      ]

      const results = await Promise.all(
        jobs.map(async ({ id, query: term }) => {
          try {
            return [id, await searchBooks(term, 12)] as const
          } catch {
            return [id, [] as Book[]] as const
          }
        }),
      )

      if (cancelled) return
      const next: Record<string, Book[]> = {}
      for (const [id, found] of results) next[id] = found
      setShelves(next)
      setFeatured(next.featured ?? [])
      setShelvesLoading(false)
    }

    void loadShelves()
    return () => {
      cancelled = true
    }
  }, [])

  async function runSearch(term: string) {
    const trimmed = term.trim()
    if (!trimmed) return

    setQuery(trimmed)
    setLoading(true)
    setError('')
    setHasSearched(true)

    try {
      setBooks(await searchBooks(trimmed, 24))
    } catch (err) {
      setBooks([])
      setError(err instanceof Error ? err.message : 'The shelves are unavailable right now.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    void runSearch(query)
  }

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:pt-20">
        {/* Editorial welcome */}
        <section className="relative max-w-4xl">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">
            A personalized library, just for you
          </p>
          <h1 className="font-serif text-[2.6rem] font-medium leading-[1.08] tracking-tight text-foreground sm:text-6xl lg:text-[4.25rem]">
            Every good book
            <br />
            finds its <span className="italic text-primary">reader.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            Browse the shelves, follow a curiosity, and leave with a story you
            will want to talk about. {APP_NAME} keeps the browsing human and the
            recommendations personal.
          </p>
          {isSignedIn && user && (
            <p className="mt-4 font-serif text-sm italic text-sage">
              Welcome back, {user.name ?? user.email}.
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-9 flex max-w-2xl flex-col gap-3 sm:flex-row">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder="A title, an author, a feeling…"
              aria-label="Search books"
              className="h-12 flex-1 rounded-full border-border bg-card pl-10 pr-10 text-sm"
            />
            <Button
              type="submit"
              loading={loading}
              disabled={!query.trim()}
              className="h-12 shrink-0 rounded-full bg-primary px-7 text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary/90"
            >
              Find books
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Browse by mood
            </span>
            {BROWSE_TOPICS.map((topic) => (
              <button
                key={topic.label}
                type="button"
                onClick={() => void runSearch(topic.query)}
                className={cn(
                  'rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground transition',
                  'hover:border-primary hover:text-primary',
                  hasSearched && query === topic.query && 'border-primary text-primary',
                )}
              >
                {topic.label}
              </button>
            ))}
          </div>
        </section>

        <div className="mt-14 h-px w-full bg-border" />

        {!hasSearched && <SwipeDiscovery />}

        {!hasSearched && <div className="h-px w-full bg-border" />}

        {/* Search results take over the shelves while active. */}
        {hasSearched ? (
          <section className="py-10">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">
                  From the catalogue
                </p>
                <h2 className="font-serif text-3xl text-foreground">“{query}”</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                {loading ? 'Pulling books from the shelves…' : `${books.length} books found`}
              </p>
            </div>

            {error && (
              <p role="alert" className="mb-6 rounded-md border border-destructive/30 bg-card p-4 text-sm text-destructive">
                {error}
              </p>
            )}

            {loading ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="animate-pulse">
                    <div className="aspect-[2/3] rounded-sm bg-secondary" />
                    <div className="mt-3 h-3 w-4/5 rounded bg-secondary" />
                    <div className="mt-2 h-2 w-3/5 rounded bg-secondary" />
                  </div>
                ))}
              </div>
            ) : books.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
                {books.map((book) => (
                  <BookCard
                    key={`${book.source}:${book.sourceId}`}
                    book={book}
                    onOpenDetails={openDetails}
                  />
                ))}
              </div>
            ) : !error ? (
              <p className="py-12 text-center font-serif text-lg italic text-muted-foreground">
                Nothing on the shelves for that one. Try a different author or mood.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setHasSearched(false)
                setQuery('')
                setError('')
              }}
              className="mt-10 text-xs uppercase tracking-[0.14em] text-primary underline-offset-4 hover:underline"
            >
              Back to the shelves
            </button>
          </section>
        ) : (
          <div>
            <BookShelf
              eyebrow="The front table"
              title="Freshly shelved"
              books={featured}
              loading={shelvesLoading}
              onOpenDetails={openDetails}
            />
            {CURATED_SHELVES.map((shelf) => (
              <BookShelf
                key={shelf.id}
                eyebrow={shelf.eyebrow}
                title={shelf.title}
                books={shelves[shelf.id] ?? []}
                loading={shelvesLoading}
                onOpenDetails={openDetails}
              />
            ))}
          </div>
        )}

        <footer className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span className="font-serif text-sm italic text-foreground">{APP_NAME}</span>
          <span>A little corner of the internet for people who love books.</span>
        </footer>
      </div>
    </main>
  )
}
