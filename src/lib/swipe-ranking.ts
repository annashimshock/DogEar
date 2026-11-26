/**
 * Ranking for the swipe table.
 *
 * Google Books returns relevance-ordered results, not a bestseller list. This
 * module keeps every real record and orders it by four signals: the intent of
 * the query that found it, its position in those results, Google reader
 * engagement when it exists, and the reader's own likes/passes once known.
 * Eligibility is centralized in book-eligibility.ts and the selected-category
 * gate in discovery-categories.ts: a record must positively qualify as a
 * standalone book and match a chosen shelf before it is considered here.
 * Ranking never overrides either gate.
 */

import type { Book, SwipeQuery, SwipeShelf } from './books'
import { classifyBookEligibility, isEligibleBook } from './book-eligibility'
import {
  filterShelfBooks,
  intentFromText,
  isShelfEligibleBook,
} from './book-relevance'
import {
  matchesDiscoveryCategory,
  type DiscoveryCategoryId,
} from './discovery-categories'

export interface SwipeRankingContext {
  excludedIds?: ReadonlySet<string>
  /** Works already put on a swipe stack in an earlier query batch. */
  seenWorks?: readonly Book[]
  liked?: readonly Book[]
  passed?: readonly Book[]
  saved?: readonly Book[]
  /** Reader-selected shelves; a positive match is mandatory when present. */
  categoryIds?: readonly DiscoveryCategoryId[]
}

export interface SwipeQueryResults {
  query: SwipeQuery
  books: readonly Book[]
}

const SHELF_BONUS: Record<SwipeShelf, number> = {
  'front-table': 4,
  popular: 2,
  genre: 1,
  discovery: 0.25,
}

const MAX_PER_QUERY = 8
const POSITION_WINDOW = 14
/** A fuzzy nonfiction hit must not crowd out a reader's chosen fiction shelves. */
const OFF_CATEGORY_PENALTY = 12

/**
 * Google returns a relevance ordering, not a popularity chart. Normalize the
 * raw result index into 0..1 so every shelf is comparable even when one search
 * returns many more books than another.
 */
export function normalizedSearchPosition(resultIndex: number): number {
  if (!Number.isFinite(resultIndex) || resultIndex < 0) return 0
  return Math.max(0, 1 - Math.floor(resultIndex) / POSITION_WINDOW)
}

/** Books about the market for books are not the books themselves. */
const META_TITLE_PATTERNS = [/\bbest\s?sellers?\b/i, /\bpopular fiction since\b/i, /\bbookclub\b/i]

const READER_CATEGORIES = /fiction|novels?|memoirs?|biograph|autobiograph|history|nature|science|social science|psychology|travel|cooking|art|music|mythology|comics|graphic novels/i
const LOW_SIGNAL_CATEGORIES = /juvenile|children|antiques|collectibles|games|activities/i

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function categorySegments(book: Book): string[] {
  return book.categories
    .flatMap((category) => category.split(/[,&/]/))
    .map((category) => normalize(category))
    .filter(Boolean)
}

/** Kept as small compatibility helpers for callers that still ask about a record. */
export function isSerialPublication(book: Book): boolean {
  return classifyBookEligibility(book).reasons.some((reason) =>
    reason.startsWith('serial') || reason === 'catalog-record',
  )
}

export function isAcademicPublication(book: Book): boolean {
  return !isEligibleBook(book)
}

/** Formatting that describes an edition, not a different work. */
const EDITION_NOISE = [
  /\([^)]*\)/g,
  /\[[^\]]*\]/g,
  /#\s*\d+\b/g,
  /\b(?:book|vol(?:ume)?|part|no\.?)\s*#?\d+(?:\s*of\s*\d+)?\b/gi,
  /\bhard\s?cover\b/gi,
  /\bpaper\s?back\b/gi,
  /\be\s?books?\b/gi,
  /\bkindle\b/gi,
  /\baudio\s?books?\b/gi,
  /\billustrated\b/gi,
  /\bdeluxe\b/gi,
  /\beditions?\b/gi,
  /\bspecial\b/gi,
  /\blimited\b/gi,
  /\bcollector'?s?\b/gi,
  /\bannotated\b/gi,
  /\brevised\b/gi,
  /\bupdated\b/gi,
  /\breprints?\b/gi,
  /\bmovie tie in\b/gi,
  /\bbook club picks?\b/gi,
  /\breese s book club\b/gi,
  /\banniversary\b/gi,
  /\bmass market\b/gi,
  /\blarge print\b/gi,
  /\blibrary binding\b/gi,
  /\bfor young adults?\b/gi,
  /\byoung readers?\b/gi,
  /\b(?:19|20)\d{2}\b/g,
]

