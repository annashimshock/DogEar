/**
 * Shared book shapes and the one client helper for the Google Books route.
 * All books shown in the UI come from /api/books/search (real Google Books
 * data) — never from local sample records.
 */

import { filterEligibleBooks } from './book-eligibility'
import { filterShelfBooks, intentFromText, type RelevanceIntent } from './book-relevance'
import {
  DEFAULT_DISCOVERY_CATEGORY_IDS,
  discoveryCategoryQueries,
  normalizeDiscoveryCategoryIds,
  type DiscoveryCategoryId,
} from './discovery-categories'
import { isSameWork } from './swipe-ranking'

export interface Book {
  source: string
  sourceId: string
  title: string
  authors: string[]
  description: string
  categories: string[]
  publishedDate: string
  coverUrl: string | null
  /** Reader engagement from Google Books. Absent when Google has no data. */
  averageRating?: number
  ratingsCount?: number
  publisher?: string
  language?: string
  pageCount?: number
  /** Absolute position in the original Google Books result list, before filtering. */
  googleResultIndex?: number
  /** Extra Google Books fields used only to recognize serials and course material. */
  subtitle?: string
  printType?: string
  mainCategory?: string
  industryIdentifiers?: { type: string; identifier: string }[]
}

export interface SearchResponse {
  totalItems: number
  eligibleCount?: number
  relevantCount?: number
  books: Book[]
  error?: string
  googleStatus?: number
  details?: string
}

/** Query intent used by the swipe ranking, from front table to discovery. */
export type SwipeShelf = 'front-table' | 'popular' | 'genre' | 'discovery'

export interface SwipeQuery {
  query: string
  shelf: SwipeShelf
  weight: number
  /** Exact titles the query is meant to find; Google also returns fuzzy matches. */
  targets?: readonly string[]
  /** The reader-selected shelf this query serves, when it came from preferences. */
  categoryId?: DiscoveryCategoryId
}

export interface SavedBook extends Book {
  recordId: string
  status: BookStatus
  notes: string
}

export const BOOK_STATUSES = ['want', 'reading', 'read'] as const
export type BookStatus = (typeof BOOK_STATUSES)[number]

export const STATUS_LABELS: Record<BookStatus, string> = {
  want: 'Want to Read',
  reading: 'Currently Reading',
  read: 'Read',
}

/** Stable identity for a book across search, library and recommendations. */
export function bookId(book: Book): string {
  return `${book.source}:${book.sourceId}`
}

export interface SearchOutcome {
  ok: boolean
  books: Book[]
  /** Raw Google Books count, before client-side filtering. */
  totalItems: number
  /** How many raw records survived the standalone-publication gate. */
  eligibleCount: number
  /** How many records survived relevance and the active category gate. */
  relevantCount: number
  error?: string
}

/**
 * Search Google Books through DogEar's worker route.
 *
 * The worker is the authoritative eligibility gate, but every client boundary
 * filters again so a stale, cached or hand-edited response can never render a
 * journal, course pack or catalog-only record as a book.
 */
export async function searchBooksDetailed(
  query: string,
  limit = 12,
  startIndex = 0,
  intent?: RelevanceIntent,
  categoryIds?: readonly DiscoveryCategoryId[] | null,
): Promise<SearchOutcome> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (startIndex > 0) params.set('startIndex', String(startIndex))
  if (categoryIds === null) params.set('categories', 'all')
  else if (categoryIds !== undefined) params.set('categories', categoryIds.join(','))
  const relevance = intent ?? intentFromText(query)
  // An omitted argument still enforces the balanced default shelves; only an
  // explicit null (used by literary-studies requests) lifts the category gate.
  const activeCategoryIds = categoryIds === undefined ? DEFAULT_DISCOVERY_CATEGORY_IDS : categoryIds

  try {
    const response = await fetch(`/api/books/search?${params.toString()}`)
    const data = (await response.json()) as SearchResponse
    if (!response.ok) {
      return {
        ok: false,
        books: [],
        totalItems: 0,
        eligibleCount: 0,
        relevantCount: 0,
        error: data.error ?? 'The shelves are unavailable right now.',
      }
    }

    const raw = data.books ?? []
    const eligible = filterEligibleBooks(raw)
    // Defensive client boundary: even a cached or hand-edited response cannot
    // put books about literary analysis or outside the active shelves here.
    const books = filterShelfBooks(raw, activeCategoryIds, relevance)
    return {
      ok: true,
      books,
      totalItems: data.totalItems ?? raw.length,
      eligibleCount: data.eligibleCount ?? eligible.length,
      relevantCount: books.length,
    }
  } catch (error) {
    return {
      ok: false,
      books: [],
      totalItems: 0,
      eligibleCount: 0,
      relevantCount: 0,
      error: error instanceof Error ? error.message : 'The shelves are unavailable right now.',
    }
  }
}

