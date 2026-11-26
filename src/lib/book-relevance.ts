/**
 * Recommendation relevance for DogEar — deliberately separate from publication
 * eligibility.
 *
 * `isEligibleBook()` answers "is this a real standalone book?" This module
 * answers the different question "does this book belong on a default reading
 * shelf?" A scholarly book about novels can be a perfectly valid publication
 * while still being the wrong recommendation for a reader who asked for a
 * novel. Ranking never gets to override either gate.
 */

import type { Book } from './books'
import { isEligibleBook } from './book-eligibility'
import {
  matchesAnyDiscoveryCategory,
  type DiscoveryCategoryId,
} from './discovery-categories'

/** The default intent is stated once and reused in prompts and diagnostics. */
export const DEFAULT_RECOMMENDATION_INTENT =
  'Recommend books people would choose to read for enjoyment, including novels, genre fiction, poetry collections, and accessible nonfiction. Do not recommend academic books about literature, literary criticism, scholarly commentary, textbooks, or reference materials unless explicitly requested.'

const EXPLICIT_LITERARY_STUDIES_INTENT =
  'The reader explicitly asked for literary criticism, theory, analysis or commentary. Valid standalone books on those subjects are relevant for this request only.'

export type RelevanceMode = 'default' | 'literary-studies'

export interface RelevanceIntent {
  mode: RelevanceMode
  allowLiteraryStudies: boolean
  statement: string
}

export const DEFAULT_INTENT: RelevanceIntent = {
  mode: 'default',
  allowLiteraryStudies: false,
  statement: DEFAULT_RECOMMENDATION_INTENT,
}

export const LITERARY_STUDIES_INTENT: RelevanceIntent = {
  mode: 'literary-studies',
  allowLiteraryStudies: true,
  statement: EXPLICIT_LITERARY_STUDIES_INTENT,
}

export type RelevanceReason =
  | 'study-of-literature'
  | 'academic-subject'
  | 'scholarly-description'
  | 'writing-instruction'
  | 'literary-reference'

export interface RelevanceResult {
  relevant: boolean
  /** Used only for ordering; it cannot turn a rejected record back on. */
  score: number
  reasons: RelevanceReason[]
}

/** Titles whose subject is the study of literature, not literature itself. */
const ACADEMIC_LITERATURE_TITLES: readonly RegExp[] = [
  /\b(?:literary|poetry|poetic|novel|fiction|dramatic|shakespearean|comparative)\b[\s\S]{0,60}\b(?:criticism|theor(?:y|ies)|analys(?:is|es)|commentar(?:y|ies)|interpretations?|scholarship|stud(?:y|ies)|monographs?|seminars?)\b/i,
  /\b(?:criticism|theor(?:y|ies)|analys(?:is|es)|commentar(?:y|ies)|interpretations?|scholarship|monographs?)\b[\s\S]{0,60}\b(?:literature|literary|novels?|fiction|poetry|poems?|poets?|authors?|writers?|shakespeare|drama)\b/i,
  /\b(?:understanding|interpreting|reading|analyzing|analysing|explaining|teaching)\s+(?:literature|fiction|novels?|poetry|poems?|shakespeare|drama|stories)\b/i,
  /\b(?:introduction\s+to|guide\s+to|companion\s+to|handbook\s+of|encyclopedia\s+of|dictionary\s+of|bibliography\s+of|critical\s+(?:edition|study|approach)|scholarly\s+(?:edition|study|article))\b[\s\S]{0,60}\b(?:literature|literary|fiction|novels?|poetry|poems?|authors?|writers?|poets?|shakespeare|drama|writing)\b/i,
  /\b(?:comparative\s+literature|literary\s+studies|literary\s+history|poetry\s+analysis|poetry\s+criticism|novel\s+studies|fiction\s+studies)\b/i,
]

const WRITING_INSTRUCTION_TITLES: readonly RegExp[] = [
  /\b(?:academic|scholarly|technical|business|expository|argumentative)\s+writing\b/i,
  /\b(?:writing|grammar|rhetoric|composition)\s+(?:guide|handbook|manual|instruction|workbook|course|primer)\b/i,
  /\b(?:how\s+to\s+write|writing\s+for\s+(?:academics?|scholars?|college|university)|research\s+paper\s+writing|the\s+elements\s+of\s+style)\b/i,
]

const LITERARY_REFERENCE_TITLES =
  /\b(?:encyclopedia|dictionary|handbook|companion|bibliography|index|atlas|guide)\b[\s\S]{0,60}\b(?:literature|literary|authors?|writers?|poets?|novelists?|poetry|fiction|novels?|movements?)\b/i

const ACADEMIC_LITERATURE_CATEGORIES =
  /\b(?:literary criticism|literary theory|literary studies|comparative literature|poetry criticism|poetry analysis|scholarly|academic|academic writing|technical writing|rhetoric|composition|grammar|language arts|study aids?|test preparation|textbooks?)\b/i

const SCHOLARLY_DESCRIPTIONS =
  /\b(?:literary criticism|literary theory|critical analysis|scholarly (?:study|analysis|article|monograph)|academic study|study guide|course textbook|peer reviewed|submitted in partial fulfillment)\b/i

const READING_CATEGORIES =
  /\b(?:fiction|novels?|fantasy|science fiction|mystery|thriller|suspense|romance|horror|historical fiction|short stories|comics|graphic novels|biograph(?:y|ies)|autobiograph(?:y|ies)|memoirs?|history|popular science|science|nature|philosophy|psychology|economics|politics|essays?|poetry|poems?|travel|true crime|religion|art|music|humor|self help|health|cooking|business|sports|literature)\b/i

