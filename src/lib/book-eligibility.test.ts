import { describe, expect, it } from 'vitest'
import type { Book } from './books'
import { classifyBookEligibility, filterEligibleBooks, isEligibleBook } from './book-eligibility'

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

const ineligibleRecords: [string, Book][] = [
  [
    'literary journal issue',
    record({
      sourceId: 'paris-review',
      title: 'The Paris Review',
      subtitle: 'No. 214',
      authors: [],
      publisher: '',
      publishedDate: '2006',
      categories: ['American literature'],
      description: 'A quarterly of fiction and poetry.',
      industryIdentifiers: [{ type: 'OTHER', identifier: 'VAND:30081039491109' }],
    }),
  ],
  [
    'poetry magazine',
    record({
      sourceId: 'poetry-magazine',
      title: 'Poetry',
      subtitle: 'A Magazine of Verse, Volume 122, Issue 3',
      categories: ['Poetry', 'Periodicals'],
      publisher: 'Poetry Foundation',
      industryIdentifiers: [{ type: 'OTHER', identifier: 'OCLC:123456' }],
    }),
  ],
  [
    'scientific journal',
    record({
      sourceId: 'molecular-biology',
      title: 'Journal of Molecular Biology',
      subtitle: 'Volume 412, Issue 3',
      printType: 'MAGAZINE',
      authors: [],
      publisher: 'Elsevier',
      categories: ['Biology', 'Academic'],
      industryIdentifiers: [{ type: 'ISSN', identifier: '0022-2836' }],
    }),
  ],
  [
    'well-known scientific journal',
    record({
      sourceId: 'nature',
      title: 'Nature',
      subtitle: 'Volume 623, Issue 7980',
      authors: [],
      publisher: 'Nature Publishing Group',
      categories: ['Science'],
      industryIdentifiers: [{ type: 'OTHER', identifier: 'OCLC:NATURE' }],
    }),
  ],
  [
    'yearbook',
    record({
      sourceId: 'yearbook',
      title: 'The World Almanac Yearbook',
      publisher: undefined,
      categories: ['Reference'],
    }),
  ],
  [
    'recurring volume without an isbn',
    record({
      sourceId: 'monist',
      title: 'The Monist',
      categories: ['Electronic journals'],
      description: 'Vols. 2 and 5 include appendices.',
      publishedDate: '1910',
      authors: [],
      publisher: '',
      industryIdentifiers: [{ type: 'OTHER', identifier: 'VAND:30081042116792' }],
    }),
  ],
  [
    'research paper',
    record({
      sourceId: 'doi-paper',
      title: 'Gene Expression in Coastal Species',
      description: 'Peer reviewed research article with a DOI and abstract.',
      categories: ['Biology'],
      industryIdentifiers: [{ type: 'OTHER', identifier: '10.1016/j.jmb.2024.01.001' }],
    }),
  ],
  [
    'conference proceedings',
    record({
      sourceId: 'proceedings',
      title: 'Proceedings of the 2024 International Conference on Machine Learning',
      categories: ['Conference proceedings'],
      publisher: 'Springer',
    }),
  ],
  [
    'dissertation',
    record({
      sourceId: 'dissertation',
      title: 'Doctoral Dissertation: Studies in Archival Memory',
      description: 'Submitted in partial fulfillment of the requirements for a PhD.',
      publisher: 'University Press',
    }),
  ],
  [
    'thesis',
    record({
      sourceId: 'thesis',
      title: 'Master’s Thesis: Coastal Memory',
      categories: ['Thesis'],
      publisher: 'University Press',
    }),
  ],
  [
    'textbook',
    record({
      sourceId: 'textbook',
      title: 'Calculus: An Applied Approach',
      categories: ['Mathematics', 'Education'],
      publisher: 'Pearson',
    }),
  ],
  [
    'workbook',
    record({
      sourceId: 'workbook',
      title: 'SAT Practice Workbook',
      subtitle: 'Test Prep and Study Guide',
      categories: ['Study Aids', 'Test Preparation'],
      publisher: 'Kaplan',
    }),
  ],
  [
    'exam prep',
    record({
      sourceId: 'exam-prep',
      title: 'GRE Exam Preparation',
      categories: ['Test Preparation'],
    }),
  ],
  [
    'technical manual',
    record({
      sourceId: 'manual',
      title: 'Advanced Networking Reference Manual',
      publisher: 'IEEE',
      categories: ['Technology & Engineering', 'Reference'],
    }),
  ],
  [
    'academic reference',
    record({
      sourceId: 'encyclopedia',
      title: 'Encyclopedia of Modern Physics',
      categories: ['Reference', 'Science'],
      publisher: 'Elsevier',
    }),
  ],
  [
    'catalog-only periodical record',
    record({
      sourceId: 'catalog-only',
      title: 'Biography',
      subtitle: 'An interdisciplinary quarterly.',
      authors: [],
      description: '',
      publisher: '',
      publishedDate: '1998',
      categories: ['Biography'],
      industryIdentifiers: [{ type: 'OTHER', identifier: 'OHIOU:1002378531' }],
    }),
  ],
  [
    'ambiguous record with a book print type',
    record({
      sourceId: 'ambiguous',
      title: 'Untitled Collection',
      authors: [],
      description: '',
      categories: [],
      publishedDate: '',
      publisher: '',
      industryIdentifiers: [],
    }),
  ],
]

