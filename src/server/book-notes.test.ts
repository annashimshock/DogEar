import { describe, expect, it } from 'vitest'
import type { Book } from '../lib/books'
import { intentForFocus } from '../lib/book-relevance'
import { detectRequestFocus, type ReaderProfile } from '../lib/recommendations'
import {
  applyGroundedReasons,
  curateGroundedBooks,
  parseGroundedReasons,
  parseJsonObject,
  parseSuggestionJson,
  responseText,
  selectedSourceIds,
} from './book-notes'

function book(sourceId: string, title: string, authors = ['Ada Author']): Book {
  return {
    source: 'google_books',
    sourceId,
    title,
    authors,
    description: 'A real catalogue description.',
    categories: ['Fiction'],
    publishedDate: '2024',
    coverUrl: null,
    printType: 'BOOK',
    publisher: 'DogEar Test Press',
    industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780143127741' }],
  }
}

const books = [book('first-id', 'First Novel'), book('second-id', 'Second Novel')]
const profile: ReaderProfile = { liked: [], passed: [], saved: [] }
const focus = detectRequestFocus('')

describe('grounded category enforcement', () => {
  it('cannot select an unrelated or ineligible book even when the model names it', () => {
    const fantasy = book('fantasy-id', 'The Glass Keep')
    fantasy.categories = ['Fiction', 'Fantasy']
    const history = book('history-id', 'A History of Empires')
    history.categories = ['History']
    const journal = book('journal-id', 'Fantasy Review')
    journal.categories = ['Literary periodicals']
    journal.subtitle = 'Volume 4, Issue 2'
    journal.industryIdentifiers = [{ type: 'ISSN', identifier: '0022-2836' }]

    const chosen = curateGroundedBooks(
      [fantasy, history, journal],
      {
        selected: [history.sourceId, journal.sourceId, fantasy.sourceId],
        reasons: {
          [history.sourceId]: 'A History of Empires is a sweeping history.',
          [fantasy.sourceId]: 'The Glass Keep is fantasy from the supplied catalogue.',
        },
      },
      { ...profile, categoryIds: ['fantasy'] },
      focus,
      8,
      ['fantasy'],
    )

    expect(chosen.map((entry) => entry.sourceId)).toEqual(['fantasy-id'])
  })

  it('cannot select a book with missing publisher or category metadata', () => {
    const fantasy = book('fantasy-id', 'The Glass Keep')
    fantasy.categories = ['Fantasy']
    const noPublisher = book('no-publisher-id', 'The Paper Crown')
    noPublisher.publisher = '   '
    noPublisher.categories = ['Fantasy']
    const noCategories = book('no-categories-id', 'The Hidden Gate')
    noCategories.categories = []
    noCategories.mainCategory = '   '

    const chosen = curateGroundedBooks(
      [fantasy, noPublisher, noCategories],
      {
        selected: [noPublisher.sourceId, noCategories.sourceId, fantasy.sourceId],
        reasons: {
          [fantasy.sourceId]: 'The Glass Keep is fantasy from the supplied catalogue.',
        },
      },
      { ...profile, categoryIds: ['fantasy'] },
      focus,
      8,
      ['fantasy'],
    )

    expect(chosen.map((entry) => entry.sourceId)).toEqual(['fantasy-id'])
  })
})

describe('AI JSON parsing', () => {
  it('reads JSON returned directly', () => {
    const raw = '{"reply":"Here is a shelf.","queries":["literary fiction"]}'
    expect(parseJsonObject(raw)).toEqual({
      reply: 'Here is a shelf.',
      queries: ['literary fiction'],
    })
    expect(parseSuggestionJson(raw)?.queries).toEqual(['literary fiction'])
  })

  it('reads JSON inside a Markdown code fence', () => {
    const raw = '```json\n{"reply":"A shelf for you.","queries":["mystery novels"]}\n```'
    expect(parseSuggestionJson(raw)).toEqual({
      reply: 'A shelf for you.',
      queries: ['mystery novels'],
    })
  })

  it('reads one JSON object surrounded by explanatory text', () => {
    const raw =
      'Here is the reply (not the {"reply":"example"} field): ' +
      '{"reply":"A shelf for you.","queries":["fantasy novels"]} Thanks!'
    expect(parseSuggestionJson(raw)).toEqual({
      reply: 'A shelf for you.',
      queries: ['fantasy novels'],
    })
  })

  it('collects text from every generated step when the final text is empty', () => {
    expect(
      responseText({
        content: [
          { type: 'reasoning', text: 'thinking about the shelf' },
          { type: 'text', text: '{"reply":"From an earlier step.","queries":[]}' },
        ],
        text: '',
      }),
    ).toBe('{"reply":"From an earlier step.","queries":[]}')
    expect(responseText({ text: '{"reply":"Final step.","queries":[]}' })).toBe(
      '{"reply":"Final step.","queries":[]}',
    )
  })

  it('returns no object for empty or malformed responses without throwing', () => {
    expect(parseJsonObject('')).toBeNull()
    expect(parseJsonObject('   ')).toBeNull()
    expect(parseJsonObject('{"reply":')).toBeNull()
    expect(parseSuggestionJson('The model refused to answer in JSON.')).toBeNull()
  })

  it('falls back when explanation fields are missing or positional', () => {
    expect(parseGroundedReasons('{"reasons":[]}', books).size).toBe(0)
    expect(
      parseGroundedReasons('{"reasons":["“First Novel” is fiction."]}', books).size,
    ).toBe(0)
    expect(
      parseGroundedReasons('{"notes":{"first-id":"“First Novel” is fiction."}}', books).size,
    ).toBe(0)
  })

  it('uses grounded fallbacks when the model response cannot be parsed', () => {
    const result = applyGroundedReasons(books, 'No JSON here', profile, focus)
    expect(result.map((item) => item.reason)).toEqual([
      '“First Novel” is fiction from the fiction shelves.',
      '“Second Novel” is fiction from the fiction shelves.',
    ])
  })

  it('maps grounded reasons by Google Books id, independent of object order', () => {
    const raw = JSON.stringify({
      reasons: {
        'second-id': '“Second Novel” is fiction from the fiction shelves.',
        'first-id': '“First Novel” is fiction from the fiction shelves.',
        'unknown-id': '“Unknown Novel” is fiction from the fiction shelves.',
      },
    })
    const reasons = parseGroundedReasons(raw, books)
    expect(reasons.size).toBe(2)
    expect(reasons.get('first-id')).toContain('First Novel')
    expect(reasons.get('second-id')).toContain('Second Novel')
    expect(reasons.has('unknown-id')).toBe(false)

    const applied = applyGroundedReasons(books, raw, profile, focus)
    expect(applied[0].reason).toContain('First Novel')
    expect(applied[1].reason).toContain('Second Novel')
    expect(applied[0].reason).not.toContain('Second Novel')
  })

  it('accepts explicit source ids in an array of reason objects', () => {
    const raw = JSON.stringify({
      reasons: [
        { sourceId: 'second-id', reason: '“Second Novel” is fiction from the fiction shelves.' },
        { sourceId: 'first-id', reason: '“First Novel” is fiction from the fiction shelves.' },
      ],
    })
    const reasons = parseGroundedReasons(raw, books)
    expect(reasons.get('first-id')).toContain('First Novel')
    expect(reasons.get('second-id')).toContain('Second Novel')
  })
})

