import { describe, expect, it } from 'vitest'
import type { Book } from './books'
import { DEFAULT_INTENT, isShelfEligibleBook } from './book-relevance'
import {
  buildCategoryRecommendationQueries,
  categoryPreferenceSummary,
  DEFAULT_DISCOVERY_CATEGORY_IDS,
  DISCOVERY_CATEGORIES,
  DISCOVERY_CATEGORY_IDS,
  DISCOVERY_GROUPS,
  discoveryCategoryIdsFromText,
  discoveryCategoryLabel,
  discoveryCategoryQueries,
  filterDiscoveryCategoryBooks,
  isDiscoveryCategoryId,
  matchesAnyDiscoveryCategory,
  matchesDiscoveryCategory,
  normalizeDiscoveryCategoryIds,
  parseStoredDiscoveryCategoryIds,
  serializeDiscoveryCategoryIds,
} from './discovery-categories'

const EXPECTED = {
  FICTION: [
    'Contemporary Fiction',
    'Literary Fiction',
    'Fantasy',
    'Science Fiction',
    'Mystery',
    'Thriller',
    'Romance',
    'Horror',
    'Historical Fiction',
  ],
  NONFICTION: ['History', 'Biography & Memoir', 'Popular Science', 'Philosophy', 'General Nonfiction'],
  OTHER: ['Poetry', 'Short Story Collections', 'Essay Collections'],
} as const

function book(overrides: Partial<Book> & Pick<Book, 'title'>): Book {
  return {
    source: 'google_books',
    sourceId: overrides.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    authors: ['Ada Author'],
    description: 'A catalogue description that tells a reader what this book is about.',
    categories: ['Fiction'],
    publishedDate: '2024',
    coverUrl: null,
    printType: 'BOOK',
    publisher: 'DogEar Test Press',
    industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780143127741' }],
    ...overrides,
  }
}

describe('discovery categories', () => {
  it('offers exactly the standalone reading shelves in the right groups', () => {
    expect(DISCOVERY_GROUPS).toEqual(['FICTION', 'NONFICTION', 'OTHER'])
    expect(DISCOVERY_CATEGORIES).toHaveLength(17)
    expect(DISCOVERY_CATEGORY_IDS).toHaveLength(17)
    expect(new Set(DISCOVERY_CATEGORY_IDS).size).toBe(17)

    for (const group of DISCOVERY_GROUPS) {
      expect(
        DISCOVERY_CATEGORIES.filter((category) => category.group === group).map(
          (category) => category.label,
        ),
      ).toEqual([...EXPECTED[group]])
    }

    const forbidden = /magazine|journal|textbook|study guide|academic|course|periodical/i
    for (const category of DISCOVERY_CATEGORIES) {
      expect(category.label).not.toMatch(forbidden)
      expect(category.id).not.toMatch(forbidden)
    }
  })

  it('generates subject-focused Google Books queries for every category', () => {
    for (const category of DISCOVERY_CATEGORIES) {
      const queries = discoveryCategoryQueries(category.id)
      expect(queries.length).toBeGreaterThan(0)
      for (const query of queries) {
        expect(query.trim()).toBe(query)
        expect(query.length).toBeGreaterThan(10)
        expect(query).not.toMatch(/magazine|journal|textbook|study guide|periodical/i)
        expect(query).not.toMatch(/^-|subject:|intitle:/)
        expect(query).not.toMatch(/^\s*(?:literature|books)\s*$/i)
      }
    }
  })

  it('validates and normalizes stored ids without inventing categories', () => {
    expect(isDiscoveryCategoryId('fantasy')).toBe(true)
    expect(isDiscoveryCategoryId('magazines')).toBe(false)
    expect(normalizeDiscoveryCategoryIds(['fantasy', 'fantasy', 'nonsense', 'mystery'])).toEqual([
      'fantasy',
      'mystery',
    ])
    expect(normalizeDiscoveryCategoryIds('fantasy')).toEqual([])
    expect(parseStoredDiscoveryCategoryIds('["fantasy","mystery"]')).toEqual([
      'fantasy',
      'mystery',
    ])
    expect(parseStoredDiscoveryCategoryIds('fantasy,mystery,nonsense')).toEqual([
      'fantasy',
      'mystery',
    ])
    expect(parseStoredDiscoveryCategoryIds(undefined)).toEqual([])
    expect(serializeDiscoveryCategoryIds(['mystery', 'bad' as 'mystery', 'mystery'])).toBe(
      '["mystery"]',
    )
    expect(discoveryCategoryLabel('poetry')).toBe('Poetry')
    expect(discoveryCategoryLabel('magazine')).toBe('magazine')
    expect(DEFAULT_DISCOVERY_CATEGORY_IDS.every(isDiscoveryCategoryId)).toBe(true)
  })

  it('spreads round-robin recommendation queries across chosen shelves', () => {
    expect(buildCategoryRecommendationQueries(['fantasy', 'history', 'poetry'], 4)).toEqual([
      'fantasy novels magic adventure',
      'narrative history',
      'poetry collection poems',
      'epic fantasy novels dragons',
    ])
    expect(buildCategoryRecommendationQueries([], 3)).toEqual([])
    expect(categoryPreferenceSummary(['fantasy', 'mystery'])).toBe('Fantasy, Mystery')
    expect(categoryPreferenceSummary([])).toContain('No categories chosen')
  })

  it('matches reading shelves advisory without confusing history with historical fiction', () => {
    const historicalNovel = book({ title: 'A Novel of Ancient Rome', categories: ['Historical Fiction'] })
    expect(matchesDiscoveryCategory(historicalNovel, 'historical-fiction')).toBe(true)
    expect(matchesDiscoveryCategory(historicalNovel, 'history')).toBe(false)

    expect(
      matchesDiscoveryCategory(book({ title: 'The Long History of Weather', categories: ['History'] }), 'history'),
    ).toBe(true)
    expect(
      matchesDiscoveryCategory(book({ title: 'Poems for Rainy Days', categories: ['Poetry'] }), 'poetry'),
    ).toBe(true)
    expect(
      matchesDiscoveryCategory(
        book({ title: 'Short Stories of the Sea', categories: ['Short Stories'] }),
        'short-story-collections',
      ),
    ).toBe(true)
  })
})