export async function searchBooks(
  query: string,
  limit = 12,
  intent?: RelevanceIntent,
  categoryIds?: readonly DiscoveryCategoryId[] | null,
): Promise<Book[]> {
  const result = await searchBooksDetailed(query, limit, 0, intent, categoryIds)
  if (!result.ok) throw new Error(result.error)
  return result.books
}

/**
 * Curated shelves. Each label maps to a real Google Books query — the books
 * are fetched on page load, so a shelf never contains invented records.
 */
export const CURATED_SHELVES = [
  {
    id: 'stay-up',
    eyebrow: 'The page-turner shelf',
    title: 'Worth Staying Up For',
    query: 'bestselling thriller suspense novels',
  },
  {
    id: 'quiet',
    eyebrow: 'For slow mornings',
    title: 'Quietly Beautiful',
    query: 'literary fiction novels friendship family',
  },
  {
    id: 'comfort-zone',
    eyebrow: 'A little further afield',
    title: 'A Little Out of Your Comfort Zone',
    query: 'speculative science fiction fantasy novels',
  },
  {
    id: 'fantasy',
    eyebrow: 'For other worlds',
    title: 'Fantasy, Properly Shelved',
    query: 'epic fantasy novels magic adventure',
  },
  {
    id: 'poetry',
    eyebrow: 'A few poems',
    title: 'Poetry Collections',
    query: 'poetry collection poems',
  },
] as const

/** Discover pages are narrow, bounded and never request the same offset twice. */
export const DISCOVERY_RESULTS_PER_PAGE = 12
export const DISCOVERY_MAX_PAGES = 3
export const DISCOVERY_SHELF_SIZE = 8
export const DISCOVERY_SEARCH_SIZE = 24

/**
 * Fill a Discover shelf or result grid from successive Google Books pages.
 * Ineligible, off-category and duplicate works are skipped; if too few survive
 * we continue to the next page instead of loosening any gate.
 */
export async function searchDiscoveryBooks(
  query: string,
  categoryIds: readonly DiscoveryCategoryId[] | null,
  target = DISCOVERY_SHELF_SIZE,
): Promise<Book[]> {
  const books: Book[] = []

  for (let page = 0; page < DISCOVERY_MAX_PAGES && books.length < target; page += 1) {
    const startIndex = page * DISCOVERY_RESULTS_PER_PAGE
    const result = await searchBooksDetailed(
      query,
      DISCOVERY_RESULTS_PER_PAGE,
      startIndex,
      undefined,
      categoryIds,
    )
    if (!result.ok) {
      if (page === 0) throw new Error(result.error)
      break
    }

    for (const book of result.books) {
      if (books.some((existing) => existing.sourceId === book.sourceId || isSameWork(existing, book))) {
        continue
      }
      books.push(book)
      if (books.length >= target) break
    }

    if (result.totalItems > 0 && startIndex + DISCOVERY_RESULTS_PER_PAGE >= result.totalItems) break
  }

  return books.slice(0, target)
}

/** Four catalogue queries make one swipe stack. */
export const QUERIES_PER_STACK = 4
/** Google Books results requested per query, before filtering and dedupe. */
export const SWIPE_RESULTS_PER_QUERY = 20
/** Number of result pages to page through before calling the catalogue exhausted. */
export const SWIPE_STACK_PAGES = 3