function stripEditionNoise(value: string): string {
  return EDITION_NOISE.reduce((text, pattern) => text.replace(pattern, ' '), value)
}

/** The readable title of a record, before subtitle and edition formatting. */
function primaryTitle(value: string): string {
  return normalize(stripEditionNoise(value.split(/[:–—]/)[0]))
}

/**
 * A Google record can carry an translated title plus the familiar one, e.g.
 * "Proyek Hail Mary (Project Hail Mary)". Each usable segment is a candidate;
 * multi-title collections are deliberately not split into their contents.
 */
function titleCandidates(book: Book): string[] {
  const candidates = new Set<string>()
  const add = (value: string) => {
    const title = primaryTitle(value)
    if (title) candidates.add(title)
  }

  add(book.title)
  for (const segment of book.title.split(/[/;]/).slice(1)) add(segment)
  for (const match of book.title.matchAll(/\(([^)]*)\)/g)) {
    const inner = match[1]
    // A parenthetical list of several books is a collection, not an alias for
    // one of its titles. A single translated/alternate title (possibly followed
    // by a series number) is.
    if (/\b(?:collection|boxed|box|set|series|omnibus)\b/i.test(inner)) continue
    const segments = inner.split(/[,/]/).map((segment) => primaryTitle(segment))
    const meaningful = segments.filter((segment) => segment.length > 1)
    if (meaningful.length > 1) continue
    for (const segment of segments) add(segment)
  }
  return [...candidates]
}

/**
 * Canonical author identity. Sorting tokens handles "Andy Weir" vs "Weir Andy",
 * while the compatibility check below accepts abbreviated middle/second names
 * without treating genuinely different authors as the same person.
 */
function authorIdentities(book: Book): string[] {
  return book.authors
    .map((author) =>
      normalize(author)
        .replace(/\b(?:author|editor|illustrator|translator)\b/g, ' ')
        .split(' ')
        .filter(Boolean)
        .sort()
        .join(' '),
    )
    .filter(Boolean)
}

function namesCompatible(left: string, right: string): boolean {
  if (left === right) return true

  const leftTokens = left.split(' ')
  const rightTokens = right.split(' ')
  if (leftTokens.length === rightTokens.length) {
    return leftTokens.every((token, index) => {
      const other = rightTokens[index]
      if (token === other) return true
      if (token.length === 1) return token === other[0]
      if (other.length === 1) return other === token[0]
      return false
    })
  }

  // A record can add or drop a middle initial. Do not ignore a whole extra name,
  // because that could collapse two genuinely different contributors.
  const [longer, shorter] =
    leftTokens.length > rightTokens.length ? [leftTokens, rightTokens] : [rightTokens, leftTokens]
  if (longer.length - shorter.length !== 1) return false
  const extraIndex = longer.findIndex((token, index) => {
    if (token.length !== 1) return false
    return [...longer.slice(0, index), ...longer.slice(index + 1)].join(' ') === shorter.join(' ')
  })
  return extraIndex >= 0
}

function authorsCompatible(a: Book, b: Book): boolean {
  const left = authorIdentities(a)
  const right = authorIdentities(b)
  if (left.length === 0 || right.length === 0) return true
  return left.some((author) => right.some((other) => namesCompatible(author, other)))
}

/** Two Google IDs are one work when their usable titles and authors agree. */
export function isSameWork(a: Book, b: Book): boolean {
  if (a.sourceId === b.sourceId) return true
  const aTitles = titleCandidates(a)
  const bTitles = titleCandidates(b)
  if (!aTitles.some((title) => bTitles.includes(title))) return false
  return authorsCompatible(a, b)
}

