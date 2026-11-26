import { useRef } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { Book } from '../../lib/books'
import { filterShelfBooks } from '../../lib/book-relevance'
import type { DiscoveryCategoryId } from '../../lib/discovery-categories'
import { BookCard } from './BookCard'

interface BookShelfProps {
  eyebrow?: string
  title: string
  books: Book[]
  reasonById?: Record<string, string>
  categoryIds?: readonly DiscoveryCategoryId[] | null
  loading?: boolean
  emptyMessage?: string
  onOpenDetails?: (book: Book) => void
}

/** A horizontally browsable shelf — the bookstore's version of a carousel. */
export function BookShelf({
  eyebrow,
  title,
  books,
  reasonById,
  categoryIds,
  loading = false,
  emptyMessage = 'This shelf is being restocked. Check back soon.',
  onOpenDetails,
}: BookShelfProps) {
  const scroller = useRef<HTMLDivElement>(null)
  // Curated shelves are default reading shelves: eligibility alone is not enough.
  const visibleBooks = filterShelfBooks(books, categoryIds)

  function scroll(direction: -1 | 1) {
    scroller.current?.scrollBy({ left: direction * 560, behavior: 'smooth' })
  }

  return (
    <section className="border-t border-border py-10 first:border-t-0 sm:py-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">
              {eyebrow}
            </p>
          )}
          <h2 className="font-serif text-2xl leading-tight text-foreground sm:text-[28px]">
            {title}
          </h2>
        </div>
        {visibleBooks.length > 0 && (
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              type="button"
              aria-label={`Scroll ${title} left`}
              onClick={() => scroll(-1)}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <ArrowLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Scroll ${title} right`}
              onClick={() => scroll(1)}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scroller}
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 [scrollbar-width:thin] sm:gap-5"
      >
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="w-32 shrink-0 snap-start sm:w-40">
                <div className="aspect-[2/3] w-full animate-pulse rounded-sm bg-secondary" />
                <div className="mt-3 h-3 w-4/5 animate-pulse rounded bg-secondary" />
                <div className="mt-2 h-2 w-3/5 animate-pulse rounded bg-secondary" />
              </div>
            ))
          : visibleBooks.map((book) => (
              <BookCard
                key={`${book.source}:${book.sourceId}`}
                book={book}
                reason={reasonById?.[book.sourceId]}
                onOpenDetails={onOpenDetails}
                className="w-32 shrink-0 snap-start sm:w-40"
              />
            ))}
      </div>

      {!loading && visibleBooks.length === 0 && (
        <p className="py-6 text-sm italic text-muted-foreground">{emptyMessage}</p>
      )}
    </section>
  )
}
