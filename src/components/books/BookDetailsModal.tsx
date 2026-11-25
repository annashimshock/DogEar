/**
 * Book details for a swipe card. Google Books data only: every field shown
 * here is already on the Book record, including the untruncated description.
 */

import { useState } from 'react'
import { AuthOverlay } from 'deepspace'
import { Check, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogClose, DialogContent, DialogTitle, useToast } from '../ui'
import { STATUS_LABELS, type Book, type BookStatus } from '../../lib/books'
import { useSavedBooks } from '../../lib/useSavedBooks'
import { BookCover } from './BookCover'

const SHELVES: readonly BookStatus[] = ['want', 'reading', 'read']

interface BookDetailsModalProps {
  book: Book | null
  open: boolean
  onClose: () => void
}

/** Google descriptions often contain light markup; keep all of the text. */
function readableDescription(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function publishedDate(value: string): string {
  const parts = value.split('-').filter(Boolean)
  if (parts.length === 0) return 'Not listed'
  if (parts.length === 1) return parts[0]

  const year = Number(parts[0])
  const month = Number(parts[1]) - 1
  const day = parts[2] ? Number(parts[2]) : undefined
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return value

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    ...(day && day >= 1 && day <= 31 ? { day: 'numeric' } : {}),
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month, day ?? 1)))
}

interface DetailProps {
  label: string
  value: string
  testId?: string
}

function Detail({ label, value, testId }: DetailProps) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sage">{label}</dt>
      <dd data-testid={testId} className="mt-1 text-[13px] leading-snug text-foreground">
        {value}
      </dd>
    </div>
  )
}