function matchesQueryTargets(query: SwipeQuery, book: Book): boolean {
  if (!query.targets?.length) return true
  const titles = titleCandidates(book)
  return query.targets.some((target) => {
    const normalizedTarget = primaryTitle(target)
    return titles.includes(normalizedTarget)
  })
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

  if (count <= 0 && rating === undefined) return 0

  // ratingsCount is the medium-strength signal; a logarithmic curve rewards
  // genuine reader engagement without letting one runaway title swamp a shelf.
  // averageRating is deliberately low signal: a 5.0 from six readers must not
  // beat a 4.3 with thousands of ratings.
  const popularity = Math.min(8, Math.log10(count + 1) * 1.6)
  const quality = rating === undefined ? 0 : Math.max(-1, Math.min(1.6, (rating - 3) * 0.8))
  const trustworthy = count >= 10 && rating !== undefined && rating >= 4 ? 1.5 : 0
  return Math.min(10, popularity + quality + trustworthy)
}

function readerFitScore(book: Book): number {
  const categories = categorySegments(book)
  let score = categories.some((category) => READER_CATEGORIES.test(category)) ? 2 : 0
  if (categories.some((category) => LOW_SIGNAL_CATEGORIES.test(category))) score -= 0.75
  if (book.coverUrl) score += 0.75
  if (book.description.trim().length > 120) score += 0.5

  const year = Number.parseInt(book.publishedDate.slice(0, 4), 10)
  if (Number.isFinite(year)) {
    // Recency is only a small optional nudge; a great older book still wins.
    if (year >= 2020) score += 0.5
    else if (year >= 2010) score += 0.25
  }
  return score
}

/**
 * Which Google record should represent a work. Ranking position decides where
 * the work appears; this decides which edition the reader actually sees.
 */
function recordQuality(book: Book): number {
  const count =
    typeof book.ratingsCount === 'number' && Number.isFinite(book.ratingsCount)
      ? book.ratingsCount
      : 0
  const rating =
    typeof book.averageRating === 'number' && Number.isFinite(book.averageRating)
      ? book.averageRating
      : undefined

  const engagement = Math.min(10, Math.log10(count + 1) * 2.5)
  const quality = rating === undefined ? 0 : Math.max(0, rating - 3) * 1.5
  const description = Math.min(4, book.description.trim().length / 100)
  const cover = book.coverUrl ? 3 : 0
  return engagement + quality + description + cover
}

function isStrongerRecord(candidate: Book, current: Book): boolean {
  const quality = recordQuality(candidate) - recordQuality(current)
  if (Math.abs(quality) > 0.001) return quality > 0
  const authorCount = candidate.authors.length - current.authors.length
  if (authorCount !== 0) return authorCount > 0
  if (candidate.description.length !== current.description.length) {
    return candidate.description.length > current.description.length
  }
  return candidate.publishedDate.localeCompare(current.publishedDate) > 0
}

interface ProfileSets {
  authors: Set<string>
  categories: Set<string>
}

function profileSets(books: readonly Book[]): ProfileSets {
  const authors = new Set<string>()
  const categories = new Set<string>()
  for (const book of books) {
    for (const author of book.authors) {
      const normalized = normalize(author)
      if (normalized) authors.add(normalized)
    }
    for (const category of categorySegments(book)) categories.add(category)
  }
  return { authors, categories }
}

function preferenceScore(book: Book, context: SwipeRankingContext): number {
  const liked = context.liked ?? []
  const saved = context.saved ?? []
  const passed = context.passed ?? []
  if (liked.length === 0 && saved.length === 0 && passed.length === 0) return 0

  const enjoyed = profileSets([...liked, ...saved])
  const avoided = profileSets(passed)
  const categories = categorySegments(book)
  const authorHit = book.authors.some((author) => enjoyed.authors.has(normalize(author)))
  const categoryHit = categories.some((category) => enjoyed.categories.has(category))
  const passedAuthor = book.authors.some((author) => avoided.authors.has(normalize(author)))
  const passedCategory = categories.some((category) => avoided.categories.has(category))

  return (
    (authorHit ? 3.5 : 0) +
    (categoryHit ? 2.25 : 0) -
    (passedAuthor ? 5 : 0) -
    (passedCategory ? 3 : 0)
  )
}