const eligibleRecords: Book[] = [
  record({ sourceId: 'literary', title: 'Quiet Rooms', categories: ['Fiction', 'Literary Fiction'] }),
  record({ sourceId: 'fantasy', title: 'The Paper Crown', categories: ['Fantasy'] }),
  record({
    sourceId: 'historical-fiction',
    title: 'TheWinter Orchard',
    categories: ['Historical Fiction'],
  }),
  record({ sourceId: 'history', title: 'A Short History of Coastlines', categories: ['History'] }),
  record({ sourceId: 'memoir', title: 'Educated: A Memoir', categories: ['Biography', 'Memoir'] }),
  record({
    sourceId: 'popular-science',
    title: 'The Nature of Stars',
    categories: ['Popular Science', 'Nature'],
  }),
  record({ sourceId: 'philosophy', title: 'Ways of Seeing', categories: ['Philosophy'] }),
  record({ sourceId: 'poetry', title: 'Devotions', categories: ['Poetry'] }),
  record({ sourceId: 'stories', title: 'Selected Stories', categories: ['Short Stories'] }),
  record({ sourceId: 'essays', title: 'Essays from the Edge', categories: ['Essays'] }),
]

describe('standalone book eligibility', () => {
  it('rejects every non-book publication type before ranking', () => {
    for (const [label, book] of ineligibleRecords) {
      const result = classifyBookEligibility(book)
      expect(result.eligible, label).toBe(false)
      expect(result.reasons.length, label).toBeGreaterThan(0)
    }
    expect(filterEligibleBooks(ineligibleRecords.map(([, book]) => book))).toEqual([])
  })

  it('keeps reader-facing fiction and nonfiction collections', () => {
    for (const book of eligibleRecords) expect(isEligibleBook(book)).toBe(true)
    expect(filterEligibleBooks(eligibleRecords)).toHaveLength(eligibleRecords.length)
  })

  it('treats printType BOOK as necessary but not sufficient', () => {
    const magazineLabeledBook = record({
      sourceId: 'false-book',
      title: 'The Paris Review',
      subtitle: 'Issue 214',
      authors: [],
      categories: ['Periodicals'],
      industryIdentifiers: [{ type: 'OTHER', identifier: 'VAND:30081039491109' }],
    })
    expect(magazineLabeledBook.printType).toBe('BOOK')
    expect(isEligibleBook(magazineLabeledBook)).toBe(false)

    const realBook = record({ sourceId: 'real-book', title: 'A Novel' })
    expect(isEligibleBook(realBook)).toBe(true)
    expect(isEligibleBook({ ...realBook, printType: 'MAGAZINE' })).toBe(false)
    expect(isEligibleBook({ ...realBook, printType: undefined })).toBe(false)
  })

  it('does not let ratings or popularity override eligibility', () => {
    const glamorousJournal = record({
      sourceId: 'popular-journal',
      title: 'The Monist',
      categories: ['Electronic journals'],
      averageRating: 5,
      ratingsCount: 100_000,
      coverUrl: 'https://example.com/cover.jpg',
    })
    expect(isEligibleBook(glamorousJournal)).toBe(false)
  })

  it('uses ISBN, ISSN, category, title, author, publisher and date together', () => {
    const good = record({ sourceId: 'good', title: 'A Memoir of Rivers' })
    expect(classifyBookEligibility(good).eligible).toBe(true)

    expect(classifyBookEligibility({ ...good, industryIdentifiers: [] }).eligible).toBe(true)
    expect(
      classifyBookEligibility({
        ...good,
        authors: [],
        publisher: '',
        description: '',
        categories: [],
        industryIdentifiers: [],
      }).eligible,
    ).toBe(false)
    expect(
      classifyBookEligibility({
        ...good,
        industryIdentifiers: [{ type: 'ISSN', identifier: '0022-2836' }],
      }).reasons,
    ).toContain('serial-identifier')
    expect(classifyBookEligibility({ ...good, publishedDate: 'not-a-year' }).reasons).toContain(
      'missing-publication-date',
    )
    expect(
      classifyBookEligibility({
        ...good,
        categories: ['Academic', 'Scholarly'],
        title: 'Encyclopedia of Modern Physics',
        publisher: 'Elsevier',
      }).eligible,
    ).toBe(false)
  })
})