/**
 * Every swipe query comes from a reader-selected shelf. The fallback set is
 * used only before a first-run preference row exists; it is still made of the
 * same explicit reading categories, never broad "literature" or "books"
 * searches.
 */
export function buildSwipeQueries(
  categoryIds: readonly DiscoveryCategoryId[] = DEFAULT_DISCOVERY_CATEGORY_IDS,
): readonly SwipeQuery[] {
  const selected = normalizeDiscoveryCategoryIds(categoryIds)
  const ids = selected.length > 0 ? selected : DEFAULT_DISCOVERY_CATEGORY_IDS
  return ids.flatMap((categoryId, categoryIndex) =>
    discoveryCategoryQueries(categoryId).map((query, variant) => ({
      query,
      shelf: 'genre' as const,
      // Equal weights across shelves stop a category with more Google results
      // from taking over the deck merely because it returned more records.
      weight: 1 - Math.min(0.03, variant * 0.015) - (categoryIndex % 4) * 0.005,
      categoryId,
    })),
  )
}

function coprimeStep(size: number, target: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
  let candidate = Math.max(1, Math.floor(target))
  while (gcd(candidate, size) !== 1) candidate += 1
  return candidate
}

export interface SwipeQueryBatch {
  queries: readonly SwipeQuery[]
  startIndex: number
  page: number
  hasMorePages: boolean
}

/**
 * Choose four category searches at a time, spread across the reader's shelves.
 * A reader who chose only Fantasy and Mystery gets only those two shelves; a
 * reader who chose sixteen gets a rotating sample instead of four adjacent
 * categories. Later stacks reuse the same searches at deeper result offsets.
 */
export function swipeQueryBatch(
  batch: number,
  categoryIds: readonly DiscoveryCategoryId[] = DEFAULT_DISCOVERY_CATEGORY_IDS,
): SwipeQueryBatch {
  const safeBatch = Number.isFinite(batch) ? Math.max(0, Math.floor(batch)) : 0
  const selected = normalizeDiscoveryCategoryIds(categoryIds)
  const ids = selected.length > 0 ? selected : DEFAULT_DISCOVERY_CATEGORY_IDS
  const allQueries = buildSwipeQueries(ids)
  const stacksPerPage = Math.max(1, Math.ceil(allQueries.length / QUERIES_PER_STACK))
  const page = Math.floor(safeBatch / stacksPerPage)
  const offset = (safeBatch % stacksPerPage) * QUERIES_PER_STACK
  const step = coprimeStep(ids.length, Math.max(1, Math.floor(ids.length / QUERIES_PER_STACK)))

  const queries: SwipeQuery[] = []
  for (let slot = 0; slot < QUERIES_PER_STACK; slot += 1) {
    const globalSlot = offset + slot
    const categoryIndex = ((globalSlot % ids.length) * step) % ids.length
    const categoryId = ids[categoryIndex]
    const variant = Math.floor(globalSlot / ids.length) % discoveryCategoryQueries(categoryId).length
    const query = discoveryCategoryQueries(categoryId)[variant]
    const definition = allQueries.find(
      (entry) => entry.categoryId === categoryId && entry.query === query,
    )
    if (definition) queries.push(definition)
  }

  return {
    queries,
    startIndex: page * SWIPE_RESULTS_PER_QUERY,
    page,
    hasMorePages: page + 1 < SWIPE_STACK_PAGES,
  }
}

/** Mood / genre shortcuts that run a real search when clicked. */
export const BROWSE_TOPICS = [
  { label: 'Literary Fiction', query: 'literary fiction novels' },
  { label: 'Mystery & Crime', query: 'mystery crime novels' },
  { label: 'Science Fiction', query: 'science fiction novels' },
  { label: 'Poetry', query: 'poetry collection poems' },
  { label: 'History', query: 'narrative history books' },
  { label: 'Romance', query: 'contemporary romance novels' },
] as const
