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