/** Explicit shelves lead the deck; behavior still refines the order. */
function categoryFitScore(book: Book, query: SwipeQuery, context: SwipeRankingContext): number {
  const ids = new Set<DiscoveryCategoryId>([
    ...(context.categoryIds ?? []),
    ...(query.categoryId ? [query.categoryId] : []),
  ])
  let score = 0
  for (const id of ids) {
    if (matchesDiscoveryCategory(book, id)) score += 1.8
  }
  return Math.min(5.5, score)
}

/** Final ranking score: search evidence plus record quality and reader taste. */
function baseScore(
  book: Book,
  query: SwipeQuery,
  context: SwipeRankingContext,
): number {
  const onTarget = matchesQueryTargets(query, book)
  const shelfBonus = onTarget ? SHELF_BONUS[query.shelf] : 0
  const offTargetPenalty = onTarget ? 0 : 8
  const metaPenalty = META_TITLE_PATTERNS.some((pattern) => pattern.test(book.title)) ? 6 : 0
  const selectedIds = new Set<DiscoveryCategoryId>([
    ...(context.categoryIds ?? []),
    ...(query.categoryId ? [query.categoryId] : []),
  ])
  const offCategoryPenalty =
    selectedIds.size > 0 &&
    ![...selectedIds].some((id) => matchesDiscoveryCategory(book, id))
      ? OFF_CATEGORY_PENALTY
      : 0

  return (
    2 * query.weight +
    shelfBonus +
    engagementScore(book) +
    readerFitScore(book) +
    preferenceScore(book, context) +
    categoryFitScore(book, query, context) -
    offTargetPenalty -
    offCategoryPenalty -
    metaPenalty
  )
}

/** A work's place in several relevant searches is evidence, not a volume count. */
function positionBonus(positionScores: readonly number[]): number {
  if (positionScores.length === 0) return 0
  const sorted = [...positionScores].sort((a, b) => b - a)
  const primary = sorted[0] * 6
  const supporting = Math.min(3, sorted.slice(1, 3).reduce((sum, value) => sum + value, 0) * 1.5)
  const repetition = Math.min(2.4, Math.max(0, sorted.length - 1) * 0.8)
  return primary + supporting + repetition
}

/**
 * Score, deduplicate and order the books fetched for the swipe stack. Exact
 * library/like/pass ids are excluded before scoring; author and category
 * preferences only affect order so a reader can still discover something new.
 */
export function rankSwipeBooks(
  inputs: readonly SwipeQueryResults[],
  context: SwipeRankingContext = {},
): Book[] {
  const excluded = context.excludedIds
  const seenWorks = context.seenWorks ?? []
  const interactedWorks = [
    ...(context.liked ?? []),
    ...(context.passed ?? []),
    ...(context.saved ?? []),
  ]
  interface Candidate {
    book: Book
    baseScore: number
    queryKey: string
    /** One entry per distinct query, never per duplicate edition. */
    positionScores: number[]
  }
  const candidates: Candidate[] = []
  const queryCategoryIds = [
    ...new Set(inputs.flatMap(({ query }) => (query.categoryId ? [query.categoryId] : []))),
  ]
  const hardCategoryIds =
    context.categoryIds && context.categoryIds.length > 0
      ? context.categoryIds
      : queryCategoryIds.length > 0
        ? queryCategoryIds
        : undefined

  inputs.forEach(({ query, books }, groupIndex) => {
    const queryKey = `${groupIndex}:${query.query}`
    const intent = intentFromText(query.query)
    // Multiple editions of one work inside a single search are one placement.
    const countedInQuery = new Set<number>()

    books.forEach((book, resultIndex) => {
      if (!book.sourceId || excluded?.has(book.sourceId)) return
      if (!isShelfEligibleBook(book, intent, hardCategoryIds)) return
      if (interactedWorks.some((interacted) => isSameWork(interacted, book))) return
      if (seenWorks.some((seen) => isSameWork(seen, book))) return
      // Front-table searches are exact curation; fuzzy neighbours belong in
      // the later genre/discovery batches, not at the top of a new stack.
      if (query.targets?.length && !matchesQueryTargets(query, book)) return

      const score = baseScore(book, query, context)
      let candidateIndex = candidates.findIndex((candidate) => isSameWork(candidate.book, book))
      if (candidateIndex < 0) {
        candidates.push({ book, baseScore: score, queryKey, positionScores: [] })
        candidateIndex = candidates.length - 1
      }
      const candidate = candidates[candidateIndex]

      // Keep the strongest placement and the strongest record independently so
      // a weaker edition cannot demote a work found near the top of a shelf.
      if (score > candidate.baseScore) {
        candidate.baseScore = score
        candidate.queryKey = queryKey
      }
      if (isStrongerRecord(book, candidate.book)) candidate.book = book
      if (!countedInQuery.has(candidateIndex)) {
        countedInQuery.add(candidateIndex)
        // The worker may have removed ineligible records before this point, so
        // prefer the absolute Google position carried on the record over the
        // compacted array index. Hand-built test records still use their index.
        const originalPosition = book.googleResultIndex ?? resultIndex
        candidate.positionScores.push(
          normalizedSearchPosition(originalPosition) * query.weight,
        )
      }
    })
  })

  const sorted = candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.baseScore + positionBonus(candidate.positionScores),
    }))
    .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title))

  // Keep several shelves in play: no single query can fill the whole stack.
  const perQuery = new Map<string, number>()
  const selected: typeof sorted = []
  for (const candidate of sorted) {
    const used = perQuery.get(candidate.queryKey) ?? 0
    if (used >= MAX_PER_QUERY) continue
    perQuery.set(candidate.queryKey, used + 1)
    selected.push(candidate)
  }

  return selected.map((candidate) => candidate.book)
}

