/**
 * Recommendation profile and ranking shared by the For You shelf and the
 * bookseller chat.
 *
 * The worker loads `book_interactions` and `user_books` on every generation and
 * scores real Google Books candidates from those rows. Chat requests are a
 * separate, stronger signal for the current turn; they never stand in for
 * swipe behavior and never fabricate book records.
 */

import type { Book } from './books'
import type { PreferenceSummary } from './preferences'
import { parseBookSnapshot } from './book-parse'
import { isSameWork } from './swipe-ranking'

export interface SavedSignal extends Book {
  status: string
}

export interface ReaderProfile {
  liked: Book[]
  passed: Book[]
  saved: SavedSignal[]
}

export interface RequestFocus {
  fiction: boolean
  nonfiction: boolean
  history: boolean
  academic: boolean
  /** The latest request, kept for prompt context only. */
  text: string
}

export type RecordExecutor = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<unknown>

const EMPTY_FOCUS: RequestFocus = {
  fiction: false,
  nonfiction: false,
  history: false,
  academic: false,
  text: '',
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The SDK tool result is `{ success, data: { records } }`; accept a bare result too. */
function queryRows(value: unknown): Record<string, unknown>[] {
  const payload = isObject(value) && 'data' in value && isObject(value.data) ? value.data : value
  if (!isObject(payload) || !Array.isArray(payload.records)) return []
  return payload.records.filter(isObject).map((row) => (isObject(row.data) ? row.data : {}))
}

function bookFromRow(data: Record<string, unknown>): Book {
  return parseBookSnapshot(
    typeof data.bookData === 'string' ? data.bookData : undefined,
    typeof data.bookId === 'string' ? data.bookId : '',
  )
}

/**
 * Read the two owned collections every time. No cached profile is kept on the
 * worker, so a just-recorded swipe is visible to the next request.
 */
export async function loadReaderProfile(
  execute: RecordExecutor,
  userId: string,
): Promise<ReaderProfile> {
  const [interactionResult, savedResult] = await Promise.all([
    execute('records.query', {
      collection: 'book_interactions',
      where: { userId },
      limit: 200,
    }),
    execute('records.query', {
      collection: 'user_books',
      where: { userId },
      limit: 200,
    }),
  ])

  const liked: Book[] = []
  const passed: Book[] = []
  for (const row of queryRows(interactionResult)) {
    const book = bookFromRow(row)
    if (row.action === 'pass') passed.push(book)
    else liked.push(book)
  }

  const saved: SavedSignal[] = queryRows(savedResult).map((row) => ({
    ...bookFromRow(row),
    status: typeof row.status === 'string' ? row.status : 'want',
  }))

  return { liked, passed, saved }
}

function minimalBook(title: string, index: number): Book {
  return {
    source: 'client-profile',
    sourceId: `client:${index}`,
    title,
    authors: [],
    description: '',
    categories: [],
    publishedDate: '',
    coverUrl: null,
  }
}

/**
 * A client snapshot can be newer than a just-committed record read. Fold its
 * titles in as weak signals without letting them replace the persisted rows.
 */
export function mergeProfile(
  persisted: ReaderProfile,
  submitted: PreferenceSummary,
): ReaderProfile {
  const hasWork = (books: readonly Book[], candidate: Book) =>
    books.some((book) => isSameWork(book, candidate))

  const liked = [...persisted.liked]
  const passed = [...persisted.passed]
  const saved = [...persisted.saved]

  submitted.liked.forEach((title, index) => {
    const book = minimalBook(title, index)
    if (!hasWork(liked, book) && !hasWork(passed, book)) liked.push(book)
  })
  submitted.passed.forEach((title, index) => {
    const book = minimalBook(title, index)
    if (!hasWork(passed, book) && !hasWork(liked, book)) passed.push(book)
  })
  submitted.saved.forEach((entry, index) => {
    const book: SavedSignal = { ...minimalBook(entry.title, index), status: entry.status }
    if (!hasWork(saved, book)) saved.push(book)
  })

  return { liked, passed, saved }
}

/** A specific ask in this conversation takes precedence over the general profile. */
export function detectRequestFocus(message: string): RequestFocus {
  const text = message.trim().slice(0, 4000)
  if (!text) return { ...EMPTY_FOCUS }

  // "Historical fiction" and "science fiction" are fiction, not nonfiction requests.
  const nonfictionText = text
    .replace(/historical\s+fiction/gi, ' ')
    .replace(/science\s+fiction/gi, ' ')
    .replace(/sci[-\s]?fi/gi, ' ')
  const academic = /\b(text\s?books?|workbooks?|coursebooks?|study\s+guides?|exam(?:\s+prep(?:aration)?)?|academic|scholarly|course\s+materials?|reference\s+books?)\b/i.test(
    text,
  )
  const fiction = /\b(fiction|novels?|fantasy|sci[-\s]?fi|science\s+fiction|mystery|thrillers?|suspense|romance|short\s+stories|literary|historical\s+fiction|graphic\s+novels?)\b/i.test(
    text,
  )
  const history = /\b(history|historical|historian|world\s+war|ancient|medieval|dynasty|biography|memoir)\b/i.test(
    nonfictionText,
  )
  const nonfiction =
    academic ||
    history ||
    /\b(non[-\s]?fiction|science|philosophy|psychology|economics|politics|nature|essays?|true\s+crime|religion|travel|memoir|biography)\b/i.test(
      nonfictionText,
    )

  return { fiction, nonfiction, history, academic, text }
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function categorySegments(book: Book): string[] {
  return book.categories
    .flatMap((category) => category.split(/[,&/]/))
    .map((category) => normalize(category))
    .filter(Boolean)
}

function normalizedAuthors(book: Book): string[] {
  return book.authors.map(normalize).filter(Boolean)
}

const FICTION_CATEGORIES = /\b(fiction|novels?|fantasy|science fiction|mystery|thriller|suspense|romance|short stories|comics|graphic novels)\b/i
const HISTORY_CATEGORIES = /\b(history|historical|biography|autobiography|memoir)\b/i
const NONFICTION_CATEGORIES = /\b(history|science|philosophy|psychology|economics|politics|nature|essays|biography|autobiography|memoir|religion|travel|art|music|true crime)\b/i
const ACADEMIC_CATEGORIES = /\b(education|study aids?|test preparation|examination|reference|language arts|literary criticism|library science|academic|scholarly)\b/i
const TEXTBOOK_TITLES = /\b(text\s?books?|workbooks?|coursebooks?|study\s+guides?|exam(?:\s+prep(?:aration)?)?|practice\s+(?:tests?|questions?|problems?)|answer\s+keys?|(?:solutions?|instructor'?s?)\s+manual|for\s+dummies|teaching\s+guide|schaum'?s\s+outline)\b/i

function categoriesMatch(book: Book, pattern: RegExp): boolean {
  return categorySegments(book).some((category) => pattern.test(category))
}

export function isTextbook(book: Book): boolean {
  return TEXTBOOK_TITLES.test(book.title)
}

export function isAcademic(book: Book): boolean {
  return isTextbook(book) || categoriesMatch(book, ACADEMIC_CATEGORIES)
}

export function isFiction(book: Book): boolean {
  return FICTION_CATEGORIES.test(book.title) || categoriesMatch(book, FICTION_CATEGORIES)
}

export function isNonfiction(book: Book): boolean {
  return categoriesMatch(book, NONFICTION_CATEGORIES)
}

export function isHistory(book: Book): boolean {
  return categoriesMatch(book, HISTORY_CATEGORIES)
}

export function hasBehavior(profile: ReaderProfile): boolean {
  return profile.liked.length > 0 || profile.passed.length > 0 || profile.saved.length > 0
}

interface Signals {
  positiveAuthors: Map<string, number>
  positiveCategories: Map<string, number>
  negativeAuthors: Map<string, number>
  negativeCategories: Map<string, number>
}

function bump(map: Map<string, number>, keys: string[], weight: number) {
  for (const key of new Set(keys)) {
    if (!key) continue
    map.set(key, Math.min(4, (map.get(key) ?? 0) + weight))
  }
}

/**
 * Repetition matters: ten likes in one genre outweigh one passing like, while
 * one shy swipe cannot define the whole shelf.
 */
function signalsFrom(profile: ReaderProfile): Signals {
  const positiveAuthors = new Map<string, number>()
  const positiveCategories = new Map<string, number>()
  const negativeAuthors = new Map<string, number>()
  const negativeCategories = new Map<string, number>()

  for (const book of profile.liked) {
    bump(positiveAuthors, normalizedAuthors(book), 1)
    bump(positiveCategories, categorySegments(book), 1)
  }
  for (const book of profile.saved) {
    const weight = book.status === 'read' ? 1.5 : book.status === 'reading' ? 1 : 0.5
    bump(positiveAuthors, normalizedAuthors(book), weight)
    bump(positiveCategories, categorySegments(book), weight)
  }
  for (const book of profile.passed) {
    bump(negativeAuthors, normalizedAuthors(book), 1)
    bump(negativeCategories, categorySegments(book), 1)
  }

  return { positiveAuthors, positiveCategories, negativeAuthors, negativeCategories }
}

function engagementScore(book: Book): number {
  const count =
    typeof book.ratingsCount === 'number' && Number.isFinite(book.ratingsCount)
      ? book.ratingsCount
      : 0
  const rating =
    typeof book.averageRating === 'number' && Number.isFinite(book.averageRating)
      ? book.averageRating
      : undefined
  const popularity = Math.min(4, Math.log10(count + 1) * 1.2)
  const quality = rating === undefined ? 0 : Math.max(-1, Math.min(2, (rating - 3) * 0.7))
  return popularity + quality + (book.coverUrl ? 0.5 : 0) + (book.description.length > 120 ? 0.5 : 0)
}

export function scoreCandidate(book: Book, profile: ReaderProfile, focus: RequestFocus): number {
  // Course materials never surface by default; scholarly nonfiction is only
  // demoted, because an explicit science or history request may still want it.
  if (isTextbook(book) && !focus.academic) return -100

  const academic = isAcademic(book)
  const fiction = isFiction(book)
  const nonfiction = isNonfiction(book)
  const behavior = hasBehavior(profile)
  let score = engagementScore(book) - (academic && !focus.academic ? 7 : 0)

  // A reader with no history gets a fiction-first shelf, not a textbook shelf.
  if (!behavior && !focus.nonfiction) score += fiction ? 6 : nonfiction ? -1.5 : 0
  // A specific request overrides general taste: the penalty for the wrong kind
  // of book is larger than any positive score accumulated from past swipes.
  if (focus.fiction) score += fiction ? 5 : nonfiction ? -7 : -4
  if (focus.nonfiction) score += nonfiction ? 6 : fiction ? -7 : -4
  if (focus.history) score += isHistory(book) ? 5 : -4
  if (focus.academic) score += academic ? 6 : -5

  if (behavior) {
    const signals = signalsFrom(profile)
    const author = normalizedAuthors(book)
    const categories = categorySegments(book)
    const positiveAuthor = Math.max(0, ...author.map((key) => signals.positiveAuthors.get(key) ?? 0))
    const positiveCategory = Math.max(
      0,
      ...categories.map((key) => signals.positiveCategories.get(key) ?? 0),
    )
    const negativeAuthor = Math.max(0, ...author.map((key) => signals.negativeAuthors.get(key) ?? 0))
    const negativeCategory = Math.max(
      0,
      ...categories.map((key) => signals.negativeCategories.get(key) ?? 0),
    )
    score += positiveAuthor * 2.5 + positiveCategory * 1.5
    score -= negativeAuthor * 4 + negativeCategory * 2.5

    // Keep nonfiction in the mix once the reader has shown a taste for it.
    if (nonfiction && positiveCategory > 0) score += 1
  }

  return score
}

export interface RankOptions {
  maxBooks?: number
  focus?: RequestFocus
  excludedIds?: readonly string[]
}

/** Score, filter and dedupe real candidates without changing their records. */
export function rankRecommendations(
  candidates: readonly Book[],
  profile: ReaderProfile,
  options: RankOptions = {},
): Book[] {
  const focus = options.focus ?? EMPTY_FOCUS
  const excluded = new Set(options.excludedIds ?? [])
  const interacted = [...profile.liked, ...profile.passed, ...profile.saved]

  const ranked = candidates
    .filter((book) => !excluded.has(book.sourceId))
    .filter((book) => !interacted.some((past) => isSameWork(past, book)))
    .map((book) => ({ book, score: scoreCandidate(book, profile, focus) }))
    .filter((entry) => entry.score > -7)
    .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title))

  const selected: Book[] = []
  for (const entry of ranked) {
    if (selected.some((book) => isSameWork(book, entry.book))) continue
    selected.push(entry.book)
    if (selected.length >= (options.maxBooks ?? 8)) break
  }
  return selected
}

function categoryLabel(book: Book): string {
  const category = book.categories.find((value) => value.trim())?.trim() ?? ''
  if (!category) return 'a title from the catalogue'
  return category.charAt(0).toLowerCase() + category.slice(1)
}

/** A model note is only usable when it points at real metadata. */
export function groundedReason(reason: string | undefined, book: Book): string | null {
  if (!reason) return null
  const text = reason.trim().replace(/\s+/g, ' ')
  if (text.length < 20 || text.length > 260 || /https?:\/\//i.test(text)) return null

  const haystack = normalize(text)
  const mentionsRecord = [book.title, ...book.authors, ...book.categories].some((value) => {
    const needle = normalize(value)
    return needle.length > 2 && haystack.includes(needle)
  })
  return mentionsRecord ? text : null
}

/** Grounded fallback when the model omits a usable note. Never invents facts. */
export function fallbackReason(book: Book, profile: ReaderProfile, focus: RequestFocus): string {
  const title = `“${book.title}”`
  const category = categoryLabel(book)
  const signals = signalsFrom(profile)
  const authorHit = book.authors.find((author) => signals.positiveAuthors.has(normalize(author)))
  const categoryHit = book.categories.find((item) =>
    signals.positiveCategories.has(normalize(item.split(/[,&/]/)[0])),
  )

  if (focus.academic && isAcademic(book)) return `${title} is ${category}, matching your course request.`
  if (focus.history && isHistory(book)) return `${title} is ${category}, which fits your request for history.`
  if (focus.fiction && isFiction(book)) return `${title} is ${category}, matching the fiction you asked for.`
  if (focus.nonfiction && /\bphilosoph(?:y|ical)\b/i.test(focus.text) && isNonfiction(book)) {
    return `${title} is ${category}, which fits your philosophy request.`
  }
  if (focus.nonfiction && /\bscience\b/i.test(focus.text) && isNonfiction(book)) {
    return `${title} is ${category}, which fits your science request.`
  }
  if (focus.nonfiction && isNonfiction(book)) return `${title} is ${category}, a nonfiction pick for your request.`
  if (authorHit) return `${title} is by ${authorHit}, an author you have enjoyed.`
  if (categoryHit) return `${title} is filed under ${categoryHit}, a category you have enjoyed.`
  if (isFiction(book)) return `${title} is ${category} from the fiction shelves.`
  if (isNonfiction(book)) return `${title} is ${category}, a nonfiction pick alongside the fiction.`
  return `${title} is a real Google Books catalogue record with no category listed.`
}

export function profileContext(
  profile: ReaderProfile,
  hints: readonly string[] = [],
  focus: RequestFocus = EMPTY_FOCUS,
): string {
  if (!hasBehavior(profile) && hints.length === 0 && !focus.text) {
    return [
      'Reader profile: new here. Start with contemporary fiction, literary fiction, fantasy,',
      'science fiction, mystery, thrillers, romance, historical fiction, and acclaimed novels.',
      'Accessible nonfiction may appear occasionally. Do not choose textbooks, course materials,',
      'study aids, or reference books unless the reader asks for them.',
    ].join('\n')
  }

  return [
    'Reader profile from persisted records (strongest signal):',
    `Liked: ${profile.liked.map((book) => book.title).join('; ') || 'none'}`,
    `Passed — avoid similar authors and categories: ${profile.passed.map((book) => book.title).join('; ') || 'none'}`,
    `Library: ${profile.saved.map((book) => `${book.title} (${book.status})`).join('; ') || 'none'}`,
    `Liked authors: ${profile.liked.flatMap((book) => book.authors).join('; ') || 'none'}`,
    `Liked categories: ${profile.liked.flatMap((book) => book.categories).join('; ') || 'none'}`,
    `Current request (overrides general taste when specific): ${focus.text || 'none'}`,
    `Earlier chat topics (context only, not swipe signals): ${hints.join(' | ') || 'none'}`,
  ].join('\n')
}

/** Model-chosen fallback searches, still real catalogue queries. */
export function fallbackQueries(focus: RequestFocus): string[] {
  if (focus.academic) return ['academic textbook', 'scholarly course book']
  if (focus.history) return ['narrative history', 'historical nonfiction']
  if (/\bphilosoph(?:y|ical)\b/i.test(focus.text)) return ['philosophy books', 'ethics and philosophy']
  if (/\bscience\b/i.test(focus.text)) return ['accessible science nonfiction', 'science essays']
  if (focus.nonfiction) return ['accessible nonfiction', 'biography memoir']
  if (focus.fiction) return ['contemporary literary fiction', 'fantasy novels']
  return ['contemporary literary fiction', 'fantasy novels', 'mystery thriller']
}
