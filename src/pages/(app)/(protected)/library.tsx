/**
 * My Library — the reader's own shelf.
 *
 * Books live in `user_books` and carry a snapshot of their Google Books data,
 * so saved covers render without another external request.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LibraryBig } from 'lucide-react'
import { BookCard } from '../../../components/books/BookCard'
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '../../../components/ui'
import {
  BOOK_STATUSES,
  STATUS_LABELS,
  type BookStatus,
} from '../../../lib/books'
import { useSavedBooks } from '../../../lib/useSavedBooks'

export default function LibraryPage() {
  const navigate = useNavigate()
  const { savedBooks, loading, setStatus } = useSavedBooks()
  const { success, error: notifyError } = useToast()
  const [tab, setTab] = useState<BookStatus>('want')

  const visible = savedBooks.filter((book) => book.status === tab)
  const total = savedBooks.length

  async function handleStatusChange(book: (typeof savedBooks)[number], next: BookStatus) {
    try {
      await setStatus(book.sourceId, next)
      success('Shelf updated', `“${book.title}” is now ${STATUS_LABELS[next].toLowerCase()}.`)
    } catch (err) {
      notifyError('Could not update this book', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              Your own little bookshop
            </p>
            <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
              My <span className="italic text-primary">Library</span>
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
              {total > 0
                ? `${total} ${total === 1 ? 'book' : 'books'} on your shelves. A good place to come back to.`
                : 'The shelf is yours. Save a book from Discover and it will wait here for you.'}
            </p>
          </div>
          <Link
            to="/home"
            className="rounded-full border border-primary px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Browse the shelves
          </Link>
        </header>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab((value as BookStatus) ?? 'want')}
          className="mt-9"
        >
          <TabsList className="h-11 w-full justify-start rounded-full bg-secondary p-1 sm:w-fit">
            {BOOK_STATUSES.map((status) => (
              <TabsTrigger
                key={status}
                value={status}
                className="flex-1 rounded-full px-4 text-[11px] font-medium uppercase tracking-[0.12em] sm:flex-none"
              >
                {STATUS_LABELS[status]}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {savedBooks.filter((book) => book.status === status).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {BOOK_STATUSES.map((status) => (
            <TabsContent key={status} value={status} className="pt-9">
              {loading ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="animate-pulse">
                      <div className="aspect-[2/3] rounded-sm bg-secondary" />
                      <div className="mt-3 h-3 w-4/5 rounded bg-secondary" />
                    </div>
                  ))}
                </div>
              ) : visible.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
                  {visible.map((book) => (
                    <BookCard
                      key={book.recordId}
                      book={book}
                      statusControl
                      status={book.status}
                      onStatusChange={(next) => void handleStatusChange(book, next)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<LibraryBig />}
                  title={
                    status === 'want'
                      ? 'Your shelf is waiting'
                      : `Nothing ${STATUS_LABELS[status].toLowerCase()} just yet`
                  }
                  description={
                    status === 'want'
                      ? 'Save a book you are curious about and it will appear here, cover and all.'
                      : `Books you move to ${STATUS_LABELS[status]} will collect on this shelf.`
                  }
                  action={{
                    label: 'Find something to read',
                    onClick: () => navigate('/home'),
                  }}
                  className="rounded-lg border border-dashed border-border bg-card/50"
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </main>
  )
}
