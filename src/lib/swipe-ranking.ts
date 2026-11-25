/**
 * Ranking for the swipe table.
 *
 * Google Books returns relevance-ordered results, not a bestseller list. This
 * module keeps every real record and orders it by four signals: the intent of
 * the query that found it, its position in those results, Google reader
 * engagement when it exists, and the reader's own likes/passes once known.
 * High-confidence course/reference material is removed; borderline educational
 * nonfiction is merely deprioritized so it can still surface as a discovery.
 */

import type { Book, SwipeQuery, SwipeShelf } from './books'

export interface SwipeRankingContext {
  excludedIds?: ReadonlySet<string>
  /** Works already put on a swipe stack in an earlier query batch. */
  seenWorks?: readonly Book[]
  liked?: readonly Book[]
  passed?: readonly Book[]
  saved?: readonly Book[]
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

const HARD_CATEGORIES = [
  /^education$/i,
  /study aids?/i,
  /test preparation/i,
  /examination/i,
  /^reference$/i,
  /language arts/i,
  /literary criticism/i,
  /library science/i,
  /^computers$/i,
  /software/i,
  /technology & engineering/i,
]

const HARD_TITLE_PATTERNS = [
  /\btext\s?books?\b/i,
  /\bworkbooks?\b/i,
  /\bcoursebooks?\b/i,
  /\bstudy guides?\b/i,
  /\bexam(?:ination)?s?\b.*\bprep(?:aration)?\b/i,
  /\btest prep\b/i,
  /\bpractice (?:tests?|questions?|problems?)\b/i,
  /\banswer keys?\b/i,
  /\b(?:solutions?|instructor'?s?) manual\b/i,
  /\b(?:technical|user|owner'?s?) manual\b/i,
  /\bfor dummies\b/i,
  /\bteaching guide\b/i,
  /\bschaum'?s outline\b/i,
]

const SOFT_TITLE_PATTERNS = [
  /\b(?:edition|volume|manual|handbook|companion|guide|primer|reader)\b/i,
  /\bintroduction to\b/i,
  /\bprinciples? of\b/i,
  /\badvanced\b/i,
  /\bbeginner\b/i,
  /\bseries\b/i,
  /\b(?:journal|proceedings|anthology|essays|research|perspectives)\b/i,
]

/** Books about the market for books are not the books themselves. */
const META_TITLE_PATTERNS = [/\bbest\s?sellers?\b/i, /\bpopular fiction since\b/i, /\bbookclub\b/i]

const READER_CATEGORIES = /fiction|novels?|memoirs?|biograph|autobiograph|history|nature|science|social science|psychology|travel|cooking|art|music|mythology|comics|graphic novels/i
const SCHOOL_CATEGORIES = /education|study|reference|language arts|literary criticism|library science|computer|software|technology|engineering|mathematics|law|medicine/i
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

/** Formatting that describes an edition, not a different work. */
const EDITION_NOISE = [
  /\([^)]*\)/g,
  /\[[^\]]*\]/g,
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
    if (/[,\/]/.test(inner) || /\b(?:collection|boxed|box|set|series|omnibus)\b/i.test(inner)) {
      continue
    }
    add(inner)
  }
  return [...candidates]
}

/**
 * Canonical author identity. Sorting tokens handles "Andy Weir" vs "Weir Andy",
 * while the compatibility check below accepts abbreviated middle/second names
 * without treating genuinely different authors as the same person.
 */
