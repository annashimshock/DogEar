import { describe, expect, it } from 'vitest'
import type { Book } from './books'
import { isEligibleBook } from './book-eligibility'
import {
  DEFAULT_RECOMMENDATION_INTENT,
  classifyBookRelevance,
  filterRecommendedBooks,
  intentFromText,
  isLiteraryStudiesRequest,
} from './book-relevance'

function record(overrides: Partial<Book> & Pick<Book, 'sourceId' | 'title'>): Book {
  return {
    source: 'google_books',
    authors: ['Ada Author'],
    description: 'A substantial catalogue description that tells a reader what this book is about.',
    categories: ['Fiction'],
    publishedDate: '2024-01-01',
    coverUrl: null,
    printType: 'BOOK',
    publisher: 'DogEar Press',
    industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780143127741' }],
    ...overrides,
  }
}

const readingBooks: Book[] = [
  record({ sourceId: 'literary', title: 'Quiet Rooms', categories: ['Fiction', 'Literary Fiction'] }),
  record({ sourceId: 'fantasy', title: 'The Paper Crown', categories: ['Fantasy'] }),
  record({ sourceId: 'historical', title: 'The Winter Orchard', categories: ['Historical Fiction'] }),
  record({ sourceId: 'mystery', title: 'The Silent Patient', categories: ['Mystery', 'Thriller'] }),
  record({ sourceId: 'romance', title: 'A Summer Courtship', categories: ['Romance'] }),
  record({ sourceId: 'horror', title: 'The Quiet House', categories: ['Horror'] }),
  record({ sourceId: 'poetry', title: 'Devotions', categories: ['Poetry'], authors: ['Mary Oliver'] }),
  record({ sourceId: 'stories', title: 'Selected Stories', categories: ['Short Stories'] }),
  record({ sourceId: 'essays', title: 'Essays from the Edge', categories: ['Essays'] }),
  record({
    sourceId: 'author-biography',
    title: 'Virginia Woolf: A Biography',
    categories: ['Biography'],
  }),
  record({
    sourceId: 'novel-about-writer',
    title: "The Novelist's Daughter",
    categories: ['Fiction'],
    description: 'A novel about a writer and the family she leaves behind.',
  }),
  record({ sourceId: 'history', title: 'A Short History of Coastlines', categories: ['History'] }),
  record({
    sourceId: 'popular-science',
    title: 'The Nature of Stars',
    categories: ['Popular Science', 'Nature'],
  }),
]

// Excluded publication forms: these are rejected at the eligibility boundary,
// not merely demoted by the recommendation policy.
const excludedAcademicPublications: Book[] = [
  record({
    sourceId: 'criticism',
    title: 'The Rise of the Novel',
    categories: ['Literary Criticism', 'History'],
    publisher: 'University of California Press',
    description: 'A scholarly study of the development of the English novel.',
  }),
  record({
    sourceId: 'theory',
    title: 'Literary Theory: An Introduction',
    categories: ['Literary Criticism'],
    publisher: 'University of Minnesota Press',
  }),
  record({
    sourceId: 'poetry-analysis',
    title: 'Understanding Poetry: A Study Guide',
    categories: ['Poetry', 'Education'],
    publisher: 'Academic Press',
  }),
  record({
    sourceId: 'companion',
    title: 'The Cambridge Companion to Shakespeare',
    categories: ['Literary Criticism'],
    publisher: 'Cambridge University Press',
  }),
  record({
    sourceId: 'writing',
    title: 'Academic Writing for Graduate Students',
    categories: ['Language Arts & Disciplines'],
  }),
]

// Valid standalone books whose subject is literary study. Their ordinary
// categories keep them eligible; the relevance gate alone decides the shelf.
const eligibleScholarlyBooks: Book[] = [
  record({
    sourceId: 'scholarly-novel-history',
    title: 'A Scholarly History of Novels',
    categories: ['History'],
    publisher: 'University of California Press',
    description: 'A scholarly study of how novels changed public reading.',
  }),
  record({
    sourceId: 'scholarly-poetry-studies',
    title: 'Studies in Modern Poetry',
    categories: ['Poetry'],
    publisher: 'University of Minnesota Press',
    description: 'A scholarly analysis of poetic movements and their readers.',
  }),
]

describe('recommendation relevance', () => {
  it('states the default reading intent explicitly', () => {
    expect(DEFAULT_RECOMMENDATION_INTENT).toBe(
      'Recommend books people would choose to read for enjoyment, including novels, genre fiction, poetry collections, and accessible nonfiction. Do not recommend academic books about literature, literary criticism, scholarly commentary, textbooks, or reference materials unless explicitly requested.',
    )
  })

  it('keeps novels, genre fiction, poetry collections, biographies and general nonfiction relevant', () => {
    for (const book of readingBooks) {
      const result = classifyBookRelevance(book)
      expect(result.relevant, book.title).toBe(true)
      expect(result.score, book.title).toBeGreaterThan(0)
      expect(filterRecommendedBooks([book])).toEqual([book])
    }
  })

  it('keeps publication eligibility separate from default relevance', () => {
    for (const book of excludedAcademicPublications) {
      const result = classifyBookRelevance(book)
      expect(result.relevant, book.title).toBe(false)
      expect(result.score, book.title).toBeLessThan(0)
      expect(result.reasons.length, book.title).toBeGreaterThan(0)
      expect(isEligibleBook(book), book.title).toBe(false)
    }

    for (const book of eligibleScholarlyBooks) {
      const result = classifyBookRelevance(book)
      expect(result.relevant, book.title).toBe(false)
      expect(result.score, book.title).toBeLessThan(0)
      expect(result.reasons.length, book.title).toBeGreaterThan(0)
      expect(isEligibleBook(book), book.title).toBe(true)
      expect(filterRecommendedBooks([book])).toEqual([])
    }
  })

  it('only makes literary studies relevant for an explicit request', () => {
    expect(isLiteraryStudiesRequest('I want literary fiction novels')).toBe(false)
    expect(intentFromText('I want literary fiction novels').allowLiteraryStudies).toBe(false)

    const request = 'I want books about literary criticism, theory and poetry analysis'
    expect(isLiteraryStudiesRequest(request)).toBe(true)
    const intent = intentFromText(request)
    expect(intent.allowLiteraryStudies).toBe(true)

    expect(filterRecommendedBooks(eligibleScholarlyBooks, intent)).toEqual(eligibleScholarlyBooks)
    // An excluded publication form stays ineligible even for this request.
    expect(filterRecommendedBooks(excludedAcademicPublications, intent)).toEqual([])
  })

  it('does not confuse a book about a writer with the study of literature', () => {
    const biography = readingBooks.find((book) => book.sourceId === 'author-biography')!
    const novel = readingBooks.find((book) => book.sourceId === 'novel-about-writer')!
    expect(classifyBookRelevance(biography).reasons).toEqual([])
    expect(classifyBookRelevance(novel).reasons).toEqual([])
  })
})
