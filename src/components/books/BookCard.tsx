import { useState } from 'react'
import { AuthOverlay } from 'deepspace'
import { Bookmark, BookmarkCheck, Check, Quote, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmModal, useToast } from '../ui'
import type { Book, BookStatus } from '../../lib/books'
import { STATUS_LABELS } from '../../lib/books'
import { useSavedBooks } from '../../lib/useSavedBooks'
import { BookCover } from './BookCover'

interface BookCardProps {
  book: Book
  /** Bookseller's note, shown on recommendation cards. */
  reason?: string
  showDescription?: boolean
  /** Library pages manage status inline; browse pages simply save. */
  statusControl?: boolean
  status?: BookStatus
  onStatusChange?: (status: BookStatus) => void
  onRemove?: () => void
  /** Opens the shared details dialog; omit to keep the card purely informational. */
  onOpenDetails?: (book: Book) => void
  className?: string
}

export function BookCard({
  book,
  reason,
  showDescription = false,
  statusControl = false,
  status = 'want',
  onStatusChange,
  onRemove,
  onOpenDetails,
  className,
}: BookCardProps) {
  const { isSignedIn, canWrite, isSaved, saveBook, removeBook } = useSavedBooks()
  const { success, error: notifyError } = useToast()
  const saved = isSaved(book.sourceId)
  const [authOpen, setAuthOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    if (!isSignedIn) {
      setAuthOpen(true)
      return
    }
    if (saved) {
      setConfirmRemove(true)
      return
    }
    setBusy(true)
    try {
      await saveBook(book)
      success('Saved to your library', `“${book.title}” is on your Want to Read shelf.`)
    } catch (err) {
      notifyError('Could not save this book', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await removeBook(book.sourceId)
      setConfirmRemove(false)
      success('Removed from your library', `“${book.title}” has left your shelves.`)
      onRemove?.()
    } catch (err) {
      notifyError('Could not remove this book', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const category = book.categories[0]

  return (
    <article className={cn('group flex min-w-0 flex-col', className)}>
      <div className="relative">
        {onOpenDetails ? (
          <button
            type="button"
            data-testid="book-card-details"
            aria-label={`View details for ${book.title}`}
            onClick={() => onOpenDetails(book)}
            className="block w-full rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <BookCover book={book} />
          </button>
        ) : (
          <BookCover book={book} />
        )}

        <button
          type="button"
          aria-label={saved ? `Remove ${book.title} from your library` : `Save ${book.title} to your library`}
          title={saved ? 'In your library' : 'Save to your library'}
          disabled={busy || (isSignedIn && !canWrite)}
          onClick={handleSave}
          className={cn(
            'absolute right-2 top-2 flex size-8 items-center justify-center rounded-full border shadow-sm transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
            saved
              ? 'border-sage/30 bg-sage text-white'
              : 'border-border bg-card/95 text-foreground hover:bg-primary hover:text-primary-foreground',
          )}
        >
          {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        </button>
      </div>

      <div className="mt-3 min-w-0">
        <h3 className="line-clamp-2 font-serif text-[15px] leading-snug text-foreground">
          {onOpenDetails ? (
            <button
              type="button"
              data-testid="book-card-title-details"
              onClick={() => onOpenDetails(book)}
              className="rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {book.title}
            </button>
          ) : (
            book.title
          )}
        </h3>
        <p className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {book.authors.join(', ') || 'Unknown author'}
        </p>

        {showDescription && book.description && (
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {book.description}
          </p>
        )}
        {!showDescription && category && (
          <p className="mt-1.5 truncate text-[11px] text-sage">{category}</p>
        )}

        {reason && (
          <p className="mt-3 flex gap-2 rounded-md border border-border bg-card/80 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <Quote className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
            <span className="line-clamp-4">{reason}</span>
          </p>
        )}

        {statusControl && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(['want', 'reading', 'read'] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy || !canWrite}
                onClick={() => onStatusChange?.(value)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  status === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
                )}
              >
                {status === value && <Check className="mr-1 inline size-2.5" />}
                {STATUS_LABELS[value]}
              </button>
            ))}
            <button
              type="button"
              aria-label={`Remove ${book.title} from your library`}
              title="Remove from library"
              disabled={busy || !canWrite}
              onClick={() => setConfirmRemove(true)}
              className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}

      </div>

      {authOpen && <AuthOverlay onClose={() => setAuthOpen(false)} />}
      <ConfirmModal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => void handleRemove()}
        title={`Remove “${book.title}”?`}
        description="It will disappear from your library. You can always save it again later."
        confirmText="Remove book"
        loading={busy}
      />
    </article>
  )
}
