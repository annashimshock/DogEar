/**
 * Shared book shapes and the one client helper for the Google Books route.
 * All books shown in the UI come from /api/books/search (real Google Books
 * data) — never from local sample records.
 */

export interface Book {
  source: string
  sourceId: string
  title: string
  authors: string[]
  description: string
  categories: string[]
  publishedDate: string
  coverUrl: string | null
}

export interface SearchResponse {
  totalItems: number
  books: Book[]
  error?: string
  googleStatus?: number
  details?: string
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

/** Search Google Books through DogEar's worker route. */
export async function searchBooks(query: string, limit = 12): Promise<Book[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  const response = await fetch(`/api/books/search?${params.toString()}`)
  const data = (await response.json()) as SearchResponse

  if (!response.ok) {
    throw new Error(data.error ?? 'The shelves are unavailable right now.')
  }

  return data.books ?? []
}

/**
 * Curated shelves. Each label maps to a real Google Books query — the books
 * are fetched on page load, so a shelf never contains invented records.
 */
export const CURATED_SHELVES = [
  { id: 'stay-up', eyebrow: 'The page-turner shelf', title: 'Worth Staying Up For', query: 'bestselling thriller suspense' },
  { id: 'quiet', eyebrow: 'For slow mornings', title: 'Quietly Beautiful', query: 'literary fiction beautifully written' },
  { id: 'comfort-zone', eyebrow: 'A little further afield', title: 'A Little Out of Your Comfort Zone', query: 'speculative literary fiction translated' },
] as const

/** Mood / genre shortcuts that run a real search when clicked. */
export const BROWSE_TOPICS = [
  { label: 'Literary Fiction', query: 'literary fiction' },
  { label: 'Mystery & Crime', query: 'mystery crime fiction' },
  { label: 'Science Fiction', query: 'science fiction' },
  { label: 'Poetry', query: 'poetry collection' },
  { label: 'History', query: 'narrative history' },
  { label: 'Romance', query: 'contemporary romance' },
] as const