const READING_TITLE_SIGNALS =
  /\b(?:novel(?:s|la)?|novellas?|stories|poems?|poetry|collection|memoir|biography|autobiography|history|fantasy|mystery|thriller|suspense|romance|horror|science fiction|essays?|philosophy|nature|travel)\b/i

const READING_DESCRIPTION_SIGNALS =
  /\b(?:novel|story|stories|poems?|poetry|memoir|biography|history|fantasy|mystery|thriller|romance|science|nature|accessible|general readers?)\b/i

/**
 * Requests that make the study of literature relevant. Deliberately narrow:
 * "literary fiction" and "a novel about a writer" must never flip this on.
 */
const LITERARY_STUDIES_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(?:literary|poetry|poetic)\s+(?:criticism|theory|analys(?:is|es)|commentar(?:y|ies)|interpretation|scholarship|stud(?:y|ies))\b/i,
  /\b(?:criticism|theor(?:y|ies)|analys(?:is|es)|commentar(?:y|ies)|interpretations?|scholarship)\s+(?:of\s+)?(?:literature|novels?|fiction|poetry|poems?|authors?|writers?|shakespeare|drama)\b/i,
  /\b(?:novel|fiction|poem|poetry|shakespeare)\s+(?:studies|analysis|interpretation)\b/i,
  /\bcomparative\s+literature\b/i,
  /\b(?:academic|scholarly)\s+(?:commentary|analysis|stud(?:y|ies)|article)\b/i,
  /\b(?:academic\s+writing|writing\s+instruction)\b/i,
]

function matchesAny(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

export function isLiteraryStudiesRequest(text: string): boolean {
  return matchesAny(LITERARY_STUDIES_REQUEST_PATTERNS, text.trim())
}

export function intentFromText(text: string): RelevanceIntent {
  return isLiteraryStudiesRequest(text) ? LITERARY_STUDIES_INTENT : DEFAULT_INTENT
}

export function intentForFocus(focus: {
  text?: string
  literaryStudies?: boolean
}): RelevanceIntent {
  if (focus.literaryStudies) return LITERARY_STUDIES_INTENT
  return focus.text ? intentFromText(focus.text) : DEFAULT_INTENT
}

/**
 * Relevance is intentionally evidence-based but never overrides eligibility.
 * A book about literature scores negatively for default shelves; the same
 * eligible record becomes relevant when the reader asks for that subject.
 */
export function classifyBookRelevance(
  book: Book,
  intent: RelevanceIntent = DEFAULT_INTENT,
): RelevanceResult {
  const titleText = `${book.title} ${book.subtitle ?? ''}`
  const categoryText = [...book.categories, book.mainCategory ?? ''].join(' ')
  const description = book.description
  const reasons: RelevanceReason[] = []

  const studyOfLiterature =
    matchesAny(ACADEMIC_LITERATURE_TITLES, titleText) || LITERARY_REFERENCE_TITLES.test(titleText)
  const writingInstruction = matchesAny(WRITING_INSTRUCTION_TITLES, titleText)
  const academicSubject = ACADEMIC_LITERATURE_CATEGORIES.test(categoryText)
  const scholarlyDescription = SCHOLARLY_DESCRIPTIONS.test(description)

  if (studyOfLiterature) reasons.push('study-of-literature')
  if (writingInstruction) reasons.push('writing-instruction')
  if (academicSubject) reasons.push('academic-subject')
  if (scholarlyDescription) reasons.push('scholarly-description')

  if (reasons.length === 0) {
    let score = 0
    if (READING_CATEGORIES.test(categoryText)) score += 3
    if (READING_TITLE_SIGNALS.test(titleText)) score += 2
    if (READING_DESCRIPTION_SIGNALS.test(description)) score += 1
    return { relevant: true, score, reasons }
  }

  if (!intent.allowLiteraryStudies) {
    return { relevant: false, score: -12, reasons }
  }

  return { relevant: true, score: 5, reasons }
}

/** Eligibility is still authoritative; relevance is the second gate. */
export function isRecommendedBook(book: Book, intent: RelevanceIntent = DEFAULT_INTENT): boolean {
  return isEligibleBook(book) && classifyBookRelevance(book, intent).relevant
}

export function filterRecommendedBooks<T extends Book>(
  books: readonly T[],
  intent: RelevanceIntent = DEFAULT_INTENT,
): T[] {
  return books.filter((book) => isRecommendedBook(book, intent))
}

/**
 * The hard gate for reader-facing shelves: a record must be both a standalone
 * book fit for default reading and a positive match for at least one active
 * category. Only `null` lifts the category part, for an explicit
 * literary-studies request; an empty list means no shelf is active and so no
 * book may be shown. Pure ranking helpers may omit the argument, but every
 * rendering boundary supplies real ids (or an explicit null).
 */
export function isShelfEligibleBook(
  book: Book,
  intent: RelevanceIntent = DEFAULT_INTENT,
  categoryIds?: readonly DiscoveryCategoryId[] | null,
): boolean {
  if (!isRecommendedBook(book, intent)) return false
  if (categoryIds === null || categoryIds === undefined) return true
  return matchesAnyDiscoveryCategory(book, categoryIds)
}

export function filterShelfBooks<T extends Book>(
  books: readonly T[],
  categoryIds?: readonly DiscoveryCategoryId[] | null,
  intent: RelevanceIntent = DEFAULT_INTENT,
): T[] {
  return books.filter((book) => isShelfEligibleBook(book, intent, categoryIds))
}
