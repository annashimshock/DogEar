/**
 * Swipe discovery — one real Google Books result at a time.
 *
 * Likes are saved to the library and recorded as positive signals; passes are
 * recorded as negative signals only. Both persist in owner-scoped collections,
 * and the local undo stack reverses the exact rows written for the last swipe.
 */

import { useEffect, useRef, useState } from 'react'
import { AuthOverlay } from 'deepspace'
import { Heart, RotateCcw, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '../ui'
import { searchBooks, SWIPE_QUERIES, type Book } from '../../lib/books'
import { rankSwipeBooks } from '../../lib/swipe-ranking'
import { useBookInteractions, type SwipeAction } from '../../lib/useBookInteractions'
import { useSavedBooks } from '../../lib/useSavedBooks'
import { BookCover } from './BookCover'

const SWIPE_THRESHOLD = 110
const QUERIES_PER_STACK = 4

interface SwipeRecord {
  book: Book
  action: SwipeAction
  interactionId: string
  savedBySwipe: boolean
}

export function SwipeDiscovery() {
  const saved = useSavedBooks()
  const interactions = useBookInteractions()
  const { success, error: notifyError } = useToast()

  const [queue, setQueue] = useState<Book[]>([])
  const [position, setPosition] = useState(0)
  const [batch, setBatch] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [history, setHistory] = useState<SwipeRecord[]>([])

  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const seenWorks = useRef<Book[]>([])
  const loadedBatch = useRef(-1)

  const dataLoading = saved.loading || interactions.loading
  const excludedIds = new Set([
    ...saved.savedBooks.map((book) => book.sourceId),
    ...interactions.interactions.map((book) => book.sourceId),
  ])

  useEffect(() => {
    if (dataLoading || loadedBatch.current === batch) return
    loadedBatch.current = batch
    let cancelled = false

    async function loadStack() {
      setLoading(true)
      setError('')
      const queries = SWIPE_QUERIES.slice(batch * QUERIES_PER_STACK, (batch + 1) * QUERIES_PER_STACK)

      if (queries.length === 0) {
        setLoading(false)
        return
      }

      const results = await Promise.all(
        queries.map(async (query) => {
          try {
            return await searchBooks(query.query, 20)
          } catch {
            return [] as Book[]
          }
        }),
      )

      if (cancelled) return
      if (results.every((items) => items.length === 0)) {
        setError('Google Books could not be reached. Please try again in a moment.')
        setLoading(false)
        return
      }

      const fresh = rankSwipeBooks(
        queries.map((query, index) => ({ query, books: results[index] ?? [] })),
        {
          excludedIds,
          seenWorks: seenWorks.current,
          liked: interactions.interactions.filter((book) => book.action === 'like'),
          passed: interactions.interactions.filter((book) => book.action === 'pass'),
          saved: saved.savedBooks,
        },
      )

      // Remember every fetched edition, not only the ones shown, so a later
      // batch cannot reintroduce a duplicate work from an earlier search.
      results.flat().forEach((book) => seenWorks.current.push(book))
      if (batch === 0) {
        setQueue(fresh)
        setPosition(0)
      } else {
        setQueue((current) => [...current, ...fresh])
      }
      setLoading(false)
    }

    void loadStack()
    return () => {
      cancelled = true
    }
    // The refs above make this a one-time load per batch; the record hooks are
    // deliberately included so their first ready state can unblock the fetch.
  }, [batch, dataLoading])

  const current = queue[position]
  const remaining = Math.max(0, queue.length - position)
  const hasMoreStacks = (batch + 1) * QUERIES_PER_STACK < SWIPE_QUERIES.length
  const progress = queue.length > 0 ? Math.min(100, ((position + 1) / queue.length) * 100) : 0

  async function swipe(action: SwipeAction) {
    if (!current || busy) return
    if (!saved.isSignedIn) {
      setAuthOpen(true)
      return
    }

    setBusy(true)
    let interactionId = ''
    const alreadySaved = saved.isSaved(current.sourceId)

    try {
      interactionId = await interactions.recordSwipe(current, action)
      if (action === 'like' && !alreadySaved) await saved.saveBook(current, 'want')

      setHistory((entries) => [
        ...entries,
        { book: current, action, interactionId, savedBySwipe: !alreadySaved },
      ])
      setPosition((value) => value + 1)
      setDragX(0)
      setDragging(false)

      if (action === 'like') {
        success('Saved to your library', `“${current.title}” is on your Want to Read shelf.`)
      }
    } catch (err) {
      // Do not leave a half-swipe behind: the signal is removed if the save failed.
      if (interactionId) await interactions.undoSwipe(interactionId).catch(() => undefined)
      notifyError('Could not record that swipe', err instanceof Error ? err.message : undefined)
      setDragX(0)
      setDragging(false)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    const last = history.at(-1)
    if (!last || busy) return

    setBusy(true)
    try {
      await interactions.undoSwipe(last.interactionId)
      if (last.action === 'like' && last.savedBySwipe) await saved.removeBook(last.book.sourceId)
      setHistory((entries) => entries.slice(0, -1))
      setPosition((value) => Math.max(0, value - 1))
      setDragX(0)
      success('Swipe undone', `“${last.book.title}” is back in your stack.`)
    } catch (err) {
      notifyError('Could not undo that swipe', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (busy || !current || (event.pointerType === 'mouse' && event.button !== 0)) return
    startX.current = event.clientX
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragX(event.clientX - startX.current)
  }

  function onPointerUp() {
    if (!dragging) return
    if (dragX >= SWIPE_THRESHOLD) void swipe('like')
    else if (dragX <= -SWIPE_THRESHOLD) void swipe('pass')
    else setDragX(0)
    setDragging(false)
  }

  return (
    <section
      data-testid="swipe-discovery"
      aria-label="Swipe discovery"
      className="border-t border-border py-12 sm:py-14"
    >
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">
            <Sparkles className="size-3" aria-hidden /> The browsing table
          </p>
          <h2 className="font-serif text-2xl leading-tight text-foreground sm:text-[28px]">
            A book for whatever you are feeling
          </h2>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">
            Swipe right to keep it, left to pass. We remember both — and use them
            to make the next shelf feel like yours.
          </p>
        </div>
        {!loading && queue.length > 0 && (
          <div className="min-w-32 flex-1 sm:max-w-52">
            <div className="mb-1.5 flex justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>{position + 1} of {queue.length}</span>
              <span>{remaining} left</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto flex max-w-xl flex-col items-center">
        {loading ? (
          <div className="w-full animate-pulse">
            <div className="aspect-[2/3] w-full rounded-sm bg-secondary" />
            <div className="mx-auto mt-5 h-4 w-3/5 rounded bg-secondary" />
            <div className="mx-auto mt-2 h-3 w-2/5 rounded bg-secondary" />
          </div>
        ) : error ? (
          <div data-testid="swipe-error" className="w-full rounded-lg border border-destructive/30 bg-card px-6 py-12 text-center">
            <p className="font-serif text-lg text-foreground">The stack is temporarily unavailable.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => {
                loadedBatch.current = -1
                setQueue([])
                setBatch(0)
              }}
              className="mt-5 rounded-full border border-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:bg-primary hover:text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : current ? (
          <>
            <div
              data-testid="swipe-card"
              className="relative w-full touch-pan-y select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                setDragX(0)
                setDragging(false)
              }}
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            >
              <div
                className={cn(
                  'relative rounded-md bg-card p-4 shadow-[0_24px_50px_-28px_rgba(40,41,35,0.45)] transition-transform',
                  dragging ? 'duration-75' : 'duration-300 ease-out',
                )}
                style={{
                  transform: `translateX(${dragX}px) rotate(${dragX / 24}deg)`,
                  opacity: Math.max(0.6, 1 - Math.abs(dragX) / 600),
                }}
              >
                <div className={cn('mx-auto w-56 sm:w-64', 'group')}>
                  <BookCover book={current} />
                </div>
                <div className="mx-auto mt-5 max-w-md text-center">
                  <h3 className="font-serif text-2xl leading-tight text-foreground">{current.title}</h3>
                  <p className="mt-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {current.authors.join(', ') || 'Unknown author'}
                  </p>
                  {current.description && (
                    <p className="mx-auto mt-3 line-clamp-3 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                      {current.description}
                    </p>
                  )}
                </div>

                <span
                  aria-hidden
                  className={cn(
                    'absolute left-5 top-5 rounded-md border-2 border-sage bg-card/95 px-3 py-1 font-serif text-lg tracking-wide text-sage transition-opacity',
                    dragX > 40 ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  Keep
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-5 top-5 rounded-md border-2 border-destructive bg-card/95 px-3 py-1 font-serif text-lg tracking-wide text-destructive transition-opacity',
                    dragX < -40 ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  Pass
                </span>
              </div>
            </div>

            <div className="mt-7 flex items-center justify-center gap-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void swipe('pass')}
                data-testid="swipe-pass"
                aria-label={`Pass on ${current.title}`}
                className="flex size-14 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-all hover:border-destructive hover:text-destructive hover:shadow-md disabled:opacity-50"
              >
                <X className="size-6" />
              </button>
              <button
                type="button"
                disabled={busy || history.length === 0}
                onClick={() => void undo()}
                data-testid="swipe-undo"
                aria-label="Undo last swipe"
                title="Undo last swipe"
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void swipe('like')}
                data-testid="swipe-like"
                aria-label={`Save ${current.title} to your library`}
                className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-all hover:brightness-110 hover:shadow-md disabled:opacity-50"
              >
                <Heart className="size-6" />
              </button>
            </div>
            <p className="mt-3 text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Drag the card or use the buttons · Undo reverses the last swipe
            </p>
          </>
        ) : (
          <div data-testid="swipe-empty" className="w-full rounded-lg border border-dashed border-border bg-card/60 px-6 py-14 text-center">
            <p className="font-serif text-xl italic text-foreground">
              That is the whole stack, for now.
            </p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Your likes and passes are safely noted. Come back later, or pull a
              fresh stack from another corner of the catalogue.
            </p>
            {hasMoreStacks ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => setBatch((value) => value + 1)}
                className="mt-6 rounded-full border border-primary px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                Bring me another stack
              </button>
            ) : (
              <p className="mt-5 text-[11px] uppercase tracking-[0.14em] text-sage">
                You have browsed every shelf we brought out today.
              </p>
            )}
          </div>
        )}
      </div>

      {authOpen && <AuthOverlay onClose={() => setAuthOpen(false)} />}
    </section>
  )
}
