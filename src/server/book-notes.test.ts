import { describe, expect, it } from 'vitest'
import type { Book } from '../lib/books'
import { detectRequestFocus, type ReaderProfile } from '../lib/recommendations'
import {
  applyGroundedReasons,
  parseGroundedReasons,
  parseJsonObject,
  parseSuggestionJson,
  responseText,
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
  }
}

const books = [book('first-id', 'First Novel'), book('second-id', 'Second Novel')]
const profile: ReaderProfile = { liked: [], passed: [], saved: [] }
const focus = detectRequestFocus('')

describe('bookseller JSON parsing', () => {
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
