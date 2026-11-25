/**
 * Books routes: real Google Books search plus a bookseller-style recommendation
 * endpoint. Recommendations come from the DeepSpace AI proxy, then every
 * suggested title is resolved through Google Books before it reaches the UI.
 */

import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import type { Hono } from 'hono'
import { resolveAuth } from './http-routes.js'

interface GoogleBook {
  id: string
  volumeInfo?: {
    title?: string
    authors?: string[]
    description?: string
    categories?: string[]
    publishedDate?: string
    imageLinks?: {
      thumbnail?: string
    }
  }
}

interface GoogleBooksResponse {
  totalItems?: number
  items?: GoogleBook[]
}

export interface BookResult {
  source: string
  sourceId: string
  title: string
  authors: string[]
  description: string
  categories: string[]
  publishedDate: string
  coverUrl: string | null
}

function toBook(item: GoogleBook): BookResult {
  const info = item.volumeInfo ?? {}
  const thumbnail = info.imageLinks?.thumbnail

  return {
    source: 'google_books',
    sourceId: item.id,
    title: info.title ?? 'Untitled',
    authors: info.authors ?? [],
    description: info.description ?? '',
    categories: info.categories ?? [],
    publishedDate: info.publishedDate ?? '',
    coverUrl: thumbnail?.replace(/^http:/, 'https:') ?? null,
  }
}

class GoogleBooksError extends Error {
  constructor(
    readonly status: number,
    readonly details: string,
  ) {
    super(`Google Books returned ${status}`)
  }
}

async function googleSearch(
  query: string,
  limit: number,
  apiKey: string,
): Promise<{ books: BookResult[]; totalItems: number }> {
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', query)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('maxResults', String(limit))
  url.searchParams.set('printType', 'books')

  const response = await fetch(url)
  if (!response.ok) {
    const details = await response.text()
    console.error('Google Books API error:', { status: response.status, details })
    throw new GoogleBooksError(response.status, details)
  }

  const data = (await response.json()) as GoogleBooksResponse
  return {
    books: (data.items ?? []).map(toBook),
    totalItems: data.totalItems ?? 0,
  }
}

/** Models occasionally wrap JSON in prose or code fences; take the object. */
function parseSuggestionJson(raw: string): { reply: string; queries: string[]; reasons: string[] } {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No JSON in model response')

  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    reply?: unknown
    queries?: unknown
    reasons?: unknown
  }

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
    queries: strings(parsed.queries).slice(0, 3),
    reasons: strings(parsed.reasons).slice(0, 8),
  }
}

interface RecommendBody {
  message?: unknown
  history?: unknown
}

function readHistory(value: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is { role?: unknown; content?: unknown } => !!entry && typeof entry === 'object')
    .map((entry): { role: 'user' | 'assistant'; content: string } => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: typeof entry.content === 'string' ? entry.content.slice(0, 2000) : '',
    }))
    .filter((entry) => entry.content.length > 0)
    .slice(-8)
}

export function registerBookRoutes(app: Hono<AppContext>): void {
  app.get('/api/books/search', async (c) => {
    const query = c.req.query('q')?.trim()

    if (!query) {
      return c.json({ error: 'A search query is required.' }, 400)
    }

    const requestedLimit = Number(c.req.query('limit') ?? 12)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(40, Math.max(1, Math.floor(requestedLimit)))
      : 12

    try {
      const { books, totalItems } = await googleSearch(query, limit, c.env.GOOGLE_BOOKS_API_KEY)
      return c.json({ totalItems, books })
    } catch (error) {
      if (error instanceof GoogleBooksError) {
        console.error('Google Books search failed:', error)
        return c.json(
          {
            error: 'Google Books search failed.',
            googleStatus: error.status,
            details: error.details,
          },
          502,
        )
      }
      console.error('Google Books search failed:', error)
      return c.json({ error: 'Unable to search for books right now.' }, 500)
    }
  })

  /**
   * Conversational recommendations. The model picks Google Books search
   * queries and writes the bookseller's note; the actual books always come
   * from Google Books, never from the model's memory.
   */
  app.post('/api/books/recommend', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Sign in to get recommendations.' }, 401)

    const body = await c.req.json<RecommendBody>().catch(() => null)
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 8000) : ''
    if (!message) return c.json({ error: 'Tell us what you feel like reading.' }, 400)

    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const history = readHistory(body?.history)
    const transcript = history
      .map((turn) => `${turn.role === 'user' ? 'Reader' : 'Bookseller'}: ${turn.content}`)
      .join('\n')

    try {
      const modelFactory = createDeepSpaceAI(c.env as Env, 'anthropic', { authToken: token })
      const { text } = await generateText({
        model: modelFactory('claude-haiku-5-5'),
        maxOutputTokens: 1200,
        system: [
          'You are the bookseller at DogEar, a warm independent bookstore. Recommend books a real reader would enjoy, using a literary, conversational voice.',
          'Never name a specific title or author in your reply — describe moods and themes instead; the app supplies real titles from Google Books.',
          'Reply with JSON only, shaped exactly as:',
          '{"reply":"two or three warm sentences responding to the reader","queries":["google books search query","another query","a third query"],"reasons":["why the first book fits","why the second fits",...]}',
          'Queries must be broad catalogue searches (for example "literary fiction grief friendship"), not title lookups. Give one reason per expected book.',
        ].join(' '),
        prompt: `${transcript ? `${transcript}\n` : ''}Reader: ${message}`,
      })

      const suggestion = parseSuggestionJson(text)
      const queries = suggestion.queries.length > 0 ? suggestion.queries : ['literary fiction']

      const found = await Promise.all(
        queries.map(async (query) => {
          try {
            return (await googleSearch(query, 6, c.env.GOOGLE_BOOKS_API_KEY)).books
          } catch {
            return [] as BookResult[]
          }
        }),
      )

      const seen = new Set<string>()
      const books = found
        .flat()
        .filter((book) => {
          if (seen.has(book.sourceId)) return false
          seen.add(book.sourceId)
          return true
        })
        .slice(0, 8)
        .map((book, index) => ({ ...book, reason: suggestion.reasons[index] ?? '' }))

      return c.json({
        reply:
          suggestion.reply ||
          'Let me see what I can find on the shelves for you.',
        books,
      })
    } catch (error) {
      console.error('Recommendation failed:', error)
      return c.json(
        { error: 'The bookseller is momentarily unavailable. Try again in a moment.' },
        502,
      )
    }
  })
}