describe('hard discovery category eligibility', () => {
  const POSITIVE_CASES = [
    ['contemporary-fiction', 'Fiction / Contemporary Women'],
    ['literary-fiction', 'Fiction / Literary'],
    ['fantasy', 'Fiction / Fantasy'],
    ['science-fiction', 'Fiction / Science Fiction'],
    ['mystery', 'Fiction / Mystery & Detective'],
    ['thriller', 'Fiction / Thrillers'],
    ['romance', 'Fiction / Romance'],
    ['horror', 'Fiction / Horror'],
    ['historical-fiction', 'Fiction / Historical'],
    ['history', 'History'],
    ['biography-memoir', 'Biography & Autobiography / Memoirs'],
    ['popular-science', 'Science / Popular Science'],
    ['philosophy', 'Philosophy / Ethics'],
    ['general-nonfiction', 'Social Science / Essays'],
    ['poetry', 'Poetry'],
    ['short-story-collections', 'Fiction / Short Stories'],
    ['essay-collections', 'Literary Collections / Essays'],
  ] as const

  it('accepts a genuine Google Books record for every category', () => {
    for (const [id, category] of POSITIVE_CASES) {
      const candidate = book({ title: `A Real ${id} Book`, categories: [category] })
      expect(matchesDiscoveryCategory(candidate, id)).toBe(true)
      expect(isShelfEligibleBook(candidate, DEFAULT_INTENT, [id])).toBe(true)
      expect(filterDiscoveryCategoryBooks([candidate], [id])).toEqual([candidate])
    }
  })

  it('rejects unrelated books even when their popularity is high', () => {
    const cases = [
      {
        selected: ['fantasy'] as const,
        rejected: book({
          sourceId: 'history',
          title: 'A History of Empires',
          categories: ['History'],
          ratingsCount: 100_000,
          averageRating: 4.8,
        }),
      },
      {
        selected: ['mystery'] as const,
        rejected: book({
          sourceId: 'romance',
          title: 'A Summer Romance',
          categories: ['Fiction', 'Romance'],
          ratingsCount: 100_000,
          averageRating: 4.9,
        }),
      },
      {
        selected: ['fantasy'] as const,
        rejected: book({
          sourceId: 'fantasy-criticism',
          title: 'Fantasy Literature: A Critical History',
          categories: ['Literary Criticism / Fantasy'],
          description: 'A scholarly study of fantasy literature and its readers.',
        }),
      },
      {
        selected: ['poetry'] as const,
        rejected: book({
          sourceId: 'poetry-criticism',
          title: 'Understanding Poetry: A Study Guide',
          categories: ['Poetry', 'Education'],
          description: 'A classroom study guide to poetry analysis.',
        }),
      },
      {
        selected: ['history'] as const,
        rejected: book({
          sourceId: 'historical-fiction',
          title: 'A Novel of Ancient Rome',
          categories: ['Historical Fiction'],
        }),
      },
    ]

    for (const { selected, rejected } of cases) {
      expect(isShelfEligibleBook(rejected, DEFAULT_INTENT, selected)).toBe(false)
      expect(filterDiscoveryCategoryBooks([rejected], selected)).toEqual([])
    }
  })

  it('requires genre metadata and publication evidence', () => {
    const noGenre = book({
      title: 'The Quiet House',
      categories: ['Fiction'],
      description: 'A catalogue description that tells a reader what this book is about.',
    })
    const noPublicationType = book({
      title: 'The Glass Keep',
      categories: ['Fiction / Fantasy'],
      printType: undefined,
    })

    expect(matchesAnyDiscoveryCategory(noGenre, ['fantasy'])).toBe(false)
    expect(isShelfEligibleBook(noGenre, DEFAULT_INTENT, ['fantasy'])).toBe(false)
    expect(isShelfEligibleBook(noPublicationType, DEFAULT_INTENT, ['fantasy'])).toBe(false)
  })

  it('accepts corroborated genre signals without trusting a bare mention', () => {
    const novel = book({
      title: 'The Glass Keep',
      categories: ['Fiction'],
      description: 'An epic fantasy novel about a hidden kingdom and its unlikely heir.',
    })
    const mereMention = book({
      title: 'Reading Fantasy',
      categories: ['Fiction'],
      description: 'A reader describes why the fantasy shelves are changing.',
    })

    expect(matchesDiscoveryCategory(novel, 'fantasy')).toBe(true)
    expect(matchesDiscoveryCategory(mereMention, 'fantasy')).toBe(false)
  })

  it('maps explicit requests to shelves without confusing adjacent subjects', () => {
    expect(discoveryCategoryIdsFromText('I want fantasy novels')).toEqual(['fantasy'])
    expect(discoveryCategoryIdsFromText('historical fiction please')).toEqual(['historical-fiction'])
    expect(discoveryCategoryIdsFromText('science fiction novels')).toEqual(['science-fiction'])
    expect(discoveryCategoryIdsFromText('narrative history')).toEqual(['history'])
    expect(discoveryCategoryIdsFromText('')).toEqual([])
  })
})
