/**
 * Books routes: Google Books search plus grounded, personalized recommendations.
 *
 * The model chooses catalogue queries and writes the bookseller's note; every
 * returned book comes from Google Books. Conversational turns are persisted to
 * the built-in `ai-chats` / `ai-messages` collections through worker helpers,
 * never through client writes.
 */

import { generateText } from 'ai'
import {
  appendMessage,
  createDeepSpaceAI,
  createUserToolExecutor,
  getChat,
  loadMessages,
  updateChat,
} from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import type { Hono } from 'hono'
import { resolveAuth } from './http-routes.js'
import { recordRoomStub } from './record-room.js'
import { deriveChatTitle } from '../ai/chat-title.js'
import type { PreferenceSummary } from '../lib/preferences'
import {
  categoryPreferenceSummary,
  discoveryCategoryIdsFromText,
  normalizeDiscoveryCategoryIds,
  DEFAULT_DISCOVERY_CATEGORY_IDS,
  type DiscoveryCategoryId,
} from '../lib/discovery-categories.js'
import {
  curateGroundedBooks,
  JSON_ONLY_RETRY,
  parseJsonObject,
  reasonsFromObject,
  responseText,
  selectedSourceIds,
  suggestionFromObject,
} from './book-notes.js'
import {
  detectRequestFocus,
  fallbackQueries,
  hasBehavior,
  loadReaderProfile,
  mergeProfile,
  profileContext,
  rankRecommendations,
  recommendationCategoryGate,
  type ReaderProfile,
  type RequestFocus,
} from '../lib/recommendations.js'
import { filterEligibleBooks } from '../lib/book-eligibility.js'
import {
  DEFAULT_RECOMMENDATION_INTENT,
  filterShelfBooks,
  intentForFocus,
  intentFromText,
  isLiteraryStudiesRequest,
} from '../lib/book-relevance.js'