function authorIdentity(book: Book): string {
  const name = book.authors.find((author) => normalize(author))
  if (!name) return ''
  return normalize(name)
    .replace(/\b(?:author|editor|illustrator|translator)\b/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

function authorsCompatible(a: Book, b: Book): boolean {
  const left = authorIdentity(a)
  const right = authorIdentity(b)
  if (!left || !right) return true
  if (left === right) return true

  const leftTokens = left.split(' ')
  const rightTokens = right.split(' ')
  if (leftTokens.length !== rightTokens.length) return false

  return leftTokens.every((token, index) => {
    const other = rightTokens[index]
    if (token === other) return true
    if (token.length === 1) return token === other[0]
    if (other.length === 1) return other === token[0]
    return false
  })
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

function isClearlyUnwanted(book: Book): boolean {
  const hardCategory = book.categories.some((category) =>
    HARD_CATEGORIES.some((pattern) => pattern.test(category)),
  )
  const hardTitle = HARD_TITLE_PATTERNS.some((pattern) => pattern.test(book.title))
  return hardCategory || hardTitle
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

  // A logarithmic curve rewards real engagement without letting one runaway
  // bestseller swamp the rest of the table. Ratings are only a smaller bonus.
  const popularity = Math.min(9, Math.log10(count + 1) * 1.8)
  const quality = rating === undefined ? 0 : Math.max(-2, Math.min(6, (rating - 3) * 2.2))
  const trustworthy = count >= 10 && rating !== undefined && rating >= 4 ? 2 : 0
  return Math.min(13, popularity + quality + trustworthy)
}

function readerFitScore(book: Book): number {
  const categories = categorySegments(book)
  let score = categories.some((category) => READER_CATEGORIES.test(category)) ? 2 : 0
  if (categories.some((category) => LOW_SIGNAL_CATEGORIES.test(category))) score -= 0.75
  if (book.coverUrl) score += 0.75
  if (book.description.trim().length > 120) score += 0.5

  const year = Number.parseInt(book.publishedDate.slice(0, 4), 10)
  if (Number.isFinite(year)) {
    if (year >= 2020) score += 1
    else if (year >= 2010) score += 0.5
  }
  return score
}

function academicPenalty(book: Book): number {
  const categories = categorySegments(book)
  let penalty = categories.some((category) => SCHOOL_CATEGORIES.test(category)) ? 5 : 0
  if (SOFT_TITLE_PATTERNS.some((pattern) => pattern.test(book.title))) penalty += 2.25
  return penalty
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

function scoreBook(
  book: Book,
  resultIndex: number,
  query: SwipeQuery,
  context: SwipeRankingContext,
): number {
  const relevance = Math.max(0, 14 - resultIndex) * 1.1 * query.weight
  const onTarget = matchesQueryTargets(query, book)
  const shelfBonus = onTarget ? SHELF_BONUS[query.shelf] : 0
  const offTargetPenalty = onTarget ? 0 : 8
  const metaPenalty = META_TITLE_PATTERNS.some((pattern) => pattern.test(book.title)) ? 6 : 0

  return (
    relevance +
    2 * query.weight +
    shelfBonus +
    engagementScore(book) +
    readerFitScore(book) +
    preferenceScore(book, context) -
    academicPenalty(book) -
    offTargetPenalty -
    metaPenalty
  )
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
  const candidates: { book: Book; score: number; queryKey: string }[] = []

  inputs.forEach(({ query, books }, groupIndex) => {
    const queryKey = `${groupIndex}:${query.query}`
    books.forEach((book, resultIndex) => {
      if (!book.sourceId || excluded?.has(book.sourceId)) return
      if (interactedWorks.some((interacted) => isSameWork(interacted, book))) return
      if (isClearlyUnwanted(book)) return
      if (seenWorks.some((seen) => isSameWork(seen, book))) return
      // Front-table searches are exact curation; fuzzy neighbours belong in
      // the later genre/discovery batches, not at the top of a new stack.
      if (query.targets?.length && !matchesQueryTargets(query, book)) return

      const score = scoreBook(book, resultIndex, query, context)
      const existing = candidates.find((candidate) => isSameWork(candidate.book, book))
      if (!existing) {
        candidates.push({ book, score, queryKey })
        return
      }

      // One work, possibly many Google editions. Keep the best placement and
      // the best record independently so a weaker edition cannot demote it.
      if (score > existing.score) {
        existing.score = score
        existing.queryKey = queryKey
      }
      if (isStrongerRecord(book, existing.book)) existing.book = book
    })
  })

  const sorted = candidates.sort(
    (a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title),
  )

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
