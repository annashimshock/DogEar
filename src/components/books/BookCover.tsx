import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Book } from '../../lib/books'

interface BookCoverProps {
  book: Pick<Book, 'title' | 'authors' | 'coverUrl'>
  className?: string
}

/**
 * Cover-first presentation. A missing or broken image becomes a small
 * typographic cover rather than an empty grey box, so shelves still read as
 * books while never inventing artwork.
 */
export function BookCover({ book, className }: BookCoverProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const coverUrl = imageFailed ? null : book.coverUrl

  return (
    <div
      className={cn(
        'relative aspect-[2/3] w-full overflow-hidden rounded-sm border border-border bg-secondary shadow-[0_6px_18px_-8px_rgba(40,41,35,0.35)]',
        className,
      )}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={`Cover of ${book.title}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-between bg-gradient-to-br from-card via-secondary to-accent p-3 text-foreground">
          <div className="h-px w-8 bg-primary/60" />
          <div>
            <p className="line-clamp-4 font-serif text-[15px] leading-tight text-foreground">
              {book.title}
            </p>
            <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {book.authors[0] ?? 'Unknown author'}
            </p>
          </div>
          <span className="font-serif text-[10px] tracking-[0.2em] text-sage">dogear</span>
        </div>
      )}

      {/* A thin spine shadow gives every cover the same physical presence. */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-foreground/10" />
    </div>
  )
}
