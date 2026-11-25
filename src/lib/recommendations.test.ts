import { describe, expect, it, vi } from 'vitest'
import type { Book } from './books'
import {
  detectRequestFocus,
  fallbackQueries,
  fallbackReason,
  groundedReason,
  hasBehavior,
  loadReaderProfile,
  mergeProfile,
  profileContext,
  rankRecommendations,
  scoreCandidate,
  type ReaderProfile,
} from './recommendations'
import { buildPreferenceSummary } from './preferences'

function book(title: string, categories: string[], authors: string[] = ['Ada Author']): Book {
  return {
    source: 'google_books',
    sourceId: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    authors,
    description: 'A real catalogue description from Google Books.',
    categories,
    publishedDate: '2024-01-01',
    coverUrl: 'https://example.com/cover.jpg',
    averageRating: 4.4,
    ratingsCount: 220,
  }
}

const FANTASY = book('The Paper Crown', ['Fiction', 'Fantasy'], ['Rowan Vale'])
const FANTASY_TWO = book('The Glass Gate', ['Fantasy'], ['Rowan Vale'])
const LITERARY = book('Quiet Rooms', ['Fiction', 'Literary Fiction'], ['Mara Fields'])
const HISTORICAL = book('The Long Winter', ['Fiction', 'Historical Fiction'], ['Iris Hale'])
const HISTORY = book('A History of Coastlines', ['History'], ['Nolan Reed'])
const TEXTBOOK = book('World History Textbook', ['Education', 'History'], ['Exam Board'])

function profile(partial: Partial<ReaderProfile> = {}): ReaderProfile {
  return { liked: [], passed: [], saved: [], ...partial }
}

function noFocus() {
  return detectRequestFocus('')
}

describe('reader profile data flow', () => {
  it('loads fresh swipe and library rows through the record tool on every call', async () => {
    let interactions = [
      {
        userId: 'reader-1',
        bookId: 'paper-crown',
        action: 'like',
        bookData: JSON.stringify(FANTASY),
      },
      {
        userId: 'reader-1',
        bookId: 'quiet-rooms',
        action: 'pass',
        bookData: JSON.stringify(LITERARY),
      },
    ]
    let saved = [
      {
        userId: 'reader-1',
        bookId: 'glass-gate',
        status: 'reading',
        bookData: JSON.stringify(FANTASY_TWO),
      },
    ]
    const execute = vi.fn(async (toolName: string, params: Record<string, unknown>) => {
      const collection = params.collection
      if (toolName !== 'records.query') throw new Error(`unexpected tool ${toolName}`)
      expect(params.where).toEqual({ userId: 'reader-1' })
      return {
        success: true,
        data: {
          records: (collection === 'book_interactions' ? interactions : saved).map((data, index) => ({
            recordId: `row-${index}`,
            data,
          })),
        },
      }
    })

    const first = await loadReaderProfile(execute, 'reader-1')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(first.liked.map((item) => item.title)).toEqual(['The Paper Crown'])
    expect(first.passed.map((item) => item.title)).toEqual(['Quiet Rooms'])
    expect(first.saved).toEqual([{ ...FANTASY_TWO, status: 'reading' }])

    // A new swipe after the first request must appear in the next one.
    interactions = [...interactions, {
      userId: 'reader-1',
      bookId: 'long-winter',
      action: 'like',
      bookData: JSON.stringify(HISTORICAL),
    }]
    const second = await loadReaderProfile(execute, 'reader-1')
    expect(second.liked.map((item) => item.title)).toEqual(['The Paper Crown', 'The Long Winter'])
    expect(hasBehavior(second)).toBe(true)
  })

  it('folds the client snapshot in without dropping persisted books', () => {
    const persisted = profile({ liked: [FANTASY] })
    const submitted = buildPreferenceSummary(
      'reader-1',
      [{ ...LITERARY, recordId: 'r1', status: 'read', notes: '' }],
      [{ ...HISTORICAL, recordId: 'i1', action: 'pass' }],
      [],
    )
    const merged = mergeProfile(persisted, submitted)
    expect(merged.liked).toEqual([FANTASY])
    expect(merged.passed.map((item) => item.title)).toContain('The Long Winter')
    expect(merged.saved.map((item) => item.title)).toContain('Quiet Rooms')
  })

  it('derives positive authors and categories from every saved shelf', () => {
    const summary = buildPreferenceSummary(
      'reader-1',
      [
        { ...FANTASY, recordId: 'r1', status: 'want', notes: '' },
        { ...LITERARY, recordId: 'r2', status: 'reading', notes: '' },
      ],
      [],
      ['I would like a long book'],
    )
    expect(summary.authors).toContain('Rowan Vale')
    expect(summary.authors).toContain('Mara Fields')
    expect(summary.categories).toContain('Fantasy')
    expect(summary.excludedIds).toContain(FANTASY.sourceId)
    expect(summary.conversationHints).toEqual(['I would like a long book'])
  })
})