interface GoogleBook {
  id: string
  volumeInfo?: {
    title?: string
    subtitle?: string
    authors?: string[]
    description?: string
    categories?: string[]
    mainCategory?: string
    publishedDate?: string
    publisher?: string
    language?: string
    pageCount?: number
    printType?: string
    industryIdentifiers?: { type?: string; identifier?: string }[]
    averageRating?: number
    ratingsCount?: number
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
  averageRating?: number
  ratingsCount?: number
  publisher?: string
  language?: string
  pageCount?: number
  /** Absolute Google result position, kept through eligibility/relevance filtering. */
  googleResultIndex?: number
  subtitle?: string
  printType?: string
  mainCategory?: string
  industryIdentifiers?: { type: string; identifier: string }[]
}

export interface RecommendedBook extends BookResult {
  reason: string
}

interface StoredRecommendation {
  reply: string
  books: RecommendedBook[]
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toBook(item: GoogleBook, resultIndex?: number): BookResult {
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
    averageRating: finiteNumber(info.averageRating),
    ratingsCount: finiteNumber(info.ratingsCount),
    publisher: typeof info.publisher === 'string' ? info.publisher : undefined,
    language: typeof info.language === 'string' ? info.language : undefined,
    pageCount: finiteNumber(info.pageCount),
    googleResultIndex:
      typeof resultIndex === 'number' && Number.isFinite(resultIndex) ? resultIndex : undefined,
    subtitle: typeof info.subtitle === 'string' ? info.subtitle : undefined,
    printType: typeof info.printType === 'string' ? info.printType : undefined,
    mainCategory: typeof info.mainCategory === 'string' ? info.mainCategory : undefined,
    industryIdentifiers: (info.industryIdentifiers ?? [])
      .filter(
        (entry): entry is { type: string; identifier: string } =>
          typeof entry.type === 'string' && typeof entry.identifier === 'string',
      )
      .map((entry) => ({ type: entry.type, identifier: entry.identifier })),
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
  startIndex = 0,
): Promise<{ books: BookResult[]; totalItems: number }> {
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', query)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('maxResults', String(limit))
  if (startIndex > 0) url.searchParams.set('startIndex', String(startIndex))
  url.searchParams.set('printType', 'books')

  const response = await fetch(url)
  if (!response.ok) {
    const details = await response.text()
    console.error('Google Books API error:', { status: response.status, details })
    throw new GoogleBooksError(response.status, details)
  }

  const data = (await response.json()) as GoogleBooksResponse
  return {
    books: (data.items ?? []).map((item, index) => toBook(item, startIndex + index)),
    totalItems: data.totalItems ?? 0,
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
    categoryIds: normalizeDiscoveryCategoryIds(raw.categoryIds),
  }
}

interface GroundingOptions {
  env: Env
  token: string
  system: string
  prompt: string
  profile: ReaderProfile
  hints: readonly string[]
  focus: RequestFocus
  excludedIds?: readonly string[]
  maxBooks?: number
}

interface GeneratedJson {
  object: Record<string, unknown> | null
  raw: string
  textLength: number
  finishReason?: string
  rawFinishReason?: string
  attempts: number
}

type GeneratedText = {
  content?: unknown
  text?: unknown
  finishReason?: string
  rawFinishReason?: string
}

/** One JSON-only retry for formatting failures; never loop on a broken model. */
async function generateJsonObject(
  generate: (prompt: string) => Promise<GeneratedText>,
  accept: (object: Record<string, unknown>) => boolean = () => true,
): Promise<GeneratedJson> {
  const attempt = async (prompt: string): Promise<GeneratedJson> => {
    const result = await generate(prompt)
    const raw = responseText(result)
    const object = parseJsonObject(raw)
    return {
      object: object && accept(object) ? object : null,
      raw,
      textLength: raw.length,
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
      attempts: 1,
    }
  }

  const first = await attempt('')
  if (first.object) return first

  const second = await attempt(JSON_ONLY_RETRY)
  return { ...second, attempts: 2 }
}

/** Diagnostic only: never log the model text, which can contain reader data. */
function warnUnusableJson(kind: string, fallback: string, result: GeneratedJson): void {
  console.warn(`${kind} response was not usable JSON; using ${fallback}.`, {
    attempts: result.attempts,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    textLength: result.textLength,
  })
}

/**
 * Second pass: choose from the eligible Google Books records we actually found
 * and explain that selection. The first pass only chooses searches before any
 * books are known, so titles written there would be guesses.
 */
async function curateGroundedBooksFromModel(
  env: Env,
  token: string,
  candidates: readonly BookResult[],
  profile: ReaderProfile,
  hints: readonly string[],
  focus: RequestFocus,
  maxBooks: number,
  categoryIds?: readonly DiscoveryCategoryId[] | null,
): Promise<(BookResult & { reason: string })[]> {
  if (candidates.length === 0) return []

  const factory = createDeepSpaceAI(env, 'anthropic', { authToken: token })
  const intent = intentForFocus(focus)
  const policy = intent.statement
  const categoryPolicy = categoryIds?.length
    ? `Hard category gate for this turn: choose only books matching ${categoryPreferenceSummary(categoryIds)}. Other shelves are forbidden even if they look interesting.`
    : 'This turn explicitly asks for literary studies; the reading-shelf gate is lifted, but publication eligibility still applies.'
  const basePrompt = [
    `Relevance policy for this turn: ${policy}`,
    categoryPolicy,
    'Verified standalone Google Books records that already pass DogEar’s relevance gate. These are the ONLY books you may choose:',
    JSON.stringify(
      candidates.map((book) => ({
        sourceId: book.sourceId,
        title: book.title,
        authors: book.authors,
        categories: book.categories,
      })),
    ),
    profileContext(profile, hints, focus),
    `Reply with JSON only: {"selected":["<sourceId>",...],"reasons":{"<sourceId>":"one grounded sentence",...}}.`,
    `Choose at most ${maxBooks} records. Every selected id must appear exactly as written in the list above; unknown ids are ignored and DogEar fills the shelf from another eligible record. Never invent a book, author, category or sourceId.`,
    'Never choose a book about literary criticism, theory, analysis or commentary unless this turn explicitly asks for that subject.',
    'Each reason must name its book and connect it to a real author, category, or the reader request above. No generic praise.',
  ].join('\n')

  try {
    const generated = await generateJsonObject(
      async (suffix) =>
        generateText({
          model: factory('claude-haiku-5-5'),
          maxOutputTokens: 900,
          system:
            `You curate a short shelf for DogEar from a supplied Google Books catalogue list. Relevance policy: ${policy} Use only the record fields you are given. Never describe plot events or invent awards, metadata, or details that are not in the record.`,
          prompt: suffix ? `${basePrompt}\n${suffix}` : basePrompt,
        }),
      (object) =>
        selectedSourceIds(object, candidates, maxBooks, intent).length > 0 ||
        reasonsFromObject(object, candidates).size > 0,
    )
    if (!generated.object) {
      warnUnusableJson('Book selection', 'ranked eligible candidates', generated)
      return curateGroundedBooks(candidates, null, profile, focus, maxBooks, categoryIds)
    }
    return curateGroundedBooks(candidates, generated.object, profile, focus, maxBooks, categoryIds)
  } catch (error) {
    console.warn('Book selection unavailable; using ranked eligible candidates:', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 200) : 'Unknown failure',
    })
    return curateGroundedBooks(candidates, null, profile, focus, maxBooks, categoryIds)
  }
}

