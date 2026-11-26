/**
 * Regressions for two well-known titles that disappeared when the swipe front
 * table was narrowed to category-only queries. The records below use the
 * subject metadata published by Google Books — including its slash-delimited
 * category strings — rather than invented categories.
 */
import { describe, expect, it } from 'vitest'
import type { Book, SwipeQuery } from './books'
import { isEligibleBook } from './book-eligibility'
import { filterShelfBooks } from './book-relevance'
import { matchesDiscoveryCategory } from './discovery-categories'
import { rankSwipeBooks } from './swipe-ranking'

const PROJECT_HAIL_MARY: Book = {
  source: 'google_books',
  sourceId: '_RH2DwAAQBAJ',
  title: 'Project Hail Mary',
  authors: ['Andy Weir'],
  description:
    "A lone astronaut. An impossible mission. An ally he never imagined. 'If you like a lot of science in your science fiction, Andy Weir is the writer for you. . . This one has everything fans of old school SF (like me) love.' Ryland Grace is the sole survivor on a desperate, last-chance mission.",
  categories: [
    'Fiction',
    'Science Fiction',
    'Hard Science Fiction',
    'Fiction / Science Fiction / Action & Adventure',
    'Fiction / Science Fiction / General',
    'Fiction / Science Fiction / Hard Science Fiction',
    'Fiction / Science Fiction / Space Exploration',
    'Fiction / Thrillers / Suspense',
    'Fiction / Thrillers / Technological',
  ],
  mainCategory: 'Fiction',
  publishedDate: '2021-05-04',
  publisher: 'Random House',
  language: 'en',
  pageCount: 496,
  printType: 'BOOK',
  coverUrl: 'https://books.google.com/books/content?id=_RH2DwAAQBAJ',
  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781473582583' }],
  averageRating: 5,
  ratingsCount: 1,
}

const EVELYN_HUGO: Book = {
  source: 'google_books',
  sourceId: 'IdAmDwAAQBAJ',
  title: 'The Seven Husbands of Evelyn Hugo: A Novel',
  authors: ['Taylor Jenkins Reid'],
  description:
    'Aging and reclusive Hollywood movie icon Evelyn Hugo is finally ready to tell the truth about her glamorous and scandalous life. But when she chooses unknown magazine reporter Monique Grant for the job, no one is more astonished than Monique herself. This wildly addictive journey through old Hollywood comes with unexpected twists and the most satisfying of drama.',
  categories: [
    'Fiction',
    'Romance',
    'LGBTQ+',
    'General',
    'Fiction / Family Life / General',
    'Fiction / Performing Arts / Film, Television & Radio',
    'Fiction / Romance / Contemporary',
    'Fiction / Romance / LGBTQ+ / Bisexual',
    'Fiction / Romance / LGBTQ+ / General',
    'Fiction / Women',
  ],
  mainCategory: 'Fiction',
  publishedDate: '2017-06-13',
  publisher: 'Simon and Schuster',
  language: 'en',
  pageCount: 391,
  printType: 'BOOK',
  coverUrl: 'https://books.google.com/books/content?id=IdAmDwAAQBAJ',
  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781501139239' }],
  averageRating: 4.5,
  ratingsCount: 3,
}

function queryFor(text: string): SwipeQuery {
  return { query: text, shelf: 'genre', weight: 1 }
}

describe('popular Google Books titles remain eligible', () => {
  it('keeps Project Hail Mary on the science-fiction shelf', () => {
    expect(isEligibleBook(PROJECT_HAIL_MARY)).toBe(true)
    expect(matchesDiscoveryCategory(PROJECT_HAIL_MARY, 'science-fiction')).toBe(true)
    expect(filterShelfBooks([PROJECT_HAIL_MARY], ['science-fiction'])).toEqual([PROJECT_HAIL_MARY])

    const ranked = rankSwipeBooks(
      [{ query: queryFor('science fiction novels space'), books: [PROJECT_HAIL_MARY] }],
      { categoryIds: ['science-fiction'] },
    )
    expect(ranked.map((book) => book.sourceId)).toEqual([PROJECT_HAIL_MARY.sourceId])
  })

  it('keeps The Seven Husbands of Evelyn Hugo on the contemporary and romance shelves', () => {
    expect(isEligibleBook(EVELYN_HUGO)).toBe(true)
    expect(matchesDiscoveryCategory(EVELYN_HUGO, 'contemporary-fiction')).toBe(true)
    expect(matchesDiscoveryCategory(EVELYN_HUGO, 'romance')).toBe(true)
    expect(
      filterShelfBooks([EVELYN_HUGO], ['contemporary-fiction', 'romance']),
    ).toEqual([EVELYN_HUGO])

    const ranked = rankSwipeBooks(
      [{ query: queryFor('contemporary fiction novels'), books: [EVELYN_HUGO] }],
      { categoryIds: ['contemporary-fiction', 'romance'] },
    )
    expect(ranked.map((book) => book.sourceId)).toEqual([EVELYN_HUGO.sourceId])
  })
})