describe('recommendation quality', () => {
  it('gives a new reader a fiction-first shelf and filters textbooks', () => {
    const candidates = [HISTORY, TEXTBOOK, FANTASY, LITERARY, HISTORICAL]
    const ranked = rankRecommendations(candidates, profile())
    expect(ranked.map((item) => item.title)).not.toContain('World History Textbook')
    expect(ranked.slice(0, 3).every((item) => item.categories.some((c) => /fiction/i.test(c)))).toBe(
      true,
    )
  })

  it('promotes fantasy when the reader consistently likes fantasy books', () => {
    // Likes are different works by the same author in the same category; the
    // exact liked book itself stays excluded from future shelves.
    const likedFantasy = book('A Different Crown', ['Fantasy'], ['Rowan Vale'])
    const likedFantasyTwo = book('Another Gate', ['Fiction', 'Fantasy'], ['Rowan Vale'])
    const likedFantasyThree = book('Third Vale Tale', ['Fantasy'], ['Rowan Vale'])
    const fantasyLikes = profile({ liked: [likedFantasy, likedFantasyTwo, likedFantasyThree] })
    const anotherFantasy = book('The Hidden Tower', ['Fantasy'], ['Rowan Vale'])
    const candidates = [LITERARY, FANTASY, anotherFantasy, HISTORY]
    const ranked = rankRecommendations(candidates, fantasyLikes)
    expect(ranked.slice(0, 2).map((item) => item.title)).toEqual(
      expect.arrayContaining(['The Paper Crown', 'The Hidden Tower']),
    )

    // Repetition strengthens the signal: one like cannot beat three.
    const oneLike = profile({ liked: [FANTASY] })
    expect(scoreCandidate(FANTASY, fantasyLikes, noFocus())).toBeGreaterThan(
      scoreCandidate(FANTASY, oneLike, noFocus()),
    )
  })

  it('demotes books similar to repeated passes', () => {
    const passed = profile({
      passed: [
        book('Passed One', ['Fiction', 'Historical Fiction'], ['Iris Hale']),
        book('Passed Two', ['Historical Fiction'], ['Iris Hale']),
        book('Passed Three', ['Historical Fiction'], ['Iris Hale']),
      ],
    })
    const before = scoreCandidate(HISTORICAL, profile(), noFocus())
    const after = scoreCandidate(HISTORICAL, passed, noFocus())
    expect(after).toBeLessThan(before)

    const ranked = rankRecommendations([HISTORICAL, HISTORY, FANTASY, LITERARY], passed)
    expect(ranked.map((item) => item.title)).toContain('The Paper Crown')
    expect(ranked).not.toContainEqual(HISTORICAL)
  })

  it('honors an explicit history request without opening the textbook shelf', () => {
    const focus = detectRequestFocus('I want nonfiction history books about coastlines')
    expect(focus.history).toBe(true)
    expect(focus.nonfiction).toBe(true)

    const ranked = rankRecommendations([FANTASY, HISTORY, TEXTBOOK], profile(), {
      focus,
    })
    expect(ranked[0].title).toBe('A History of Coastlines')
    expect(ranked).not.toContainEqual(TEXTBOOK)

    const academicFocus = detectRequestFocus('I need a history textbook for my course')
    expect(academicFocus.academic).toBe(true)
    expect(rankRecommendations([TEXTBOOK, HISTORY], profile(), { focus: academicFocus })).toContainEqual(
      TEXTBOOK,
    )
  })

  it('lets a specific request outweigh a different general taste', () => {
    const nonfictionReader = profile({
      liked: [book('Other Coastlines', ['History'], ['Nolan Reed'])],
    })
    const fantasyFocus = detectRequestFocus('I want fantasy novels')
    const ranked = rankRecommendations([HISTORY, FANTASY], nonfictionReader, {
      focus: fantasyFocus,
    })
    expect(ranked[0].title).toBe('The Paper Crown')
  })

  it('treats historical and science fiction as fiction, not nonfiction requests', () => {
    const historical = detectRequestFocus('Suggest some historical fiction novels')
    expect(historical.fiction).toBe(true)
    expect(historical.history).toBe(false)
    expect(historical.nonfiction).toBe(false)
    expect(fallbackQueries(historical)[0]).toContain('fiction')

    const scienceFiction = detectRequestFocus('I want science fiction novels')
    expect(scienceFiction.fiction).toBe(true)
    expect(scienceFiction.nonfiction).toBe(false)
    expect(fallbackQueries(scienceFiction)[0]).toContain('fiction')
  })

  it('demotes scholarly publications without hiding relevant science', () => {
    const scholarly = book('Studies in Modern Literature', ['Literary Criticism'], ['A. Scholar'])
    const science = book('The Nature of Stars', ['Science', 'Nature'], ['N. Reed'])
    const ranked = rankRecommendations([scholarly, science], profile(), {
      focus: detectRequestFocus('accessible science books'),
    })
    expect(ranked[0].title).toBe('The Nature of Stars')
    expect(ranked).toContainEqual(scholarly)
  })

  it('keeps chat hints out of the behavioral profile', () => {
    const context = profileContext(profile(), ['I like history'], noFocus())
    expect(context).toContain('Liked: none')
    expect(context).toContain('Earlier chat topics (context only')
  })
})

describe('recommendation explanations', () => {
  it('rejects generic model notes and accepts notes tied to real metadata', () => {
    expect(groundedReason("You'll love this one!", LITERARY)).toBeNull()
    expect(groundedReason('A beautifully written story about friendship', LITERARY)).toBeNull()
    expect(
      groundedReason('Quiet Rooms is literary fiction by Mara Fields.', LITERARY),
    ).toBe('Quiet Rooms is literary fiction by Mara Fields.')
  })

  it('builds a grounded fallback from the record and matched signals', () => {
    const liked = profile({ liked: [book('Vale Reader', ['Fantasy'], ['Rowan Vale'])] })
    expect(fallbackReason(FANTASY, liked, noFocus())).toContain('Rowan Vale')
    expect(fallbackReason(HISTORY, profile(), noFocus())).toContain('nonfiction')
    expect(fallbackReason(HISTORY, profile(), detectRequestFocus('history books'))).toContain(
      'history',
    )
  })
})
