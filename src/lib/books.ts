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
  /** Reader engagement from Google Books. Absent when Google has no data. */
  averageRating?: number
  ratingsCount?: number
  publisher?: string
  language?: string
  pageCount?: number
}

export interface SearchResponse {
  totalItems: number
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

/**
 * Real catalogue queries used to build swipe stacks. The first four are the
 * front table: title-level searches for books people actually recognize. Later
 * batches widen into genres and accessible nonfiction, but still let ranking
 * promote reader engagement over raw Google relevance.
 */
export const SWIPE_QUERIES: readonly SwipeQuery[] = [
  {
    query:
      'intitle:"Tomorrow, and Tomorrow, and Tomorrow" OR intitle:"Project Hail Mary" OR intitle:"Pachinko" OR intitle:"Circe" OR intitle:"The Song of Achilles"',
    shelf: 'front-table',
    weight: 1.3,
    targets: [
      'Tomorrow, and Tomorrow, and Tomorrow',
      'Project Hail Mary',
      'Pachinko',
      'Circe',
      'The Song of Achilles',
    ],
  },
  {
    query:
      'intitle:"The Thursday Murder Club" OR intitle:"The Seven Husbands of Evelyn Hugo" OR intitle:"Klara and the Sun" OR intitle:"The Midnight Library" OR intitle:"Where the Crawdads Sing"',
    shelf: 'front-table',
    weight: 1.25,
    targets: [
      'The Thursday Murder Club',
      'The Seven Husbands of Evelyn Hugo',
      'Klara and the Sun',
      'The Midnight Library',
      'Where the Crawdads Sing',
    ],
  },
  {
    query:
      'intitle:"Educated" OR intitle:"Braiding Sweetgrass" OR intitle:"The Warmth of Other Suns" OR intitle:"Just Kids" OR intitle:"Sapiens"',
    shelf: 'front-table',
    weight: 1.15,
    targets: ['Educated', 'Braiding Sweetgrass', 'The Warmth of Other Suns', 'Just Kids', 'Sapiens'],
  },
  {
    query:
      'intitle:"The Last Thing He Told Me" OR intitle:"The Paper Palace" OR intitle:"American Dirt" OR intitle:"Big Little Lies" OR intitle:"The Silent Patient"',
    shelf: 'front-table',
    weight: 1.1,
    targets: [
      'The Last Thing He Told Me',
      'The Paper Palace',
      'American Dirt',
      'Big Little Lies',
      'The Silent Patient',
    ],
  },
  { query: 'subject:Literary Fiction -intitle:textbook -intitle:workbook -intitle:guide', shelf: 'genre', weight: 1 },
  { query: 'subject:Fantasy -intitle:guide -intitle:textbook -intitle:manual', shelf: 'genre', weight: 0.98 },
  { query: 'subject:Science Fiction -intitle:guide -intitle:textbook -intitle:manual', shelf: 'genre', weight: 0.96 },
  { query: 'subject:Thrillers suspense -intitle:guide -intitle:textbook -intitle:manual', shelf: 'genre', weight: 0.95 },
  { query: 'subject:Romance Fiction -intitle:guide -intitle:textbook -intitle:manual', shelf: 'genre', weight: 0.94 },
  { query: 'subject:Detective and mystery stories -intitle:guide -intitle:textbook', shelf: 'genre', weight: 0.92 },
  {
    query: 'subject:Biography & Autobiography -intitle:guide -intitle:textbook -intitle:writing',
    shelf: 'discovery',
    weight: 0.9,
  },
  {
    query: 'subject:History -intitle:guide -intitle:textbook -intitle:volume OR subject:Nature -intitle:guide -intitle:textbook',
    shelf: 'discovery',
    weight: 0.86,
  },
]

/** Mood / genre shortcuts that run a real search when clicked. */
export const BROWSE_TOPICS = [
  { label: 'Literary Fiction', query: 'literary fiction' },
  { label: 'Mystery & Crime', query: 'mystery crime fiction' },
  { label: 'Science Fiction', query: 'science fiction' },
  { label: 'Poetry', query: 'poetry collection' },
  { label: 'History', query: 'narrative history' },
  { label: 'Romance', query: 'contemporary romance' },
] as const