/** One grounding pipeline shared by the chat and personalized-shelf endpoints. */
async function recommendGrounded({
  env,
  token,
  system,
  prompt,
  profile,
  hints,
  focus,
  excludedIds,
  maxBooks = 8,
}: GroundingOptions): Promise<StoredRecommendation> {
  const factory = createDeepSpaceAI(env, 'anthropic', { authToken: token })
  const generated = await generateJsonObject(
    async (suffix) =>
      generateText({
        model: factory('claude-haiku-5-5'),
        maxOutputTokens: 1200,
        system,
        prompt: suffix ? `${prompt}\n${suffix}` : prompt,
      }),
    (object) => suggestionFromObject(object) !== null,
  )
  const suggestion = generated.object ? suggestionFromObject(generated.object) : null
  if (!suggestion) warnUnusableJson('Bookseller response', 'catalogue fallbacks', generated)

  const intent = intentForFocus(focus)
  const suggestedQueries = suggestion?.queries ?? []
  // The model only proposes searches. Deterministic relevance decides which of
  // those searches are allowed before any candidate reaches the ranking stage.
  const categoryIds = recommendationCategoryGate(profile, focus)
  const allowedQueries = intent.allowLiteraryStudies
    ? suggestedQueries
    : suggestedQueries.filter((query) => {
        if (isLiteraryStudiesRequest(query)) return false
        if (!categoryIds) return true
        const requested = discoveryCategoryIdsFromText(query)
        return requested.some((id) => categoryIds.includes(id))
      })
  const queries = allowedQueries.length
    ? allowedQueries
    : fallbackQueries(focus, profile.categoryIds ?? [])
  const found = await Promise.all(
    queries.map(async (query) => {
      try {
        return (await googleSearch(query, 8, env.GOOGLE_BOOKS_API_KEY)).books
      } catch {
        return [] as BookResult[]
      }
    }),
  )

  // Hard eligibility/relevance/category gate before ranking and before the
  // model sees its pool. A model cannot widen the pool by naming another book.
  const relevant = filterShelfBooks(found.flat(), categoryIds, intent)
  const ranked = rankRecommendations(relevant, profile, {
    maxBooks,
    focus,
    excludedIds,
  })
  const books = await curateGroundedBooksFromModel(
    env,
    token,
    ranked,
    profile,
    hints,
    focus,
    maxBooks,
    categoryIds,
  )

  return {
    reply: suggestion?.reply || 'Let me see what I can find on the shelves for you.',
    books,
  }
}

