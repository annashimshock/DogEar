/**
 * Books routes: Google Books search plus grounded, personalized recommendations.
 *
 * The model chooses catalogue queries and writes the bookseller's note; every
 * returned book comes from Google Books. Conversational turns are persisted to
 * the built-in `ai-chats` / `ai-messages` collections through worker helpers,
 * never through client writes.
 */

import { generateText } from 'ai'
import { appendMessage, createDeepSpaceAI, getChat, loadMessages, updateChat } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import type { Hono } from 'hono'
import { resolveAuth } from './http-routes.js'
import { recordRoomStub } from './record-room.js'
import { deriveChatTitle } from '../ai/chat-title.js'
import type { PreferenceSummary } from '../lib/preferences'

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

export interface RecommendedBook extends BookResult {
  reason: string
}

interface StoredRecommendation {
  reply: string
  books: RecommendedBook[]
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

interface ChatTurnInput {
  role: 'user' | 'assistant'
  content: string
}

const strings = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))].slice(0, limit)
    : []

/** Re-validate the client-derived profile against the verified JWT subject. */
function readPreferences(value: unknown, userId: string): PreferenceSummary {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const saved = Array.isArray(raw.saved)
    ? raw.saved
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .slice(0, 20)
        .map((entry) => ({
          title: typeof entry.title === 'string' ? entry.title.slice(0, 200) : '',
          status: typeof entry.status === 'string' ? entry.status.slice(0, 30) : 'want',
        }))
        .filter((entry) => entry.title.length > 0)
    : []

  return {
    userId,
    liked: strings(raw.liked, 12),
    passed: strings(raw.passed, 12),
    saved,
    authors: strings(raw.authors, 12),
    categories: strings(raw.categories, 12),
    excludedIds: strings(raw.excludedIds, 100),
    conversationHints: strings(raw.conversationHints, 8).map((text) => text.slice(0, 200)),
  }
}

function hasPreferenceData(preferences: PreferenceSummary): boolean {
  return (
    preferences.liked.length > 0 ||
    preferences.passed.length > 0 ||
    preferences.saved.length > 0 ||
    preferences.authors.length > 0 ||
    preferences.categories.length > 0 ||
    preferences.conversationHints.length > 0
  )
}

function preferenceContext(preferences: PreferenceSummary): string {
  if (!hasPreferenceData(preferences)) {
    return 'Reader profile: new here, no saved or swiped books yet. Suggest a broad, welcoming starter shelf.'
  }
  return [
    'Reader profile from their own library and swipe history (use it, do not recite it):',
    `Liked or read: ${preferences.liked.join('; ') || 'none'}`,
    `Passed on (avoid these): ${preferences.passed.join('; ') || 'none'}`,
    `Library: ${preferences.saved.map((book) => `${book.title} (${book.status})`).join('; ') || 'none'}`,
    `Enjoyed authors: ${preferences.authors.join('; ') || 'none'}`,
    `Enjoyed categories: ${preferences.categories.join('; ') || 'none'}`,
    `Earlier requests to the bookseller: ${preferences.conversationHints.join(' | ') || 'none'}`,
  ].join('\n')
}

interface ExcludedBooks {
  ids: Set<string>
  titles: Set<string>
}

function isExcluded(book: BookResult, excluded: ExcludedBooks): boolean {
  return excluded.ids.has(book.sourceId) || excluded.titles.has(book.title.trim().toLowerCase())
}

interface GroundingOptions {
  env: Env
  token: string
  system: string
  prompt: string
  preferences: PreferenceSummary
  maxBooks?: number
}

/** One grounding pipeline shared by the chat and personalized-shelf endpoints. */
async function recommendGrounded({
  env,
  token,
  system,
  prompt,
  preferences,
  maxBooks = 8,
}: GroundingOptions): Promise<StoredRecommendation> {
  const factory = createDeepSpaceAI(env, 'anthropic', { authToken: token })
  const { text } = await generateText({
    model: factory('claude-haiku-5-5'),
    maxOutputTokens: 1200,
    system,
    prompt,
  })

  const suggestion = parseSuggestionJson(text)
  const queries = suggestion.queries.length > 0 ? suggestion.queries : ['literary fiction']
  const found = await Promise.all(
    queries.map(async (query) => {
      try {
        return (await googleSearch(query, 8, env.GOOGLE_BOOKS_API_KEY)).books
      } catch {
        return [] as BookResult[]
      }
    }),
  )

  const excluded: ExcludedBooks = {
    ids: new Set(preferences.excludedIds),
    titles: new Set(
      [...preferences.passed, ...preferences.saved.map((book) => book.title)].map((title) =>
        title.trim().toLowerCase(),
      ),
    ),
  }
  const seen = new Set<string>()
  const books = found
    .flat()
    .filter((book) => {
      if (seen.has(book.sourceId) || isExcluded(book, excluded)) return false
      seen.add(book.sourceId)
      return true
    })
    .slice(0, maxBooks)
    .map((book, index) => ({ ...book, reason: suggestion.reasons[index] ?? '' }))

  return {
    reply: suggestion.reply || 'Let me see what I can find on the shelves for you.',
    books,
  }
}

