/**
 * Parsing for the bookseller's JSON replies.
 *
 * `generateText()` can put an answer in an earlier step, wrap it in Markdown,
 * or return no text at all. These helpers accept those real response shapes and
 * turn a failed parse into a null result so the caller can use grounded
 * fallbacks instead of throwing a stack trace at an expected formatting issue.
 */

import type { Book } from '../lib/books'
import {
  DEFAULT_INTENT,
  intentForFocus,
  isShelfEligibleBook,
  type RelevanceIntent,
} from '../lib/book-relevance'
import type { DiscoveryCategoryId } from '../lib/discovery-categories'
import {
  fallbackReason,
  groundedReason,
  type ReaderProfile,
  type RequestFocus,
} from '../lib/recommendations'

type UnknownRecord = Record<string, unknown>

export const JSON_ONLY_RETRY =
  'Your previous response was not a single valid JSON object. Reply with only the requested JSON object: no prose, no Markdown fence, no commentary.'

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Vercel AI SDK 7 keeps text from every step in `content`; `text` is final-step only. */
export function responseText(result: { content?: unknown; text?: unknown }): string {
  const parts = Array.isArray(result.content) ? result.content : []
  const text = parts
    .filter(isRecord)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => (part.text as string).trim())
    .filter(Boolean)
    .join('\n')
  return text || (typeof result.text === 'string' ? result.text.trim() : '')
}

/** Find balanced `{...}` slices without being fooled by braces inside strings. */
function objectCandidates(raw: string): string[] {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (start < 0) {
      if (char === '{') {
        start = index
        depth = 1
        inString = false
        escaped = false
      }
      continue
    }

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        candidates.push(raw.slice(start, index + 1))
        start = -1
      }
    }
  }

  return candidates
}

function parseObject(text: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Accept direct JSON, fenced JSON, or one JSON object inside explanatory text. */
export function parseJsonObject(raw: string): UnknownRecord | null {
  const text = raw.trim()
  if (!text) return null

  const direct = parseObject(text)
  if (direct) return direct

  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (const fence of fences) {
    const parsed = parseObject(fence[1].trim())
    if (parsed) return parsed
  }

  const proseCandidates = objectCandidates(text)
    .map((candidate) => ({ candidate, parsed: parseObject(candidate) }))
    .filter((entry): entry is { candidate: string; parsed: UnknownRecord } => !!entry.parsed)
    .sort(
      (a, b) =>
        Object.keys(b.parsed).length - Object.keys(a.parsed).length ||
        b.candidate.length - a.candidate.length,
    )

  return proseCandidates[0]?.parsed ?? null
}

const cleanStrings = (value: unknown, limit: number, maxLength: number): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, maxLength))
            .filter(Boolean),
        ),
      ].slice(0, limit)
    : []

export interface Suggestion {
  reply: string
  queries: string[]
}

export function suggestionFromObject(parsed: UnknownRecord): Suggestion | null {
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 800) : ''
  const queries = cleanStrings(parsed.queries, 3, 300)
  if (!reply && queries.length === 0) return null
  return { reply, queries }
}

export function parseSuggestionJson(raw: string): Suggestion | null {
  const parsed = parseJsonObject(raw)
  return parsed ? suggestionFromObject(parsed) : null
}

/**
 * Reasons are keyed by Google Books source id. A positional array is rejected:
 * model output order is not a reliable link to a ranked book record.
 */
export function reasonsFromObject(
  parsed: UnknownRecord,
  books: readonly Book[],
): Map<string, string> {
  const reasons = new Map<string, string>()
  const knownIds = new Set(books.map((book) => book.sourceId))
  const value = parsed.reasons

  if (isRecord(value)) {
    for (const [id, reason] of Object.entries(value)) {
      if (knownIds.has(id) && typeof reason === 'string' && reason.trim()) {
        reasons.set(id, reason.trim())
      }
    }
    return reasons
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isRecord(entry)) continue
      const id = typeof entry.sourceId === 'string' ? entry.sourceId : entry.id
      const reason = typeof entry.reason === 'string' ? entry.reason : entry.text
      if (typeof id === 'string' && knownIds.has(id) && typeof reason === 'string' && reason.trim()) {
        reasons.set(id, reason.trim())
      }
    }
  }

  return reasons
}

export function parseGroundedReasons(raw: string, books: readonly Book[]): Map<string, string> {
  const parsed = parseJsonObject(raw)
  return parsed ? reasonsFromObject(parsed, books) : new Map()
}

/** Attach notes by record id; every missing or ungrounded note gets a real fallback. */
export function applyGroundedReasons<T extends Book>(
  books: readonly T[],
  raw: string,
  profile: ReaderProfile,
  focus: RequestFocus,
): (T & { reason: string })[] {
  const reasons = parseGroundedReasons(raw, books)
  return books.map((book) => ({
    ...book,
    reason: groundedReason(reasons.get(book.sourceId), book) ?? fallbackReason(book, profile, focus),
  }))
}

/**
 * Read a model selection by Google Books id. Unknown, ineligible, off-category
 * and duplicate ids are discarded before they can become a recommendation; a
 * reason-only reply is also accepted as an implicit selection.
 */
export function selectedSourceIds(
  parsed: UnknownRecord | null,
  candidates: readonly Book[],
  maxBooks: number,
  intent: RelevanceIntent = DEFAULT_INTENT,
  categoryIds?: readonly DiscoveryCategoryId[] | null,
): string[] {
  if (!parsed) return []
  const knownIds = new Set(
    candidates
      .filter((book) => isShelfEligibleBook(book, intent, categoryIds))
      .map((book) => book.sourceId),
  )
  const ids: string[] = []
  const value = parsed.selected ?? parsed.sourceIds ?? parsed.books

  const add = (id: unknown) => {
    if (typeof id === 'string' && knownIds.has(id) && !ids.includes(id)) ids.push(id)
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') add(entry)
      else if (isRecord(entry)) add(entry.sourceId ?? entry.id)
    }
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) add(key)
  }

  if (ids.length === 0) {
    for (const id of reasonsFromObject(parsed, candidates).keys()) add(id)
  }

  return ids.slice(0, Math.max(0, maxBooks))
}

/**
 * Curate only from verified records that pass eligibility, the active relevance
 * policy, and the current category gate. If the model omits an id or names one
 * we do not have, fill the shelf from the next ranked candidate.
 */
export function curateGroundedBooks<T extends Book>(
  candidates: readonly T[],
  parsed: UnknownRecord | null,
  profile: ReaderProfile,
  focus: RequestFocus,
  maxBooks = 8,
  categoryIds?: readonly DiscoveryCategoryId[] | null,
): (T & { reason: string })[] {
  const intent = intentForFocus(focus)
  const eligible = candidates.filter((book) => isShelfEligibleBook(book, intent, categoryIds))
  const byId = new Map(eligible.map((book) => [book.sourceId, book] as const))
  const chosen: T[] = []

  for (const id of selectedSourceIds(parsed, eligible, maxBooks, intent, categoryIds)) {
    const book = byId.get(id)
    if (book && !chosen.some((item) => item.sourceId === book.sourceId)) chosen.push(book)
  }
  for (const book of eligible) {
    if (chosen.length >= maxBooks) break
    if (!chosen.some((item) => item.sourceId === book.sourceId)) chosen.push(book)
  }

  const reasons = parsed ? reasonsFromObject(parsed, eligible) : new Map<string, string>()
  return chosen.map((book) => ({
    ...book,
    reason: groundedReason(reasons.get(book.sourceId), book) ?? fallbackReason(book, profile, focus),
  }))
}