/**
 * Remember every edition fetched for a batch, not just the one shown. Later
 * batches then cannot reintroduce a work from an earlier search.
 */
export function registerSwipeWorks(
  seen: readonly Book[],
  fetched: readonly Book[],
  categoryIds?: readonly DiscoveryCategoryId[],
): Book[] {
  const registered = filterShelfBooks(seen, categoryIds)
  for (const book of filterShelfBooks(fetched, categoryIds)) {
    if (!book.sourceId) continue
    const index = registered.findIndex((existing) => isSameWork(existing, book))
    if (index < 0) registered.push(book)
    else if (isStrongerRecord(book, registered[index])) registered[index] = book
  }
  return registered
}

/**
 * Insert books into the active queue in one pass over the complete combined
 * pool. Replacing a duplicate in place keeps the existing rank order while
 * still showing the strongest record for that work.
 */
export function mergeSwipeBooks(
  current: readonly Book[],
  incoming: readonly Book[],
  categoryIds?: readonly DiscoveryCategoryId[],
): Book[] {
  const merged = filterShelfBooks(current, categoryIds)
  for (const book of filterShelfBooks(incoming, categoryIds)) {
    const index = merged.findIndex((existing) => isSameWork(existing, book))
    if (index < 0) merged.push(book)
    else if (isStrongerRecord(book, merged[index])) merged[index] = book
  }
  return merged
}

export interface SwipeQueueState {
  queue: Book[]
  seenWorks: Book[]
}

/**
 * Atomic batch commit used by the component. Registering fetched works before
 * ranking and merging through a single state object makes repeated or out-of-
 * order batch completions safe.
 */
export function applySwipeBatch(
  state: SwipeQueueState,
  results: readonly SwipeQueryResults[],
  context: Omit<SwipeRankingContext, 'seenWorks'> = {},
): SwipeQueueState {
  // Eligibility and relevance are both checked again here, not only by the
  // worker, so a stronger edition of a rejected record can never replace a
  // queued book later.
  const eligibleResults = results.map(({ query, books }) => ({
    query,
    books: filterShelfBooks(books, context.categoryIds, intentFromText(query.query)),
  }))
  const fetched = eligibleResults.flatMap(({ books }) => books)
  // Rank against earlier batches only; registering this batch first would hide
  // the very books it just fetched.
  const fresh = rankSwipeBooks(eligibleResults, { ...context, seenWorks: state.seenWorks })
  const seenWorks = registerSwipeWorks(state.seenWorks, fetched, context.categoryIds)
  const queue = mergeSwipeBooks(state.queue, fresh, context.categoryIds)

  // A later batch can carry a stronger edition of a work already queued. The
  // rank still excludes it as a duplicate, but the reader sees the best record.
  for (const book of fetched) {
    const index = queue.findIndex((existing) => isSameWork(existing, book))
    if (index >= 0 && isStrongerRecord(book, queue[index])) queue[index] = book
  }

  return { queue, seenWorks }
}
