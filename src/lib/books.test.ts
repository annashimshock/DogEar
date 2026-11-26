import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSE_TOPICS,
  CURATED_SHELVES,
  buildSwipeQueries,
  searchBooksDetailed,
  searchDiscoveryBooks,
  swipeQueryBatch,
  SWIPE_RESULTS_PER_QUERY,
  type Book,
} from './books'
import {
  DEFAULT_DISCOVERY_CATEGORY_IDS,
  DISCOVERY_CATEGORIES,
} from './discovery-categories'

const eligible: Book = {
  source: 'google_books',
  sourceId: 'novel-id',
  title: 'A Quiet Novel',
  authors: ['Ada Author'],
  description: 'A full catalogue description that tells a reader what the story is about.',
  categories: ['Literary Fiction'],
  publishedDate: '2024-01-01',
  coverUrl: null,
  printType: 'BOOK',
  publisher: 'DogEar Press',
  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780143127741' }],
}

const journal: Book = {
  ...eligible,
  sourceId: 'journal-id',
  title: 'Journal of Coastal Studies',
  authors: [],
  categories: ['Periodicals'],
  publisher: 'Elsevier',
  industryIdentifiers: [{ type: 'ISSN', identifier: '0022-2836' }],
}

// A valid standalone publication, but academic: relevance, not publication
// eligibility, keeps it off default shelves.
const scholarlyBook: Book = {
  ...eligible,
  sourceId: 'scholarly-id',
  title: 'The Rise of Publishing',
  authors: ['Ian Watt'],
  categories: ['History'],
  publisher: 'University of California Press',
  description: 'A peer reviewed scholarship about book history.',
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('search boundary', () => {
  it('keeps real failures distinct from an empty but successful catalogue page', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ error: 'Google Books search failed.' }, false, 502),
    )
    vi.stubGlobal('fetch', fetchMock)
    const failed = await searchBooksDetailed('fantasy novels', 20)
    expect(failed.ok).toBe(false)
    expect(failed.error).toBe('Google Books search failed.')

    fetchMock.mockResolvedValueOnce(jsonResponse({ totalItems: 0, books: [] }))
    const empty = await searchBooksDetailed('fantasy novels', 20)
    expect(empty).toEqual({
      ok: true,
      books: [],
      totalItems: 0,
      eligibleCount: 0,
      relevantCount: 0,
    })
  })

  it('filters ineligible records while preserving the raw upstream count', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ totalItems: 2, eligibleCount: 1, books: [journal, eligible] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await searchBooksDetailed('fantasy novels', 20)
    expect(result.ok).toBe(true)
    expect(result.books.map((book) => book.sourceId)).toEqual(['novel-id'])
    expect(result.totalItems).toBe(2)
    expect(result.eligibleCount).toBe(1)
  })

  it('keeps eligible scholarly books off default shelves but allows explicit study searches', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({
        totalItems: 2,
        eligibleCount: 1,
        relevantCount: 0,
        books: [scholarlyBook, journal],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const defaultResult = await searchBooksDetailed('literary fiction novels', 20)
    expect(defaultResult.ok).toBe(true)
    expect(defaultResult.books).toEqual([])
    expect(defaultResult.eligibleCount).toBe(1)
    expect(defaultResult.relevantCount).toBe(0)

    const explicitResult = await searchBooksDetailed('literary criticism books', 20, 0, undefined, null)
    expect(explicitResult.books.map((book) => book.sourceId)).toEqual(['scholarly-id'])
    expect(explicitResult.relevantCount).toBe(1)
  })

  it('forwards pagination offsets to the worker route', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({ totalItems: 0, books: [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await searchBooksDetailed('fantasy novels', 20, 40)
    expect(fetchMock.mock.calls[0][0]).toContain('startIndex=40')
  })
})

describe('swipe stack generation', () => {
  it('generates a subject-focused query for every offered category', () => {
    expect(DISCOVERY_CATEGORIES).toHaveLength(17)
    for (const category of DISCOVERY_CATEGORIES) {
      const queries = buildSwipeQueries([category.id]).map((entry) => entry.query)
      expect(queries.length).toBeGreaterThan(0)
      for (const query of queries) {
        expect(query.trim().length).toBeGreaterThan(0)
        expect(query).not.toMatch(/subject:|-subject:|-intitle:|magazine|journal|textbook|study guide/i)
        expect(query).not.toMatch(/^\s*(?:literature|books)\s*$/i)
      }
    }
  })

  it('only uses selected categories and spreads them across a stack', () => {
    const selected = ['fantasy', 'mystery'] as const
    const batch = swipeQueryBatch(0, selected)
    expect(batch.queries).toHaveLength(4)
    expect(batch.queries.every((entry) => (selected as readonly string[]).includes(entry.categoryId!))).toBe(true)
    expect(batch.queries.map((entry) => entry.categoryId)).toEqual([
      'fantasy',
      'mystery',
      'fantasy',
      'mystery',
    ])

    const many = swipeQueryBatch(0, DISCOVERY_CATEGORIES.map((category) => category.id))
    expect(new Set(many.queries.map((entry) => entry.categoryId)).size).toBe(4)
  })

  it('pages through generated queries before calling the catalogue exhausted', () => {
    const selected = ['fantasy', 'mystery'] as const
    const first = swipeQueryBatch(0, selected)
    const deep = swipeQueryBatch(2, selected)
    const last = swipeQueryBatch(5, selected)

    expect(first.startIndex).toBe(0)
    expect(first.hasMorePages).toBe(true)
    expect(deep.startIndex).toBe(SWIPE_RESULTS_PER_QUERY)
    expect(deep.hasMorePages).toBe(true)
    expect(last.startIndex).toBe(SWIPE_RESULTS_PER_QUERY * 2)
    expect(last.hasMorePages).toBe(false)
    expect(first.queries.map((entry) => entry.query)).toEqual(
      swipeQueryBatch(4, selected).queries.map((entry) => entry.query),
    )
  })

  it('uses narrow reading queries for the remaining shelf definitions', () => {
    const shelfIds = CURATED_SHELVES.map((shelf) => shelf.id)
    const shelfTitles = CURATED_SHELVES.map((shelf) => shelf.title)
    expect(shelfIds).toEqual(expect.arrayContaining(['fantasy', 'poetry']))
    expect(shelfIds).not.toContain('nonfiction')
    expect(shelfIds).not.toContain('stay-up')
    expect(shelfIds).not.toContain('quiet')
    expect(shelfTitles).not.toContain('Worth Staying Up For')
    expect(shelfTitles).not.toContain('Quietly Beautiful')
    expect(shelfTitles).not.toContain('Beyond the Story')

    for (const shelf of CURATED_SHELVES) {
      expect(shelf.query).not.toMatch(/literary criticism|poetry analysis|textbook|study guide/i)
    }
    for (const topic of BROWSE_TOPICS) {
      expect(topic.query).not.toMatch(/literary criticism|poetry analysis|textbook|study guide/i)
    }
  })
})

describe('discovery shelves and search', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function book(sourceId: string, title: string, categories: string[]): Book {
    return {
      ...eligible,
      sourceId,
      title,
      categories,
      authors: ['Ada Author'],
    }
  }

  it('sends the active shelves to the worker and keeps paging without repeats', async () => {
    const fantasy = book('fantasy-id', 'The Paper Crown', ['Fantasy'])
    const literary = book('literary-id', 'Quiet Rooms', ['Literary Fiction'])
    const duplicateEdition = book('duplicate-id', 'Quiet Rooms: A Novel', ['Literary Fiction'])
    const offCategory = book('off-category-id', 'A Short History of Coastlines', ['History'])
    const secondLiterary = book('second-literary-id', 'The Hidden Room', ['Literary Fiction'])
    const starts: number[] = []

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      starts.push(Number(/startIndex=(\d+)/.exec(url)?.[1] ?? 0))
      const startIndex = starts[starts.length - 1]
      return jsonResponse({
        totalItems: 30,
        books:
          startIndex === 0
            ? [fantasy, literary]
            : startIndex === 12
              ? [duplicateEdition, offCategory, secondLiterary]
              : [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const found = await searchDiscoveryBooks('fantasy novels', ['fantasy', 'literary-fiction'], 3)
    expect(found.map((entry) => entry.sourceId)).toEqual([
      'fantasy-id',
      'literary-id',
      'second-literary-id',
    ])
    expect(starts).toEqual([0, 12])
    expect(String(fetchMock.mock.calls[0][0])).toContain('categories=fantasy%2Cliterary-fiction')
  })

  it('shows fewer or no books instead of filling shelves with rejected records', async () => {
    const incomplete = { ...eligible, sourceId: 'incomplete', publisher: '   ' }
    const offCategory = book('collectible-id', 'A Charming Novel', ['Antiques & Collectibles'])
    const starts: number[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      starts.push(Number(/startIndex=(\d+)/.exec(String(input))?.[1] ?? 0))
      return jsonResponse({ totalItems: 100, books: [incomplete, offCategory] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const found = await searchDiscoveryBooks('fantasy novels', DEFAULT_DISCOVERY_CATEGORY_IDS, 8)
    expect(found).toEqual([])
    expect(starts).toEqual([0, 12, 24])
    expect(new Set(starts).size).toBe(starts.length)
  })
})