const BOOKSELLER_BASE = [
  'You are the bookseller at DogEar, a warm independent bookstore.',
  'Never name a specific title or author in your reply — describe moods and themes instead; the app supplies real titles from Google Books.',
  'Reply with JSON only, shaped exactly as:',
  '{"reply":"two or three warm sentences responding to the reader","queries":["google books search query","another query","a third query"],"reasons":["why the first book fits","why the second fits",...]}',
  'Queries must be broad catalogue searches (for example "literary fiction grief friendship"), not title lookups. Give one reason per expected book.',
].join(' ')

interface RecommendBody {
  message?: unknown
  chatId?: unknown
  userId?: unknown
  messageId?: unknown
  preferences?: unknown
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

  /** Grounded shelf for the "For You" grid, based on the reader's own records. */
  app.post('/api/books/personal', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Sign in to get recommendations.' }, 401)

    const body = await c.req.json<RecommendBody>().catch(() => null)
    if (body?.userId !== undefined && body.userId !== auth.userId) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const preferences = readPreferences(body?.preferences, auth.userId)
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''

    try {
      const result = await recommendGrounded({
        env: c.env,
        token,
        system: `${BOOKSELLER_BASE} ${preferenceContext(preferences)} Pick three search queries that fit the profile. Write each reason as a short note about why that kind of book suits this reader.`,
        prompt: 'Choose three real catalogue searches for this reader and write a short reason for each expected recommendation.',
        preferences,
      })
      return c.json({ ...result, basis: hasPreferenceData(preferences) ? 'personal' : 'starter' })
    } catch (error) {
      console.error('Personal recommendations failed:', error)
      return c.json(
        { error: 'The recommendation desk is momentarily unavailable. Try again in a moment.' },
        502,
      )
    }
  })

  /**
   * Bookseller chat. Grounded in Google Books, personalized by the reader's
   * own records, and persisted into the same ai-chats/ai-messages rows the
   * scaffold's chat infrastructure uses.
   */
  app.post('/api/books/recommend', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Sign in to get recommendations.' }, 401)

    const body = await c.req.json<RecommendBody>().catch(() => null)
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 8000) : ''
    if (!message) return c.json({ error: 'Tell us what you feel like reading.' }, 400)

    const chatId = typeof body?.chatId === 'string' ? body.chatId : ''
    if (!chatId) return c.json({ error: 'A conversation is required.' }, 400)
    if (body?.userId !== undefined && body.userId !== auth.userId) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const preferences = readPreferences(body?.preferences, auth.userId)
    const stub = recordRoomStub(c.env)
    const chat = await getChat(stub, chatId, auth.userId)
    if (!chat) return c.json({ error: 'Conversation not found.' }, 404)

    // History comes from the persisted rows, not from client component state,
    // so refreshed and reopened conversations keep their real context.
    const history = (await loadMessages(stub, chatId, auth.userId))
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row): ChatTurnInput => ({
        role: row.role === 'user' ? 'user' : 'assistant',
        content: row.content,
      }))
      .slice(-10)
    const transcript = [...history, { role: 'user' as const, content: message }]
      .map((turn) => `${turn.role === 'user' ? 'Reader' : 'Bookseller'}: ${turn.content}`)
      .join('\n')

    const userMessageId =
      typeof body?.messageId === 'string' && body.messageId.length < 200
        ? body.messageId
        : `umsg-${Date.now()}-${crypto.randomUUID()}`
    const assistantId = `asst-${Date.now()}-${crypto.randomUUID()}`

    try {
      const result = await recommendGrounded({
        env: c.env,
        token,
        system: `${BOOKSELLER_BASE}\n${preferenceContext(preferences)}`,
        prompt: `${transcript}\n\nRespond to the reader's latest request using their profile when relevant.`,
        preferences,
      })

      // Persist user → assistant → title using the worker helpers. All three
      // re-check ownership; the initial getChat already refused foreign ids.
      const userOk = await appendMessage(stub, {
        id: userMessageId,
        chatId,
        userId: auth.userId,
        role: 'user',
        content: message,
      })
      if (!userOk) throw new Error('Could not persist the reader message')

      const assistantOk = await appendMessage(stub, {
        id: assistantId,
        chatId,
        userId: auth.userId,
        role: 'assistant',
        content: result.reply,
        // Keep the grounded books and their explanations in the conversation
        // record so a restored chat shows the same shelf with its reasons.
        parts: [{ type: 'dogear.recommendations', reply: result.reply, books: result.books }],
      })
      if (!assistantOk) throw new Error('Could not persist the bookseller reply')

      if (!chat.title || chat.title === 'New chat') {
        await updateChat(stub, chatId, auth.userId, { title: deriveChatTitle(message) })
      }

      return c.json({ reply: result.reply, books: result.books, assistantId })
    } catch (error) {
      console.error('Recommendation failed:', error)
      return c.json(
        { error: 'The bookseller is momentarily unavailable. Try again in a moment.' },
        502,
      )
    }
  })
}