describe('mandatory publisher and category metadata', () => {
  const base = record({ sourceId: 'metadata-base', title: 'A Quiet Novel' })

  it('requires a nonempty normalized publisher', () => {
    for (const publisher of ['', '   ', '\n\t', '<b> </b>']) {
      const result = classifyBookEligibility({ ...base, publisher })
      expect(result.eligible, JSON.stringify(publisher)).toBe(false)
      expect(result.reasons, JSON.stringify(publisher)).toContain('missing-publisher')
    }
    expect(classifyBookEligibility({ ...base, publisher: undefined }).reasons).toContain(
      'missing-publisher',
    )
    expect(isEligibleBook({ ...base, publisher: 'DogEar Press' })).toBe(true)
  })

  it('requires at least one meaningful Google Books category', () => {
    const missing: Book['categories'][] = [[], ['', '   '], ['/'], ['<b></b>']]
    for (const categories of missing) {
      const result = classifyBookEligibility({ ...base, categories })
      expect(result.eligible, JSON.stringify(categories)).toBe(false)
      expect(result.reasons, JSON.stringify(categories)).toContain('missing-categories')
    }
    const whitespaceMainCategory = classifyBookEligibility({
      ...base,
      categories: [],
      mainCategory: '   ',
    })
    expect(whitespaceMainCategory.reasons).toContain('missing-categories')
    expect(
      classifyBookEligibility({
        ...base,
        categories: [],
        title: 'A Fantasy Novel Full of Magic',
        description: 'A fantasy story for readers of fantasy novels.',
      }).eligible,
    ).toBe(false)
    expect(
      classifyBookEligibility({
        ...base,
        categories: [],
        title: 'Published by DogEar Press',
        description: 'This book was published by DogEar Press.',
      }).eligible,
    ).toBe(false)
    expect(isEligibleBook({ ...base, categories: ['Fiction'] })).toBe(true)
    expect(isEligibleBook({ ...base, categories: [], mainCategory: 'History' })).toBe(true)
  })

  it('rejects excluded publication categories even with strong reading signals', () => {
    const excluded: [string, string][] = [
      ['antiques and collectibles', 'Antiques & Collectibles'],
      ['reference', 'Reference'],
      ['study aids', 'Study Aids'],
      ['education', 'Education'],
      ['teaching guides', 'Teaching'],
      ['writing guides', 'Writing'],
      ['business manuals', 'Business Manuals'],
      ['technical manuals', 'Technical Manuals'],
      ['professional training', 'Professional Training'],
      ['academic research', 'Academic Research'],
      ['literary criticism', 'Literary Criticism'],
      ['literary theory', 'Literary Theory'],
      ['journals', 'Journals'],
      ['periodicals', 'Periodicals'],
      ['magazines', 'Magazines'],
    ]

    for (const [label, category] of excluded) {
      const result = classifyBookEligibility(
        record({
          sourceId: `excluded-${label.replace(/\s+/g, '-')}`,
          title: 'A Charming Novel About Friendship',
          description: 'An accessible novel that general readers will enjoy.',
          categories: [category],
        }),
      )
      expect(result.eligible, label).toBe(false)
      expect(result.reasons, label).toContain('excluded-category')
    }
  })

  it('does not let a vague title or description override an excluded category', () => {
    const result = classifyBookEligibility(
      record({
        sourceId: 'vague-excluded',
        title: 'A Beautiful History of Imaginary Worlds',
        description: 'A lively history written for general readers who love stories.',
        categories: ['History', 'Literary Criticism'],
      }),
    )
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('excluded-category')
  })

  it('still keeps legitimate reading books from selected subjects', () => {
    const accepted: [string, string[]][] = [
      ['fantasy', ['Fantasy']],
      ['mystery', ['Mystery', 'Thriller']],
      ['history', ['History']],
      ['poetry', ['Poetry']],
    ]
    for (const [subject, categories] of accepted) {
      const book = record({
        sourceId: `accepted-${subject}`,
        title: `A Reader's ${subject} Book`,
        categories,
      })
      expect(isEligibleBook(book), subject).toBe(true)
    }
  })
})
