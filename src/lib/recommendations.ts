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
import {
  buildCategoryRecommendationQueries,
  categoryPreferenceSummary,
  discoveryCategoryIdsFromText,
  matchesDiscoveryCategory,
  normalizeDiscoveryCategoryIds,
  parseStoredDiscoveryCategoryIds,
  DEFAULT_DISCOVERY_CATEGORY_IDS,
  type DiscoveryCategoryId,
} from './discovery-categories'
import {
  DEFAULT_RECOMMENDATION_INTENT,
  classifyBookRelevance,
  intentForFocus,
  isLiteraryStudiesRequest,
  isShelfEligibleBook,
} from './book-relevance'
import { parseBookSnapshot } from './book-parse'
import { isSameWork } from './swipe-ranking'

export interface SavedSignal extends Book {
  status: string
}

export interface ReaderProfile {
  liked: Book[]
  passed: Book[]
  saved: SavedSignal[]
  /** Explicit shelf choices, loaded from discovery_preferences when available. */
  categoryIds?: readonly DiscoveryCategoryId[]
}

export interface RequestFocus {
  fiction: boolean
  nonfiction: boolean
  history: boolean
  academic: boolean
  /** Only true when the reader explicitly asks to study literature. */
  literaryStudies: boolean
  /** Shelves named in this turn; when present they temporarily override saved ones. */
  categoryIds: readonly DiscoveryCategoryId[]
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
  literaryStudies: false,
  categoryIds: [],
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
  const [interactionResult, savedResult, preferenceResult] = await Promise.all([
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
    execute('records.query', {
      collection: 'discovery_preferences',
      where: { userId },
      limit: 5,
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

  const preferenceRow = queryRows(preferenceResult)[0]
  const categoryIds = parseStoredDiscoveryCategoryIds(preferenceRow?.categoryIds)

  return { liked, passed, saved, categoryIds }
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

  return {
    liked,
    passed,
    saved,
    categoryIds:
      persisted.categoryIds && persisted.categoryIds.length > 0
        ? persisted.categoryIds
        : submitted.categoryIds ?? [],
  }
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
  const literaryStudies = isLiteraryStudiesRequest(text)
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

  return {
    fiction,
    nonfiction,
    history,
    academic,
    literaryStudies,
    categoryIds: discoveryCategoryIdsFromText(text),
    text,
  }
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

function effectiveCategoryIds(profile: ReaderProfile): readonly DiscoveryCategoryId[] {
  const saved = normalizeDiscoveryCategoryIds(profile.categoryIds ?? [])
  return saved.length > 0 ? saved : DEFAULT_DISCOVERY_CATEGORY_IDS
}

/**
 * The active hard category gate. An explicit shelf in this turn replaces the
 * saved shelves without changing them. Literary-studies requests have no
 * reading shelf of their own, so the category gate is lifted while the normal
 * eligibility and relevance gates remain.
 */
export function recommendationCategoryGate(
  profile: ReaderProfile,
  focus: RequestFocus,
): readonly DiscoveryCategoryId[] | null {
  if (focus.literaryStudies) return null
  const requested = normalizeDiscoveryCategoryIds(focus.categoryIds)
  return requested.length > 0 ? requested : effectiveCategoryIds(profile)
}

/**
 * Explicit shelves lead the default recommendation hierarchy. A real choice is
 * a much stronger signal than the balanced fallback set: otherwise a broad
 * default shelf could outrank the narrower shelves a reader actually picked.
 * Matching more than one chosen shelf helps a little, not linearly forever.
 */
function selectedCategoryScore(book: Book, profile: ReaderProfile): number {
  const saved = normalizeDiscoveryCategoryIds(profile.categoryIds ?? [])
  const ids = saved.length > 0 ? saved : DEFAULT_DISCOVERY_CATEGORY_IDS
  let matches = 0
  for (const id of ids) {
    if (matchesDiscoveryCategory(book, id)) matches += 1
  }
  if (matches === 0) return 0
  if (saved.length === 0) return Math.min(8, matches * 4)
  return 12 + Math.min(3, (matches - 1) * 2)
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
  // Eligibility is checked by rankRecommendations(). Relevance is the separate
  // default-shelf gate: a valid book about literary theory is not a novel.
  const relevance = classifyBookRelevance(book, intentForFocus(focus))
  if (!relevance.relevant) return -100

  const academic = isAcademic(book)
  const fiction = isFiction(book)
  const nonfiction = isNonfiction(book)
  const behavior = hasBehavior(profile)
  let score =
    engagementScore(book) +
    relevance.score -
    (academic && !focus.academic && !focus.literaryStudies ? 7 : 0)

  // Chosen shelves are the strongest general signal. A specific chat request
  // temporarily overrides them instead of permanently changing saved choices.
  const explicitFocus =
    focus.fiction || focus.nonfiction || focus.history || focus.academic || focus.literaryStudies
  score += explicitFocus ? selectedCategoryScore(book, profile) * 0.25 : selectedCategoryScore(book, profile)

  if (focus.literaryStudies) {
    // An explicit study request overrides the normal fiction-first bias.
    score += 4
  } else {
    // A reader with no history gets a fiction-first shelf, not a textbook shelf.
    if (!behavior && !focus.nonfiction) score += fiction ? 6 : nonfiction ? -1.5 : 0
    // A specific request overrides general taste: the penalty for the wrong kind
    // of book is larger than any positive score accumulated from past swipes.
    if (focus.fiction) score += fiction ? 5 : nonfiction ? -7 : -4
    if (focus.nonfiction) score += nonfiction ? 6 : fiction ? -7 : -4
    if (focus.history) score += isHistory(book) ? 5 : -4
  }

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
  const intent = intentForFocus(focus)
  const excluded = new Set(options.excludedIds ?? [])
  const interacted = [...profile.liked, ...profile.passed, ...profile.saved]

  const categoryIds = recommendationCategoryGate(profile, focus)
  const ranked = candidates
    .filter((book) => isShelfEligibleBook(book, intent, categoryIds))
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
  const shelfPolicy = focus.literaryStudies
    ? 'This request explicitly asks for literary studies, so valid standalone books about literature are relevant for this turn.'
    : DEFAULT_RECOMMENDATION_INTENT

  const chosen = categoryPreferenceSummary(effectiveCategoryIds(profile))
  const activeGate = recommendationCategoryGate(profile, focus)
  const gateLine = activeGate
    ? `Hard category gate for this turn: only books matching ${categoryPreferenceSummary(activeGate)} may be shown.`
    : 'This turn explicitly requests literary studies, so the reading-shelf gate is lifted; publication eligibility still applies.'
  const priority =
    'General priority: chosen shelves first, then liked and saved books, then passed books as negative signals, then conversation context. A specific request in this turn overrides the chosen shelves for this turn only.'

  if (!hasBehavior(profile) && hints.length === 0 && !focus.text) {
    return [
      `Reader's chosen shelves (highest general priority): ${chosen}.`,
      gateLine,
      'Begin with those shelves. If none were chosen, use a balanced mix of contemporary, literary and genre fiction with a little accessible nonfiction.',
      'Textbooks, course materials, study aids, serials and reference books are never eligible, whatever the request.',
      `Default shelf policy: ${shelfPolicy}`,
      priority,
    ].join('\n')
  }

  return [
    `Default shelf policy: ${shelfPolicy}`,
    priority,
    `Reader's chosen shelves (highest general priority): ${chosen}`,
    gateLine,
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
export function fallbackQueries(
  focus: RequestFocus,
  categoryIds: readonly DiscoveryCategoryId[] = [],
): string[] {
  if (focus.literaryStudies) {
    return ['literary criticism books', 'literary theory books', 'poetry analysis books']
  }
  const requested = normalizeDiscoveryCategoryIds(focus.categoryIds)
  if (requested.length > 0) return buildCategoryRecommendationQueries(requested, 3)
  if (focus.academic) return ['accessible science nonfiction', 'narrative history']
  if (focus.history) return ['narrative history', 'historical nonfiction']
  if (/\bphilosoph(?:y|ical)\b/i.test(focus.text)) return ['philosophy books', 'ethics and philosophy']
  if (/\bscience\b/i.test(focus.text)) return ['accessible science nonfiction', 'science essays']
  if (focus.nonfiction) return ['accessible nonfiction', 'biography memoir']
  if (focus.fiction) return ['contemporary literary fiction', 'fantasy novels']

  // No specific request: the reader's saved shelves decide where we look.
  const selected = buildCategoryRecommendationQueries(
    normalizeDiscoveryCategoryIds(categoryIds),
    3,
  )
  return selected.length > 0
    ? selected
    : ['contemporary literary fiction', 'fantasy novels', 'mystery thriller']
}
