import { describe, expect, it } from 'vitest'
import type { Book, SwipeQuery } from './books'
import { applySwipeBatch, rankSwipeBooks, type SwipeQueueState } from './swipe-ranking'

function book(overrides: Partial<Book> & Pick<Book, 'sourceId' | 'title'>): Book {
  return {
    source: 'google_books',
    authors: [],
    description: 'A real catalogue description long enough to be useful to a reader.',
    categories: ['Fiction'],
    publishedDate: '2023',
    coverUrl: null,
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
})