const BOOKSELLER_BASE = [
  'You are the bookseller at DogEar, a warm independent bookstore.',
  'For readers without a specific request, favor contemporary novels, literary fiction, historical fiction, fantasy, science fiction, mystery, thriller, romance, horror, short-story collections, poetry collections, biography, memoir, accessible history and popular science.',
  DEFAULT_RECOMMENDATION_INTENT,
  'Historical fiction is fiction. Textbooks, course materials, study aids, serials and reference books are never eligible. A reader who explicitly asks for literary criticism, theory or analysis may receive those standalone books for that turn only.',
  'Never name a specific title or author in your reply — describe moods and themes instead; the app supplies real titles from Google Books.',
  'Reply with JSON only, shaped exactly as:',
  '{"reply":"two or three warm sentences responding to the reader","queries":["google books search query","another query","a third query"]}',
  'Queries must be broad catalogue searches (for example "literary fiction grief friendship"), not title lookups.',
  'When there is no specific request, begin with the reader’s chosen shelves, then their liked and saved books, and avoid books like their passes.',
  'A specific request in the current conversation overrides the chosen shelves for this turn only; it never changes the saved preferences.',
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
    const requestedOffset = Number(c.req.query('startIndex') ?? 0)
    const startIndex = Number.isFinite(requestedOffset)
      ? Math.min(1000, Math.max(0, Math.floor(requestedOffset)))
      : 0

    try {
      const { books, totalItems } = await googleSearch(
        query,
        limit,
        c.env.GOOGLE_BOOKS_API_KEY,
        startIndex,
      )
      // Eligibility is authoritative here: no ineligible record ever crosses
      // the worker boundary. Searches also enforce reading relevance and at
      // least one active shelf; only an explicit literary-studies request lifts
      // the shelf gate, and it still keeps the eligibility gate.
      const eligible = filterEligibleBooks(books)
      const intent = intentFromText(query)
      const requestedCategories = c.req.query('categories')
      const categoryIds = intent.allowLiteraryStudies
        ? null
        : requestedCategories === undefined
          ? DEFAULT_DISCOVERY_CATEGORY_IDS
          : normalizeDiscoveryCategoryIds(requestedCategories.split(','))
      const visible = filterShelfBooks(books, categoryIds, intent)
      return c.json({
        totalItems,
        eligibleCount: eligible.length,
        relevantCount: visible.length,
        books: visible,
      })
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
    const submitted = readPreferences(body?.preferences, auth.userId)
    const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const focus = detectRequestFocus('')

    try {
      // Always read the owned rows at generation time; the client snapshot only
      // supplies chat hints and covers writes that have not synced back yet.
      const execute = createUserToolExecutor(c.env, submitted.userId, c.req.raw.signal)
      const profile = mergeProfile(await loadReaderProfile(execute, submitted.userId), submitted)
      const result = await recommendGrounded({
        env: c.env,
        token,
        system: `${BOOKSELLER_BASE}\n${profileContext(profile, submitted.conversationHints, focus)} Pick three broad catalogue searches that fit this reader.`,
        prompt: 'Choose three real catalogue searches for this reader and write a short reply.',
        profile,
        hints: submitted.conversationHints,
        focus,
        excludedIds: submitted.excludedIds,
      })
      return c.json({ ...result, basis: hasBehavior(profile) ? 'personal' : 'starter' })
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
    const submitted = readPreferences(body?.preferences, auth.userId)
    const focus = detectRequestFocus(message)
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
      const execute = createUserToolExecutor(c.env, submitted.userId, c.req.raw.signal)
      const profile = mergeProfile(await loadReaderProfile(execute, submitted.userId), submitted)
      const result = await recommendGrounded({
        env: c.env,
        token,
        system: `${BOOKSELLER_BASE}\n${profileContext(profile, submitted.conversationHints, focus)}`,
        prompt: `${transcript}\n\nRespond to the reader's latest request. It overrides general taste when specific; use their persisted reading profile otherwise.`,
        profile,
        hints: submitted.conversationHints,
        focus,
        excludedIds: submitted.excludedIds,
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
