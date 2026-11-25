/**
 * Placeholder home page — replace this with the app's real home.
 *
 * This is intentionally unstyled scaffolding, not a design to build on.
 * Design the app's own look (layout, theme tokens, typography) from your
 * product's point of view instead of extending this page.
 */

import { useState } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { APP_NAME } from '../../constants'

interface Book {
  source: string
  sourceId: string
  title: string
  authors: string[]
  description: string
  categories: string[]
  publishedDate:  string
  coverUrl: string | null
}

interface SearchResponse {
  totalItems: number
  books: Book[]
  error?: string
}

export default function HomePage() {
  const { isSignedIn, user } = useAuthProfileReady({ requireUser: true })

  const [query, setQuery] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  async function handleSearch(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!query.trim()) return

    setLoading(true)
    setError('')
    setHasSearched(true)

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        limit: '20',
      })

      const response = await fetch(
        `/api/books/search?${params.toString()}`
      )

      const data = await response.json() as SearchResponse

      if (!response.ok) {
        throw new Error(data.error ?? 'Something went wrong.')
      }

      setBooks(data.books ?? [])
    } catch (err) {
      setBooks([])
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to search for books right now.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-10">
        <section className="mb-12">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Your next favorite book starts here
          </p>

          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Discover something <span className="italic">wonderful.</span>
          </h1>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Explore new stories, revisit old favorites, and find
            your next great read.
          </p>

          {isSignedIn && user && (
            <p className="mt-3 text-sm text-muted-foreground">
              Welcome back, {user.name ?? user.email}.
            </p>
          )}
        </section>

        {/* Search bar */}
        <section className="mb-14">
          <form
            onSubmit={handleSearch}
            className="flex max-w-2xl gap-3"
          >
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, author, or genre..."
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-5 py-4 text-sm text-foreground outline-none transition focus:border-foreground"
            />

            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-xl bg-foreground px-6 py-4 text-sm font-medium text-background transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
        </section>

        <section>
          {hasSearched ? (
            <>
              <div className="mb-7">
                <h2 className="text-2xl font-semibold">
                  Search results
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {loading
                    ? 'Finding books for you...'
                    : `${books.length} books displayed`}
                </p>
              </div>

              {error && (
                <p className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">
                  {error}
                </p>
              )}

              {loading && (
                <p className="py-10 text-sm text-muted-foreground">
                  Searching Google Books...
                </p>
              )}

              {!loading && !error && books.length === 0 && (
                <p className="py-10 text-sm text-muted-foreground">
                  No books found. Try another search!
                </p>
              )}

              {!loading && !error && books.length > 0 && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {books.map((book) => (
                    <article
                      key={book.sourceId}
                      className="group min-w-0"
                    >
                      <div className="mb-4 flex aspect-[2/3] items-center justify-center overflow-hidden rounded-lg bg-card">
                        {book.coverUrl ? (
                          <img
                            src={book.coverUrl}
                            alt={`Cover of ${book.title}`}
                            className="h-full w-full object-cover shadow-sm transition duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="px-4 text-center text-sm text-muted-foreground">
                            No cover available
                          </div>
                        )}
                      </div>

                      <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
                        {book.title}
                      </h3>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {book.authors.join(', ') || 'Unknown author'}
                      </p>

                      {book.categories.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {book.categories[0]}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="border-t border-border pt-8">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                A world of stories awaits
              </p>

              <h2 className="mt-3 text-2xl font-semibold">
                What will you discover?
              </h2>

              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Search for a book you've been meaning to read,
                an author you love, or a genre you'd like to explore.
              </p>
            </div>
          )}
        </section>

        <footer className="mt-20 border-t border-border pt-6 text-sm text-muted-foreground">
          {APP_NAME} · Find your next favorite read.
        </footer>
      </div>
    </main>
  )
}