describe('grounded AI book selection', () => {
  const journal = book('journal-id', 'Journal of Coastal Studies', [])
  journal.categories = ['Periodicals']
  journal.industryIdentifiers = [{ type: 'ISSN', identifier: '0022-2836' }]
  const third = book('third-id', 'Third Novel')
  const candidates = [books[0], journal, books[1], third]

  it('ignores unknown and ineligible ids and fills from another eligible record', () => {
    const parsed = parseJsonObject(
      JSON.stringify({
        selected: ['invented-id', 'journal-id', 'third-id'],
        reasons: { 'third-id': '“Third Novel” is fiction from the fiction shelves.' },
      }),
    )
    expect(selectedSourceIds(parsed, candidates, 8)).toEqual(['third-id'])

    const curated = curateGroundedBooks(candidates, parsed, profile, focus, 8)
    expect(curated.map((item) => item.sourceId)).toEqual([
      'third-id',
      'first-id',
      'second-id',
    ])
    expect(curated[0].reason).toContain('Third Novel')
  })

  it('accepts reason keys as an implicit selection', () => {
    const parsed = parseJsonObject(
      JSON.stringify({
        reply: 'Here is a shelf.',
        reasons: { 'second-id': '“Second Novel” is fiction from the fiction shelves.' },
      }),
    )
    expect(selectedSourceIds(parsed, candidates, 8)).toEqual(['second-id'])
    expect(curateGroundedBooks(candidates, parsed, profile, focus, 1)).toEqual([
      {
        ...books[1],
        reason: '“Second Novel” is fiction from the fiction shelves.',
      },
    ])
  })

  it('never invents a book when the model output cannot be parsed', () => {
    const curated = curateGroundedBooks(candidates, null, profile, focus, 2)
    expect(curated).toHaveLength(2)
    for (const item of curated) {
      expect(candidates.some((candidate) => candidate.sourceId === item.sourceId)).toBe(true)
    }
    expect(curated.some((item) => item.sourceId === 'journal-id')).toBe(false)
  })

  it('cannot let AI curation bypass eligibility or the default relevance gate', () => {
    const excluded = book('criticism-id', 'The Rise of the Novel', ['Ian Watt'])
    excluded.categories = ['Literary Criticism', 'History']
    excluded.publisher = 'University of California Press'
    const scholarly = book('scholarly-id', 'A Scholarly History of Novels', ['Ian Watt'])
    scholarly.categories = ['History']
    scholarly.publisher = 'University of California Press'
    scholarly.description = 'A scholarly study of how novels changed public reading.'
    const pool = [excluded, scholarly, ...books]
    const parsed = parseJsonObject(
      JSON.stringify({
        selected: ['criticism-id', 'scholarly-id', 'second-id'],
        reasons: {
          'criticism-id': '“The Rise of the Novel” is literary criticism.',
          'scholarly-id': '“A Scholarly History of Novels” examines the novel.',
        },
      }),
    )

    // The excluded publication form stays out even for an explicit request.
    const explicitFocus = detectRequestFocus('I want books about literary criticism')
    const explicitIntent = intentForFocus(explicitFocus)
    expect(selectedSourceIds(parsed, pool, 8)).toEqual(['second-id'])
    expect(curateGroundedBooks(pool, parsed, profile, focus, 8).map((item) => item.sourceId)).toEqual([
      'second-id',
      'first-id',
    ])
    expect(selectedSourceIds(parsed, pool, 8, explicitIntent)).not.toContain('criticism-id')
    expect(selectedSourceIds(parsed, pool, 8, explicitIntent)).toEqual(['scholarly-id', 'second-id'])
    expect(
      curateGroundedBooks(pool, parsed, profile, explicitFocus, 8).map((item) => item.sourceId),
    ).not.toContain('criticism-id')
    expect(
      curateGroundedBooks(pool, parsed, profile, explicitFocus, 8).map((item) => item.sourceId),
    ).toEqual(['scholarly-id', 'second-id', 'first-id'])
  })
})
