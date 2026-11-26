import { describe, expect, it } from 'vitest'
import type { Book, SwipeQuery } from './books'
import { isEligibleBook } from './book-eligibility'
import {
  applySwipeBatch,
  isAcademicPublication,
  isSerialPublication,
  rankSwipeBooks,
  type SwipeQueueState,
} from './swipe-ranking'

function book(overrides: Partial<Book> & Pick<Book, 'sourceId' | 'title'>): Book {
  return {
    source: 'google_books',
    authors: [],
    description: 'A real catalogue description long enough to be useful to a reader.',
    categories: ['Fiction'],
    publishedDate: '2023',
    coverUrl: null,
    printType: 'BOOK',
    publisher: 'DogEar Test Press',
    industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780143127741' }],
    ...overrides,
  }
}

const query: SwipeQuery = { query: 'test query', shelf: 'genre', weight: 1 }

function rank(books: Book[], context: Parameters<typeof rankSwipeBooks>[1] = {}) {
  return rankSwipeBooks([{ query, books }], context)
}

describe('swipe ranking', () => {
  it('removes course material even when its ratings look impressive', () => {
    const textbook = book({
      sourceId: 'textbook',
      title: 'Calculus: An Applied Approach, 12th Edition',
      categories: ['Mathematics', 'Education'],
      ratingsCount: 5000,
      averageRating: 4.8,
    })
    const novel = book({ sourceId: 'novel', title: 'A Quiet Novel' })

    expect(rank([textbook, novel]).map((item) => item.sourceId)).toEqual(['novel'])
  })

  it('rewards reader engagement without dropping books that have none', () => {
    const quiet = book({ sourceId: 'quiet', title: 'The Quiet Library', coverUrl: 'cover.jpg' })
    const talkedAbout = book({
      sourceId: 'talked-about',
      title: 'The Buzzing City',
      coverUrl: 'cover.jpg',
      ratingsCount: 300,
      averageRating: 4.4,
    })

    expect(rank([quiet, talkedAbout]).map((item) => item.sourceId)).toEqual([
      'talked-about',
      'quiet',
    ])
  })

  it('puts a front-table result ahead of a discovery result', () => {
    const front = book({ sourceId: 'front', title: 'A Recognizable Novel' })
    const discovery = book({ sourceId: 'discovery', title: 'An Interesting Find' })

    const result = rankSwipeBooks([
      {
        query: { query: 'front', shelf: 'front-table', weight: 1.3 },
        books: [front],
      },
      {
        query: { query: 'discovery', shelf: 'discovery', weight: 0.86 },
        books: [discovery],
      },
    ])

    expect(result.map((item) => item.sourceId)).toEqual(['front', 'discovery'])
  })

  it('keeps fuzzy matches out of an exact front-table shelf', () => {
    const front = book({ sourceId: 'front', title: 'Educated', authors: ['Tara Westover'] })
    const fuzzy = book({
      sourceId: 'fuzzy',
      title: 'Female, Jewish, and Educated',
      authors: ['Harriet Pass Freidenreich'],
    })

    const result = rankSwipeBooks([
      {
        query: { query: 'Educated', shelf: 'front-table', weight: 1.2, targets: ['Educated'] },
        books: [fuzzy, front],
      },
    ])

    expect(result.map((item) => item.sourceId)).toEqual(['front'])
  })

  it('deduplicates editions and keeps the stronger record', () => {
    const weakEdition = book({
      sourceId: 'weak',
      title: 'Pachinko (National Book Award Finalist)',
      authors: ['Min Jin Lee'],
    })
    const strongEdition = book({
      sourceId: 'strong',
      title: 'Pachinko',
      authors: ['Min Jin Lee'],
      coverUrl: 'cover.jpg',
      ratingsCount: 100,
      averageRating: 4.3,
    })

    expect(rank([weakEdition, strongEdition]).map((item) => item.sourceId)).toEqual(['strong'])
  })

  it('treats Project Hail Mary editions as one work and keeps the best record', () => {
    const editions = [
      book({
        sourceId: 'phm-weak',
        title: 'Project Hail Mary',
        authors: ['Andy Weir'],
        description: 'Short blurb.',
      }),
      book({
        sourceId: 'phm-deluxe',
        title: 'Project Hail Mary (Deluxe Edition)',
        authors: ['Andy Weir'],
        publishedDate: '2026-12-01',
      }),
      book({
        sourceId: 'phm-inverted-author',
        title: 'Project Hail Mary',
        authors: ['Weir Andy'],
      }),
      book({ sourceId: 'phm-no-author', title: 'Project Hail Mary', authors: [] }),
      book({
        sourceId: 'phm-translated',
        title: 'Proyek Hail Mary (Project Hail Mary)',
        authors: ['Andy Weir'],
      }),
      book({
        sourceId: 'phm-slash-title',
        title: 'Proyecto Hail Mary (Edición Ilustrada) / Project Hail Mary (Limited Special Edition)',
        authors: ['Andy Weir'],
      }),
      book({
        sourceId: 'phm-strong',
        title: 'Project Hail Mary: A Novel',
        authors: ['Andy Weir'],
        coverUrl: 'cover.jpg',
        ratingsCount: 250,
        averageRating: 4.5,
        description: 'A rich description that tells a reader exactly why this novel matters.',
      }),
    ]
    const differentWorks = [
      book({ sourceId: 'phm-movie', title: 'Project Hail Mary', authors: ['Ryan Gosling'] }),
      book({
        sourceId: 'phm-exercises',
        title: 'Project Hail Mary Exercises',
        authors: ['Audrey Coleman'],
      }),
      book({
        sourceId: 'phm-summary',
        title: 'Summary and Analysis of Project Hail Mary by Andy Weir',
        authors: ['Good Reads Publishing'],
      }),
      book({
        sourceId: 'phm-collection',
        title: "Andy Weir's 3-Book Collection Set (Project Hail Mary, Artemis, the Martian)",
        authors: ['Andy Weir'],
      }),
    ]

    const ids = rank([...editions, ...differentWorks]).map((item) => item.sourceId)

    expect(ids).toContain('phm-strong')
    expect(ids).toContain('phm-movie')
    expect(ids).toContain('phm-exercises')
    expect(ids).toContain('phm-summary')
    expect(ids).toContain('phm-collection')
    expect(ids).not.toContain('phm-weak')
    expect(ids).not.toContain('phm-deluxe')
    expect(ids).not.toContain('phm-inverted-author')
    expect(ids).not.toContain('phm-no-author')
    expect(ids).not.toContain('phm-translated')
    expect(ids).not.toContain('phm-slash-title')
  })

  it('ignores format and year labels when identifying an edition', () => {
    const editions = [
      book({ sourceId: 'paperback', title: 'The Quiet Novel: A Novel (Paperback)' }),
      book({ sourceId: 'ebook', title: 'The Quiet Novel (Ebook)', publishedDate: '2022' }),
      book({ sourceId: 'illustrated', title: 'The Quiet Novel: Illustrated Edition' }),
      book({ sourceId: 'year', title: 'The Quiet Novel (2024)' }),
    ]

    expect(rank(editions)).toHaveLength(1)
  })

  it('does not merge similar titles by different authors', () => {
    const original = book({
      sourceId: 'original',
      title: 'The Silent Patient',
      authors: ['Alex Michaelides'],
    })
    const differentAuthor = book({
      sourceId: 'different-author',
      title: 'The Silent Patient',
      authors: ['Another Author'],
    })

    expect(rank([original, differentAuthor]).map((item) => item.sourceId)).toEqual([
      'original',
      'different-author',
    ])
  })

  it('dedupes editions across separate query batches', () => {
    const firstBatch = rankSwipeBooks([
      {
        query,
        books: [book({ sourceId: 'first', title: 'The Quiet Novel', authors: ['Ada Author'] })],
      },
    ])
    const secondBatch = rankSwipeBooks(
      [
        {
          query,
          books: [
            book({
              sourceId: 'second',
              title: 'The Quiet Novel: A Novel (Hardcover)',
              authors: ['Ada Author'],
            }),
          ],
        },
      ],
      { seenWorks: firstBatch },
    )

    expect(secondBatch).toEqual([])
  })

  it('excludes another edition of a book the reader already interacted with', () => {
    const liked = book({
      sourceId: 'liked',
      title: 'The Quiet Novel',
      authors: ['Ada Author'],
    })
    const anotherEdition = book({
      sourceId: 'another-edition',
      title: 'The Quiet Novel: A Novel (Paperback)',
      authors: ['Ada Author'],
    })

    expect(rank([anotherEdition], { liked: [liked] })).toEqual([])
  })

  it('uses likes and passes as ranking signals', () => {
    const likedAuthor = book({
      sourceId: 'liked-profile',
      title: 'A Book Someone Kept',
      authors: ['Liked Author'],
    })
    const passedAuthor = book({
      sourceId: 'passed-profile',
      title: 'A Book Someone Passed',
      authors: ['Passed Author'],
    })
    const byLikedAuthor = book({
      sourceId: 'liked-match',
      title: 'Another Liked Author Book',
      authors: ['Liked Author'],
    })
    const byPassedAuthor = book({
      sourceId: 'passed-match',
      title: 'Another Passed Author Book',
      authors: ['Passed Author'],
    })

    const result = rank([byPassedAuthor, byLikedAuthor], {
      liked: [likedAuthor],
      passed: [passedAuthor],
    })

    expect(result.map((item) => item.sourceId)).toEqual(['liked-match', 'passed-match'])
  })

  it('keeps one work when two Google Books queries return it', () => {
    const weak = book({
      sourceId: 'query-one',
      title: 'The Quiet Novel',
      authors: ['Ada Author'],
      description: 'Short.',
    })
    const strong = book({
      sourceId: 'query-two',
      title: 'The Quiet Novel: A Novel',
      authors: ['Ada Author'],
      coverUrl: 'cover.jpg',
      ratingsCount: 200,
      averageRating: 4.4,
    })

    const result = rankSwipeBooks([
      { query: { ...query, query: 'first query' }, books: [weak] },
      { query: { ...query, query: 'second query' }, books: [strong] },
    ])

    expect(result.map((item) => item.sourceId)).toEqual(['query-two'])
  })

  it('deduplicates editions across batches and keeps the strongest record', () => {
    const first = book({
      sourceId: 'first-edition',
      title: 'The Quiet Novel (Paperback)',
      authors: ['Ada Author'],
      description: 'Short.',
    })
    const second = book({
      sourceId: 'second-edition',
      title: 'The Quiet Novel: A Novel (Hardcover)',
      authors: ['Ada Author'],
      coverUrl: 'cover.jpg',
      ratingsCount: 400,
      averageRating: 4.6,
      description: 'A fuller description that helps a reader choose this work.',
    })

    const initial: SwipeQueueState = { queue: [], seenWorks: [] }
    const afterFirst = applySwipeBatch(initial, [{ query, books: [first] }])
    const afterSecond = applySwipeBatch(afterFirst, [{ query, books: [second] }])

    expect(afterSecond.queue).toHaveLength(1)
    expect(afterSecond.queue[0].sourceId).toBe('second-edition')
    expect(afterSecond.seenWorks).toHaveLength(1)
  })

  it('is safe when two concurrent batch loads return the same work', () => {
    const weak = book({ sourceId: 'batch-a', title: 'The Quiet Novel', authors: ['Ada Author'] })
    const strong = book({
      sourceId: 'batch-b',
      title: 'The Quiet Novel: A Novel',
      authors: ['Ada Author'],
      coverUrl: 'cover.jpg',
      ratingsCount: 120,
      averageRating: 4.5,
    })
    const batches = [
      [{ query, books: [weak] }],
      [{ query, books: [strong] }],
    ]

    const apply = (ordered: typeof batches) =>
      ordered.reduce((state, results) => applySwipeBatch(state, results), {
        queue: [],
        seenWorks: [],
      } as SwipeQueueState)

    for (const ordered of [batches, [...batches].reverse()]) {
      const result = apply(ordered)
      expect(result.queue).toHaveLength(1)
      expect(result.queue[0].sourceId).toBe('batch-b')
    }
  })

  it('does not reintroduce a displayed work from a later batch', () => {
    const displayed = book({
      sourceId: 'displayed',
      title: 'The Silent Patient',
      authors: ['Alex Michaelides'],
    })
    const laterEdition = book({
      sourceId: 'later-edition',
      title: 'The Silent Patient: A Novel (Paperback)',
      authors: ['Alex Michaelides'],
    })

    const state = applySwipeBatch({ queue: [], seenWorks: [] }, [{ query, books: [displayed] }])
    const next = applySwipeBatch(state, [{ query, books: [laterEdition] }])

    expect(next.queue.map((item) => item.sourceId)).toEqual(['displayed'])
    expect(next.seenWorks).toHaveLength(1)
    expect(next.seenWorks[0].sourceId).toBe('displayed')
  })

  it('keeps similar titles by different authors separate during queue insertion', () => {
    const original = book({
      sourceId: 'original',
      title: 'The Silent Patient',
      authors: ['Alex Michaelides'],
    })
    const differentAuthor = book({
      sourceId: 'different-author',
      title: 'The Silent Patient',
      authors: ['Another Author'],
    })

    const state = applySwipeBatch(
      { queue: [], seenWorks: [] },
      [{ query, books: [original] }],
    )
    const next = applySwipeBatch(state, [{ query, books: [differentAuthor] }])

    expect(next.queue.map((item) => item.sourceId)).toEqual(['original', 'different-author'])
  })

  it('recognizes alternate titles and middle initials without merging unrelated books', () => {
    const translated = book({
      sourceId: 'translated',
      title: 'Proyek Hail Mary (Project Hail Mary, #1)',
      authors: ['Andy Weir'],
    })
    const plain = book({
      sourceId: 'plain',
      title: 'Project Hail Mary',
      authors: ['Andy T. Weir'],
    })
    const different = book({
      sourceId: 'different',
      title: 'Project Hail Mary',
      authors: ['Ryan Gosling'],
    })

    expect(applySwipeBatch({ queue: [], seenWorks: [] }, [{ query, books: [translated] }]).queue).toHaveLength(1)
    expect(
      applySwipeBatch(
        applySwipeBatch({ queue: [], seenWorks: [] }, [{ query, books: [translated] }]),
        [{ query, books: [plain] }],
      ).queue,
    ).toHaveLength(1)
    const rankedIds = rank([translated, plain, different]).map((item) => item.sourceId)
    expect(rankedIds).toHaveLength(2)
    expect(rankedIds).not.toContain('plain')
    expect(rankedIds).toContain('translated')
    expect(rankedIds).toContain('different')
  })

  it('excludes textbooks, workbooks and exam prep from every stack', () => {
    const academic = [
      book({
        sourceId: 'calculus',
        title: 'Calculus for Engineers',
        subtitle: 'An Applied College Textbook',
        categories: ['Mathematics', 'Education'],
        publisher: 'Pearson',
        description: 'A course textbook for first-year engineering students.',
      }),
      book({
        sourceId: 'sat-workbook',
        title: 'SAT Practice Workbook',
        subtitle: 'Test Prep and Study Guide',
        categories: ['Study Aids', 'Test Preparation'],
        publisher: 'Kaplan',
      }),
      book({
        sourceId: 'gre-prep',
        title: 'GRE Exam Preparation',
        categories: ['Test Preparation'],
      }),
      book({
        sourceId: 'teacher-edition',
        title: "Teacher's Edition: World History",
        categories: ['Education'],
      }),
    ]

    for (const candidate of academic) expect(isAcademicPublication(candidate)).toBe(true)
    expect(rank(academic)).toEqual([])
  })

  it('excludes journal articles, serials, proceedings and dissertations', () => {
    const academic = [
      book({
        sourceId: 'journal',
        title: 'Journal of Molecular Biology',
        subtitle: 'Volume 412, Issue 3',
        printType: 'MAGAZINE',
        industryIdentifiers: [{ type: 'ISSN', identifier: '0022-2836' }],
        publisher: 'Elsevier',
        categories: ['Biology', 'Academic'],
      }),
      book({
        sourceId: 'doi-article',
        title: 'Gene Expression in Coastal Species',
        description: 'Peer reviewed research article with a DOI and abstract.',
        industryIdentifiers: [{ type: 'OTHER', identifier: '10.1016/j.jmb.2024.01.001' }],
        publisher: 'Elsevier',
      }),
      book({
        sourceId: 'proceedings',
        title: 'Proceedings of the 2024 International Conference on Machine Learning',
        categories: ['Conference proceedings'],
        publisher: 'Springer',
      }),
      book({
        sourceId: 'dissertation',
        title: 'Doctoral Dissertation: Studies in Archival Memory',
        description: 'Submitted in partial fulfillment of the requirements for a PhD.',
        publisher: 'University Press',
      }),
    ]

    for (const candidate of academic) expect(isAcademicPublication(candidate)).toBe(true)
    expect(rank(academic)).toEqual([])
  })

  it('excludes technical manuals and scholarly reference publications', () => {
    const academic = [
      book({
        sourceId: 'manual',
        title: 'Advanced Networking Reference Manual',
        publisher: 'IEEE',
        categories: ['Technology & Engineering', 'Reference'],
      }),
      book({
        sourceId: 'encyclopedia',
        title: 'Encyclopedia of Modern Physics',
        categories: ['Reference', 'Science'],
        publisher: 'Elsevier',
      }),
      book({
        sourceId: 'handbook',
        title: 'The Oxford Handbook of Economic Theory',
        publisher: 'Oxford University Press',
        categories: ['Economics', 'Academic'],
      }),
    ]

    for (const candidate of academic) expect(isAcademicPublication(candidate)).toBe(true)
    expect(rank(academic)).toEqual([])
  })

  it('keeps general-reader science, history, memoir, fiction and essay collections', () => {
    const eligible = [
      book({
        sourceId: 'popular-science',
        title: 'The Nature of Stars',
        categories: ['Science', 'Nature'],
        publisher: 'Basic Books',
        description: 'An accessible introduction to the night sky for general readers.',
      }),
      book({
        sourceId: 'history',
        title: 'A Short History of Coastlines',
        categories: ['History'],
        publisher: 'Vintage',
      }),
      book({
        sourceId: 'memoir',
        title: 'Educated: A Memoir',
        categories: ['Biography & Autobiography', 'Memoir'],
        publisher: 'Random House',
      }),
      book({
        sourceId: 'novel',
        title: 'The Silent Patient',
        categories: ['Fiction', 'Mystery', 'Thriller'],
        publisher: 'Celadon Books',
      }),
      book({
        sourceId: 'essays',
        title: 'Essays from the Edge',
        categories: ['Essays', 'Literature'],
        publisher: 'Graywolf Press',
      }),
      book({
        sourceId: 'stories',
        title: 'Selected Short Stories',
        categories: ['Fiction', 'Short Stories'],
      }),
    ]

    for (const candidate of eligible) expect(isAcademicPublication(candidate)).toBe(false)
    expect(rank(eligible).map((item) => item.sourceId).sort()).toEqual(
      eligible.map((item) => item.sourceId).sort(),
    )
  })

  it('does not reject a book for one academic-looking signal', () => {
    const general = [
      book({
        sourceId: 'university-press',
        title: 'The Healing Power of Trees',
        categories: ['Nature', 'Science'],
        publisher: 'Harvard University Press',
      }),
      book({
        sourceId: 'volume-novel',
        title: 'Project Hail Mary, Volume 1',
        categories: ['Fiction', 'Science Fiction'],
        publisher: 'Ballantine Books',
      }),
      book({
        sourceId: 'science-subject',
        title: 'Why the Sky Is Blue',
        categories: ['Science'],
        publisher: 'Basic Books',
        description: 'A science book for curious readers.',
      }),
    ]

    for (const candidate of general) expect(isAcademicPublication(candidate)).toBe(false)
    expect(rank(general)).toHaveLength(general.length)
  })

  it('excludes literary journals, poetry magazines and serials with ordinary titles', () => {
    const serials = [
      book({
        sourceId: 'paris-review',
        title: 'The Paris Review',
        subtitle: 'No. 214',
        publishedDate: '2006',
        categories: ['American literature'],
        industryIdentifiers: [{ type: 'OTHER', identifier: 'VAND:30081039491109' }],
      }),
      book({
        sourceId: 'poetry-magazine',
        title: 'Poetry',
        subtitle: 'A Magazine of Verse, Volume 122, Issue 3',
        categories: ['Poetry', 'Periodicals'],
        publisher: 'Poetry Foundation',
        industryIdentifiers: [{ type: 'OTHER', identifier: 'OCLC:123456' }],
      }),
      book({
        sourceId: 'lippincott',
        title: "Lippincott's Monthly Magazine",
        subtitle: 'A Popular Journal of General Literature, Science and Politics',
        publishedDate: '1880',
        categories: ['American literature'],
        industryIdentifiers: [{ type: 'OTHER', identifier: 'CHI:21985046' }],
      }),
      book({
        sourceId: 'monist',
        title: 'The Monist',
        categories: ['Electronic journals'],
        description: 'Vols. 2 and 5 include appendices.',
        publishedDate: '1910',
        industryIdentifiers: [{ type: 'OTHER', identifier: 'VAND:30081042116792' }],
      }),
      book({
        sourceId: 'biography-quarterly',
        title: 'Biography',
        subtitle: 'An interdisciplinary quarterly.',
        categories: ['Biography'],
        publishedDate: '1998',
        industryIdentifiers: [{ type: 'OTHER', identifier: 'OHIOU:1002378531' }],
      }),
      book({
        sourceId: 'granta-issue',
        title: 'Granta 164: The Art of Advice',
        subtitle: 'Issue 164',
        categories: ['Literary Collections'],
        description: 'The latest issue of Granta explores the art of advice.',
        industryIdentifiers: [{ type: 'OTHER', identifier: 'OCLC:789012' }],
      }),
      book({
        sourceId: 'magazine-print-type',
        title: 'The Atlantic',
        printType: 'MAGAZINE',
        mainCategory: 'Magazines & Newspapers',
        publisher: 'The Atlantic Monthly Group',
        industryIdentifiers: [{ type: 'OTHER', identifier: 'OCLC:345678' }],
      }),
    ]

    for (const candidate of serials) {
      expect(isSerialPublication(candidate)).toBe(true)
      expect(isAcademicPublication(candidate)).toBe(true)
    }
    expect(rank(serials)).toEqual([])
  })

  it('excludes a journal issue identified only by an ISSN', () => {
    const journal = book({
      sourceId: 'literary-quarterly',
      title: 'A Quarterly Review of Books',
      publisher: 'A Journal Press',
      description: 'Recent essays and reviews from the current issue.',
      industryIdentifiers: [{ type: 'ISSN', identifier: '0022-2836' }],
    })

    expect(isSerialPublication(journal)).toBe(true)
    expect(rank([journal])).toEqual([])
  })

  it('keeps poetry, story and essay collections and novels that mention journals', () => {
    const legitimate = [
      book({
        sourceId: 'paris-review-anthology',
        title: 'The Paris Review Book',
        subtitle: 'Stories and Poems from Fifty Years',
        authors: ['Philip Roth'],
        categories: ['Fiction', 'Literary Collections'],
        publisher: 'Picador',
        coverUrl: 'cover.jpg',
        description: 'An anthology celebrating fifty years of a literary magazine.',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780312422387' }],
      }),
      book({
        sourceId: 'poetry-collection',
        title: 'Devotions',
        authors: ['Mary Oliver'],
        categories: ['Poetry'],
        publisher: 'Penguin',
        description: 'New and selected poems about the natural world.',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780143111242' }],
      }),
      book({
        sourceId: 'selected-stories',
        title: 'You Made Me Love You: Selected Stories, 1981-2018',
        authors: ['Alice Munro'],
        categories: ['Fiction', 'Short Stories'],
        publisher: 'Simon and Schuster',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781982148918' }],
      }),
      book({
        sourceId: 'essay-collection',
        title: 'Essays from the Edge',
        authors: ['A Writer'],
        categories: ['Essays', 'Literature'],
        publisher: 'Graywolf Press',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781555979000' }],
      }),
      book({
        sourceId: 'novel-mentioning-journal',
        title: 'The Blazing World',
        subtitle: 'A Novel',
        authors: ['Siri Hustvedt'],
        categories: ['Fiction'],
        publisher: 'Simon and Schuster',
        description: 'An artist writes a letter to the editor in an art journal.',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781476747231' }],
      }),
    ]

    for (const candidate of legitimate) {
      expect(isSerialPublication(candidate)).toBe(false)
      expect(isAcademicPublication(candidate)).toBe(false)
    }
    expect(rank(legitimate).map((item) => item.sourceId).sort()).toEqual(
      legitimate.map((item) => item.sourceId).sort(),
    )
  })

  it('rejects excluded publication forms and keeps scholarly relevance out of default swipe shelves', () => {
    const excludedPublications = [
      book({
        sourceId: 'literary-criticism',
        title: 'The Rise of the Novel',
        authors: ['Ian Watt'],
        categories: ['Literary Criticism', 'History'],
        publisher: 'University of California Press',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780520270570' }],
      }),
      book({
        sourceId: 'history-of-magazines',
        title: 'Fiction in American Magazines Before 1800',
        subtitle: 'An Annotated Catalogue',
        authors: ['A Scholar'],
        categories: ['Language Arts & Disciplines'],
        publisher: 'Union College Press',
        industryIdentifiers: [{ type: 'OTHER', identifier: 'STANFORD:36105006017490' }],
      }),
    ]

    for (const candidate of excludedPublications) {
      expect(isEligibleBook(candidate)).toBe(false)
      expect(isAcademicPublication(candidate)).toBe(true)
      expect(rank([candidate])).toEqual([])
    }

    // An ordinary standalone book about literary study remains eligible, but
    // only an explicit request makes it relevant enough for the stack.
    const scholarly = book({
      sourceId: 'scholarly-novel-history',
      title: 'A Scholarly History of Novels',
      authors: ['Ian Watt'],
      categories: ['History'],
      publisher: 'University of California Press',
      description: 'A scholarly study of how novels changed public reading.',
    })
    expect(isEligibleBook(scholarly)).toBe(true)
    expect(rank([scholarly])).toEqual([])
    expect(
      rankSwipeBooks([
        { query: { ...query, query: 'books about literary criticism' }, books: [scholarly] },
      ]),
    ).toEqual([scholarly])
  })

  it('filters serials from every batch, not only the first stack', () => {
    const readable = book({
      sourceId: 'readable-novel',
      title: 'A Quiet Novel',
      authors: ['Ada Author'],
    })
    const journal = book({
      sourceId: 'later-journal',
      title: 'Poetry',
      subtitle: 'A Magazine of Verse, Volume 122, Issue 3',
      categories: ['Literary periodicals'],
      industryIdentifiers: [{ type: 'OTHER', identifier: 'OCLC:123456' }],
    })
    const anotherBook = book({
      sourceId: 'another-novel',
      title: 'A Second Novel',
      authors: ['Ada Author'],
    })

    const first = applySwipeBatch({ queue: [], seenWorks: [] }, [{ query, books: [readable] }])
    const second = applySwipeBatch(first, [{ query, books: [journal, anotherBook] }])

    expect(second.queue.map((item) => item.sourceId)).toEqual(['readable-novel', 'another-novel'])
  })

  it('uses normalized search position so early hits outrank deep results', () => {
    const top = book({ sourceId: 'top', title: 'A Novel from the Top' })
    const deep = book({ sourceId: 'deep', title: 'A Novel from the Back' })
    const fillers = Array.from({ length: 8 }, (_, index) =>
      book({ sourceId: `filler-${index}`, title: `Another Novel ${index}` }),
    )
    const ranked = rank([top, ...fillers.slice(0, 6), deep, ...fillers.slice(6)])
    const ids = ranked.map((item) => item.sourceId)

    expect(ids).toContain('top')
    expect(ids).toContain('deep')
    expect(ids.indexOf('top')).toBeLessThan(ids.indexOf('deep'))
  })

  it('keeps original Google positions when ineligible records were filtered upstream', () => {
    const late = book({ sourceId: 'late', title: 'A Late Novel', googleResultIndex: 10 })
    const early = book({ sourceId: 'early', title: 'An Early Novel', googleResultIndex: 1 })

    expect(rank([late, early]).map((item) => item.sourceId)).toEqual(['early', 'late'])
  })

  it('weights a top placement repeated in two relevant searches more than one top placement', () => {
    const twice = book({ sourceId: 'twice', title: 'The Repeated Novel' })
    const once = book({ sourceId: 'once', title: 'The Single Novel' })
    const extra = book({ sourceId: 'extra', title: 'Another Single Novel' })

    const ranked = rankSwipeBooks([
      { query, books: [twice, once] },
      { query: { ...query, query: 'another relevant search' }, books: [twice, extra] },
    ])

    expect(ranked[0].sourceId).toBe('twice')
  })

  it('treats thousands of ratings at 4.3 as stronger than a 5.0 from six readers', () => {
    const widelyRead = book({
      sourceId: 'widely-read',
      title: 'A Widely Read Novel',
      ratingsCount: 5_000,
      averageRating: 4.3,
    })
    const obscure = book({
      sourceId: 'obscure',
      title: 'An Obscure Novel',
      ratingsCount: 6,
      averageRating: 5,
    })

    expect(rank([widelyRead, obscure]).map((item) => item.sourceId)).toEqual([
      'widely-read',
      'obscure',
    ])
  })

  it('does not award duplicate editions extra search-position credit', () => {
    const editions = [
      book({ sourceId: 'edition-1', title: 'The Same Novel', authors: ['Ada Author'] }),
      book({
        sourceId: 'edition-2',
        title: 'The Same Novel (Deluxe Edition)',
        authors: ['Ada Author'],
        description: 'Short blurb.',
      }),
      book({ sourceId: 'edition-3', title: 'The Same Novel', authors: ['Author Ada'] }),
    ]
    const rival = book({
      sourceId: 'rival',
      title: 'A Different Novel',
      authors: ['Nolan Reed'],
      ratingsCount: 50,
      averageRating: 4.3,
    })

    const ids = rank([...editions, rival]).map((item) => item.sourceId)
    expect(ids[0]).toBe('rival')
    expect(ids.some((id) => id.startsWith('edition-'))).toBe(true)
  })

  it('keeps selected fantasy and mystery shelves clear of history and criticism', () => {
    const fantasy = book({
      sourceId: 'fantasy',
      title: 'The Glass Keep',
      categories: ['Fiction', 'Fantasy'],
      ratingsCount: 12,
      averageRating: 4.2,
    })
    const mystery = book({
      sourceId: 'mystery',
      title: 'The Velvet Alibi',
      categories: ['Fiction', 'Mystery'],
      ratingsCount: 12,
      averageRating: 4.2,
    })
    const history = book({
      sourceId: 'history',
      title: 'The History of Empires',
      categories: ['History'],
      ratingsCount: 1_200,
      averageRating: 4.6,
    })
    const criticism = book({
      sourceId: 'criticism',
      title: 'Studies in the Modern Novel',
      categories: ['Literary Criticism'],
      ratingsCount: 900,
      averageRating: 4.7,
    })
    const fantasyQuery: SwipeQuery = {
      ...query,
      query: 'fantasy novels magic adventure',
      categoryId: 'fantasy',
    }
    const mysteryQuery: SwipeQuery = {
      ...query,
      query: 'mystery novels detective',
      categoryId: 'mystery',
    }

    const ids = rankSwipeBooks(
      [
        { query: fantasyQuery, books: [fantasy, history] },
        { query: mysteryQuery, books: [mystery, history] },
        { query: fantasyQuery, books: [criticism] },
      ],
      { categoryIds: ['fantasy', 'mystery'] },
    ).map((item) => item.sourceId)

    expect(ids.sort()).toEqual(['fantasy', 'mystery'])
    expect(ids).not.toContain('history')
    expect(ids).not.toContain('criticism')
  })

  it('removes nonmatching books from replacement batches and queue merges', () => {
    const fantasy = book({
      sourceId: 'fantasy',
      title: 'The Glass Keep',
      categories: ['Fiction', 'Fantasy'],
    })
    const strongerEdition = book({
      sourceId: 'fantasy edition',
      title: 'The Glass Keep',
      categories: ['Fiction', 'Fantasy'],
      ratingsCount: 400,
      averageRating: 4.5,
    })
    const history = book({
      sourceId: 'history',
      title: 'The History of Empires',
      categories: ['History'],
      ratingsCount: 10_000,
      averageRating: 4.8,
    })
    const romance = book({
      sourceId: 'romance',
      title: 'A Summer Romance',
      categories: ['Fiction', 'Romance'],
    })
    const fantasyQuery: SwipeQuery = { ...query, categoryId: 'fantasy' }
    const initial: SwipeQueueState = { queue: [fantasy], seenWorks: [fantasy] }

    const next = applySwipeBatch(
      initial,
      [{ query: fantasyQuery, books: [strongerEdition, history, romance] }],
      { categoryIds: ['fantasy'] },
    )

    expect(next.queue.map((item) => item.sourceId)).toEqual(['fantasy edition'])
    expect(next.seenWorks.map((item) => item.sourceId)).toEqual(['fantasy edition'])
  })

  it('never lets a highly rated journal pass the eligibility gate on a selected shelf', () => {
    const journal = book({
      sourceId: 'hot-journal',
      title: 'Poetry Today',
      subtitle: 'Volume 4, Issue 2',
      categories: ['Literary periodicals'],
      industryIdentifiers: [{ type: 'ISSN', identifier: '0022-2836' }],
      ratingsCount: 100_000,
      averageRating: 5,
    })
    const fantasy = book({
      sourceId: 'fantasy',
      title: 'The Paper Kingdom',
      categories: ['Fantasy'],
    })
    const fantasyQuery: SwipeQuery = { ...query, categoryId: 'fantasy' }

    const ids = rankSwipeBooks([{ query: fantasyQuery, books: [journal, fantasy] }], {
      categoryIds: ['fantasy'],
    }).map((item) => item.sourceId)

    expect(ids).toEqual(['fantasy'])
  })
})