export function BookDetailsModal({ book, open, onClose }: BookDetailsModalProps) {
  const saved = useSavedBooks()
  const { success, error: notifyError } = useToast()
  const [authOpen, setAuthOpen] = useState(false)
  const [pendingShelf, setPendingShelf] = useState<BookStatus | null>(null)
  const [confirmation, setConfirmation] = useState('')

  if (!book) return null
  const currentBook = book

  const savedBook = saved.savedBooks.find((item) => item.sourceId === book.sourceId)
  const currentShelf = savedBook?.status
  const description = readableDescription(book.description)
  const feedback = confirmation.startsWith(`“${book.title}”`) ? confirmation : ''
  const rating =
    typeof book.averageRating === 'number' && Number.isFinite(book.averageRating)
      ? book.averageRating
      : undefined
  const ratingsCount =
    typeof book.ratingsCount === 'number' && Number.isFinite(book.ratingsCount)
      ? book.ratingsCount
      : undefined

  async function chooseShelf(shelf: BookStatus) {
    if (!saved.isSignedIn) {
      setAuthOpen(true)
      return
    }

    setPendingShelf(shelf)
    try {
      // saveBook creates the row when needed and updates the status when it
      // already exists, so one path covers both shelves.
      await saved.saveBook(currentBook, shelf)
      const message = `“${currentBook.title}” is on your ${STATUS_LABELS[shelf].toLowerCase()} shelf.`
      setConfirmation(message)
      success(savedBook ? 'Library updated' : 'Saved to your library', message)
    } catch (err) {
      notifyError('Could not update your library', err instanceof Error ? err.message : undefined)
    } finally {
      setPendingShelf(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        hideClose
        data-testid="book-details-modal"
        aria-describedby={undefined}
        className={cn(
          'fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none',
          'translate-x-0 translate-y-0 overscroll-contain',
          'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[88vh] sm:w-full sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:p-0 sm:shadow-[0_24px_70px_-24px_rgba(40,41,35,0.5)]',
        )}
      >
        <DialogClose
          data-testid="book-details-close"
          aria-label="Close book details"
          className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-5 sm:top-5"
        >
          <X className="size-4" />
        </DialogClose>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-5 pb-8 pt-14 sm:px-8 sm:pb-9 sm:pt-12">
            <div className="grid gap-8 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-9">
              <div className="mx-auto w-40 sm:mx-0 sm:w-full">
                <BookCover book={book} />
                <p className="mt-3 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-left">
                  Google Books cover
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                  From the browsing table
                </p>
                <DialogTitle
                  data-testid="book-details-title"
                  className="mt-2 font-serif text-3xl leading-[1.12] tracking-tight text-foreground sm:text-[38px]"
                >
                  {book.title}
                </DialogTitle>
                <p data-testid="book-details-authors" className="mt-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {book.authors.join(', ') || 'Unknown author'}
                </p>

                {rating !== undefined && (
                  <div
                    data-testid="book-details-rating"
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs text-foreground"
                  >
                    <Star className="size-3.5 fill-primary text-primary" aria-hidden />
                    <span className="font-medium">{rating.toFixed(1)}</span>
                    {ratingsCount !== undefined && (
                      <span className="text-muted-foreground">
                        · {ratingsCount.toLocaleString()} {ratingsCount === 1 ? 'rating' : 'ratings'}
                      </span>
                    )}
                  </div>
                )}

                <dl
                  data-testid="book-details-metadata"
                  className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-y border-border py-4 sm:grid-cols-3"
                >
                  <Detail label="Published" value={publishedDate(book.publishedDate)} testId="book-details-published" />
                  <Detail label="Publisher" value={book.publisher || 'Not listed'} testId="book-details-publisher" />
                  <Detail
                    label="Pages"
                    value={book.pageCount && book.pageCount > 0 ? String(book.pageCount) : 'Not listed'}
                    testId="book-details-pages"
                  />
                  <Detail
                    label="Categories"
                    value={book.categories.join(' · ') || 'Not listed'}
                    testId="book-details-categories"
                  />
                  <Detail label="Language" value={book.language || 'Not listed'} testId="book-details-language" />
                </dl>

                <section className="mt-6" aria-labelledby="book-details-about-heading">
                  <h3
                    id="book-details-about-heading"
                    className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sage"
                  >
                    About this book
                  </h3>
                  <p
                    data-testid="book-details-description"
                    className="mt-3 whitespace-pre-line text-[13px] leading-7 text-muted-foreground sm:text-sm"
                  >
                    {description || 'Google Books does not provide a description for this title.'}
                  </p>
                </section>
              </div>
            </div>

            <section
              data-testid="book-details-library"
              aria-labelledby="book-details-shelf-heading"
              className="mt-8 border-t border-border pt-6 sm:mt-10"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                    Your shelves
                  </p>
                  <h3 id="book-details-shelf-heading" className="mt-1 font-serif text-xl text-foreground">
                    Keep this one close
                  </h3>
                </div>
                <div>
                  <p
                    data-testid="book-details-current-status"
                    className="text-[11px] text-muted-foreground"
                  >
                    {currentShelf
                      ? `On your ${STATUS_LABELS[currentShelf].toLowerCase()} shelf.`
                      : saved.isSignedIn
                        ? 'Choose a shelf below.'
                        : 'Sign in to add this book to your library.'}
                  </p>
                  {feedback && (
                    <p
                      data-testid="book-details-feedback"
                      role="status"
                      className="mt-1 text-[11px] font-medium text-sage"
                    >
                      {feedback}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {SHELVES.map((shelf) => {
                  const selected = currentShelf === shelf
                  return (
                    <button
                      key={shelf}
                      type="button"
                      data-testid={`book-details-status-${shelf}`}
                      aria-pressed={selected}
                      disabled={pendingShelf !== null || (saved.isSignedIn && !saved.canWrite)}
                      onClick={() => void chooseShelf(shelf)}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:border-primary hover:text-primary',
                      )}
                    >
                      {selected && <Check className="size-3.5" aria-hidden />}
                      {STATUS_LABELS[shelf]}
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
      </DialogContent>

      {authOpen && <AuthOverlay onClose={() => setAuthOpen(false)} />}
    </Dialog>
  )
}
