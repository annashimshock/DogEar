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
import {
  searchBooksDetailed,
  swipeQueryBatch,
  SWIPE_RESULTS_PER_QUERY,
  type Book,
} from '../../lib/books'
import { applySwipeBatch, type SwipeQueryResults, type SwipeQueueState } from '../../lib/swipe-ranking'
import { swipeProgress } from '../../lib/swipe-progress'
import { useBookInteractions, type SwipeAction } from '../../lib/useBookInteractions'
import { useSavedBooks } from '../../lib/useSavedBooks'
import { useDiscoveryPreferences } from '../../lib/useDiscoveryPreferences'
import { BookCover } from './BookCover'
import { useBookDetails } from './BookDetailsContext'

const SWIPE_THRESHOLD = 110

interface SwipeRecord {
  book: Book
  action: SwipeAction
  interactionId: string
  savedBySwipe: boolean
}

export function SwipeDiscovery() {
  const saved = useSavedBooks()
  const interactions = useBookInteractions()
  const preferences = useDiscoveryPreferences()
  const categoryIds = preferences.effectiveCategoryIds
  const categoryKey = categoryIds.join('|')
  const { success, error: notifyError } = useToast()
  const { openDetails } = useBookDetails()

  const [queue, setQueue] = useState<Book[]>([])
  const [completed, setCompleted] = useState(0)
  const [batch, setBatch] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stackNotice, setStackNotice] = useState('')
  const [catalogueExhausted, setCatalogueExhausted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [history, setHistory] = useState<SwipeRecord[]>([])

  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const pressedDetails = useRef(false)
  const dragged = useRef(false)

  // The queue and its fetched-work registry are committed together, so two
  // batch requests finishing out of order cannot append the same work twice.
  const queueState = useRef<SwipeQueueState>({ queue: [], seenWorks: [] })
  const pendingBatches = useRef(new Map<number, Promise<void>>())
  const activeLoads = useRef(0)
  const mounted = useRef(true)
  const resetToken = useRef(0)

  const dataLoading = saved.loading || interactions.loading || preferences.loading
  const excludedIds = new Set([
    ...saved.savedBooks.map((book) => book.sourceId),
    ...interactions.interactions.map((book) => book.sourceId),
  ])
  const latestProfile = useRef({
    excludedIds,
    liked: [] as Book[],
    passed: [] as Book[],
    saved: [] as Book[],
  })
  latestProfile.current = {
    excludedIds,
    liked: interactions.interactions.filter((book) => book.action === 'like'),
    passed: interactions.interactions.filter((book) => book.action === 'pass'),
    saved: saved.savedBooks,
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A preference change should produce a deck for the new shelves, not append
  // to a queue fetched for the old ones.
  useEffect(() => {
    queueState.current = { queue: [], seenWorks: [] }
    pendingBatches.current.clear()
    resetToken.current += 1
    setQueue([])
    setCompleted(0)
    setBatch(0)
    setHistory([])
    setCatalogueExhausted(false)
    setError('')
    setStackNotice('')
  }, [categoryKey])

  const queryBatch = swipeQueryBatch(batch, categoryIds)

  useEffect(() => {
    if (dataLoading || preferences.needsOnboarding) return

    // Reuse an in-flight request instead of firing a second copy for the same
    // batch when a record hook briefly flips its loading state.
    let request = pendingBatches.current.get(batch)
    if (!request) {
      const token = resetToken.current
      request = (async () => {
        activeLoads.current += 1
        setLoading(true)
        setError('')
        setStackNotice('')
        setCatalogueExhausted(false)

        try {
          const { queries, startIndex } = swipeQueryBatch(batch, categoryIds)
          if (queries.length === 0) return

          const outcomes = await Promise.all(
            queries.map(async (query) => ({
              query,
              outcome: await searchBooksDetailed(
                query.query,
                SWIPE_RESULTS_PER_QUERY,
                startIndex,
                undefined,
                categoryIds,
              ),
            })),
          )

          if (!mounted.current || token !== resetToken.current) return

          const failed = outcomes.filter(({ outcome }) => !outcome.ok)
          if (failed.length === outcomes.length) {
            setError('Google Books could not be reached. Please try again in a moment.')
            return
          }

          const rawCount = outcomes.reduce((sum, { outcome }) => sum + outcome.totalItems, 0)
          const eligibleCount = outcomes.reduce(
            (sum, { outcome }) => sum + outcome.eligibleCount,
            0,
          )
          const relevantCount = outcomes.reduce(
            (sum, { outcome }) => sum + outcome.relevantCount,
            0,
          )
          const categoryCount = outcomes.reduce(
            (sum, { outcome }) => sum + outcome.books.length,
            0,
          )
          const fetched: SwipeQueryResults[] = outcomes.map(({ query, outcome }) => ({
            query,
            books: outcome.books,
          }))
          const previousCount = queueState.current.queue.length
          const profile = latestProfile.current
          const next = applySwipeBatch(queueState.current, fetched, {
            excludedIds: profile.excludedIds,
            liked: profile.liked,
            passed: profile.passed,
            saved: profile.saved,
            categoryIds,
          })
          queueState.current = next
          setQueue(next.queue)
          setCompleted((value) => Math.min(value, next.queue.length))
          if (batch === 0 && previousCount === 0) setCompleted(0)

          const freshCount = next.queue.length - previousCount
          if (freshCount === 0) {
            if (failed.length > 0) {
              setStackNotice(
                'Some shelves could not be reached. Try this stack again in a moment.',
              )
            } else if (rawCount === 0) {
              setStackNotice('No books matched this part of the catalogue.')
            } else if (eligibleCount === 0) {
              setStackNotice(
                'Google Books returned only journals, course material or incomplete records here.',
              )
            } else if (relevantCount === 0) {
              setStackNotice('Google Books returned eligible records here, but none fit a reading shelf.')
            } else if (categoryCount === 0) {
              setStackNotice('These records did not match the shelves you chose, so we left them out.')
            } else {
              setStackNotice('Every eligible book here is already in your stack or library.')
            }
          }

          // A strict category gate can leave a page nearly empty. Move to a
          // different query/page instead of filling the stack with unrelated
          // books or repeatedly requesting the same result window.
          if (
            queryBatch.hasMorePages &&
            failed.length === 0 &&
            rawCount > 0 &&
            freshCount < 3 &&
            mounted.current
          ) {
            setCatalogueExhausted(false)
            setBatch((value) => value + 1)
          } else {
            setCatalogueExhausted(!queryBatch.hasMorePages && failed.length === 0)
          }
        } finally {
          activeLoads.current = Math.max(0, activeLoads.current - 1)
          if (mounted.current && activeLoads.current === 0) setLoading(false)
        }
      })()
      pendingBatches.current.set(batch, request)
      void request
        .catch(() => undefined)
        .finally(() => {
          if (pendingBatches.current.get(batch) === request) pendingBatches.current.delete(batch)
        })
    }
    // The record hooks are deliberately included so their first ready state can
    // unblock the fetch; pendingBatches prevents a duplicate request.
  }, [batch, categoryKey, dataLoading, preferences.needsOnboarding, retryCount])

  // The visible card is not completed yet; it is one of the remaining books.
  const progress = swipeProgress(queue.length, completed)
  const current = queue[progress.completed]
  const hasMoreStacks = queryBatch.hasMorePages && !catalogueExhausted

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
      setCompleted((value) => value + 1)
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
      setCompleted((value) => Math.max(0, value - 1))
      setDragX(0)
      success('Swipe undone', `“${last.book.title}” is back in your stack.`)
    } catch (err) {
      notifyError('Could not undo that swipe', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  function showDetails() {
    if (!current || busy || dragged.current) return
    // The shared provider renders this dialog outside the pointer-capture
    // surface, so clicks inside it cannot advance or undo the swipe stack.
    openDetails(current)
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (busy || !current || (event.pointerType === 'mouse' && event.button !== 0)) return
    startX.current = event.clientX
    dragged.current = false
    pressedDetails.current = Boolean(
      (event.target as HTMLElement).closest('[data-testid="book-details-open"]'),
    )
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const next = event.clientX - startX.current
    if (Math.abs(next) > 8) dragged.current = true
    setDragX(next)
  }

  function onPointerUp() {
    if (!dragging) return
    if (dragX >= SWIPE_THRESHOLD) void swipe('like')
    else if (dragX <= -SWIPE_THRESHOLD) void swipe('pass')
    else setDragX(0)
    setDragging(false)
  }

  // Pointer capture retargets the click to the swipe surface, so the press
  // target recorded above is what tells us a tap meant "open details".
  function onCardClick(event: React.MouseEvent<HTMLDivElement>) {
    const onDetailsTrigger = Boolean(
      (event.target as HTMLElement).closest('[data-testid="book-details-open"]'),
    )
    if ((pressedDetails.current || onDetailsTrigger) && !dragged.current) showDetails()
    pressedDetails.current = false
    dragged.current = false
  }

  if (preferences.needsOnboarding) {
    return (
      <section
        data-testid="swipe-discovery"
        aria-label="Swipe discovery"
        className="border-t border-border py-12 sm:py-14"
      >
        <p className="font-serif text-xl text-foreground">Choose a few shelves first.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your first swipe deck is built from the categories you pick.
        </p>
      </section>
    )
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
              <span>{progress.completed} of {progress.total}</span>
              <span>{progress.remaining} left</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${progress.percent}%` }}
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
                // Retry this batch in place: a failed page must not throw away
                // cards the reader has already swiped.
                resetToken.current += 1
                pendingBatches.current.delete(batch)
                setError('')
                setStackNotice('')
                setCatalogueExhausted(false)
                setRetryCount((value) => value + 1)
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
                pressedDetails.current = false
                dragged.current = false
              }}
              onClick={onCardClick}
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
                <button
                  type="button"
                  data-testid="book-details-open"
                  aria-label={`View details for ${current.title}`}
                  className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    <span className="mt-4 inline-block text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                      Read full details →
                    </span>
                  </div>
                </button>

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
              {hasMoreStacks ? 'That is the end of this stack.' : 'That is the whole stack, for now.'}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {stackNotice ||
                'Your likes and passes are safely noted. Come back later, or pull a fresh stack from another corner of the catalogue.'}
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
