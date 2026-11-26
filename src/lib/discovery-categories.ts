/**
 * Reader-chosen discovery categories.
 *
 * This is the single source of truth for the categories offered during
 * onboarding, the catalogue queries used to build swipe stacks, and the
 * category gate used by For You and the bookseller. Only standalone reading
 * categories live here: no periodicals, journals, textbooks, study guides or
 * academic publication types are offered.
 *
 * Category matching is deliberately evidence-based and deterministic. A book
 * must positively look like that kind of reading, from its subject metadata
 * (categories, main category, subtitle) or from a genre signal corroborated by
 * an independent book-form signal. A title or description that merely mentions
 * a genre is never enough on its own.
 */

import type { Book } from './books'

export const DISCOVERY_GROUPS = ['FICTION', 'NONFICTION', 'OTHER'] as const
export type DiscoveryGroup = (typeof DISCOVERY_GROUPS)[number]

export const DISCOVERY_CATEGORIES = [
  {
    id: 'contemporary-fiction',
    label: 'Contemporary Fiction',
    group: 'FICTION',
    queries: [
      'contemporary fiction novels',
      'modern literary novels friendship',
      'contemporary novels family life',
    ],
    subjects: [
      /\bcontemporary\b/,
      /\bmodern\s+(?:fiction|novels?)\b/,
      /\bcontemporary\s+(?:fiction|novels?|women|life)\b/,
    ],
    supporting: [
      /\bcontemporary\b/,
      /\bmodern\s+(?:life|fiction|novels?)\b/,
      /\beveryday\s+life\b/,
      /\bfriendship\b/,
      /\bfamily\s+life\b/,
    ],
  },
  {
    id: 'literary-fiction',
    label: 'Literary Fiction',
    group: 'FICTION',
    queries: ['literary fiction novels', 'literary novels character study', 'literary fiction novel family'],
    subjects: [
      /\bliterary\s+fiction\b/,
      /\bliterary\s+novels?\b/,
      /\bfiction\s+literary\b/,
    ],
    supporting: [/\bliterary\s+(?:fiction|novels?)\b/, /\bcharacter\s+stud(?:y|ies)\b/],
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    group: 'FICTION',
    queries: [
      'fantasy novels magic adventure',
      'epic fantasy novels dragons',
      'fantasy fiction novels magical world',
    ],
    subjects: [
      /\bfantasy\b/,
      /\bfiction\s+fantasy\b/,
      /\bfantasy\s+fiction\b/,
      /\bmagic(?:al)?\s+realism\b/,
      /\bepic\s+fantasy\b/,
    ],
    supporting: [
      /\bfantasy\b/,
      /\bmagic(?:al)?\b/,
      /\bdragons?\b/,
      /\bwizards?\b/,
      /\bother\s+worlds?\b/,
    ],
  },
  {
    id: 'science-fiction',
    label: 'Science Fiction',
    group: 'FICTION',
    queries: [
      'science fiction novels space',
      'science fiction novels dystopian future',
      'speculative fiction novels technology',
    ],
    subjects: [
      /\bscience\s+fiction\b/,
      /\bfiction\s+science\s+fiction\b/,
      /\bspeculative\s+fiction\b/,
      /\bdystopian\b/,
      /\bsci\s+fi\b/,
    ],
    supporting: [
      /\bscience\s+fiction\b/,
      /\bspeculative\s+fiction\b/,
      /\bdystopian\b/,
      /\bspace\s+(?:travel|opera|station|adventure)\b/,
      /\bfuture\s+world\b/,
    ],
  },
  {
    id: 'mystery',
    label: 'Mystery',
    group: 'FICTION',
    queries: ['mystery novels detective', 'cozy mystery novels crime', 'detective fiction novels investigation'],
    subjects: [
      /\bmystery\b/,
      /\bdetective\b/,
      /\bcrime\s+fiction\b/,
      /\bfiction\s+crime\b/,
      /\bcozy\s+mystery\b/,
    ],
    supporting: [
      /\bmystery\b/,
      /\bdetective\b/,
      /\bcrime\s+(?:novel|fiction|story)\b/,
      /\binvestigation\b/,
    ],
  },
  {
    id: 'thriller',
    label: 'Thriller',
    group: 'FICTION',
    queries: ['thriller novels suspense', 'psychological thriller novels', 'spy thriller novels suspense'],
    subjects: [
      /\bthrillers?\b/,
      /\bsuspense\b/,
      /\bfiction\s+thrillers\b/,
      /\bspy\s+thriller\b/,
    ],
    supporting: [/\bthriller\b/, /\bsuspense\b/, /\bspy\b/, /\bpsychological\s+thriller\b/],
  },
  {
    id: 'romance',
    label: 'Romance',
    group: 'FICTION',
    queries: ['romance novels contemporary love', 'historical romance novels', 'romantic fiction novels relationships'],
    subjects: [
      /\bromance\b/,
      /\bromantic\s+fiction\b/,
      /\bfiction\s+romance\b/,
      /\blove\s+stories\b/,
    ],
    supporting: [/\bromance\b/, /\bromantic\b/, /\blove\s+story\b/, /\blove\s+stories\b/],
  },
  {
    id: 'horror',
    label: 'Horror',
    group: 'FICTION',
    queries: ['horror novels ghost', 'gothic horror novels haunted', 'supernatural horror novels'],
    subjects: [
      /\bhorror\b/,
      /\bfiction\s+horror\b/,
      /\bgothic\s+horror\b/,
      /\bsupernatural\s+horror\b/,
    ],
    supporting: [/\bhorror\b/, /\bghost\s+story\b/, /\bhaunted\b/, /\bsupernatural\s+thriller\b/],
  },
  {
    id: 'historical-fiction',
    label: 'Historical Fiction',
    group: 'FICTION',
    queries: [
      'historical fiction novels',
      'historical novels world war',
      'historical fiction novels ancient rome',
    ],
    subjects: [
      /\bhistorical\s+fiction\b/,
      /\bfiction\s+historical\b/,
      /\bhistorical\s+novels?\b/,
    ],
    supporting: [/\bhistorical\s+fiction\b/, /\bhistorical\s+novels?\b/],
  },
  {
    id: 'history',
    label: 'History',
    group: 'NONFICTION',
    queries: ['narrative history', 'modern history nonfiction', 'world history nonfiction narrative'],
    subjects: [
      /\bhistory\b/,
      /\bhistories\b/,
      /\bnarrative\s+history\b/,
      /\bworld\s+war\b/,
      /\bancient\b/,
      /\bmedieval\b/,
    ],
    supporting: [/\bhistory\b/, /\bworld\s+war\b/, /\bancient\b/, /\bmedieval\b/],
    exclude: [/\bhistorical\s+fiction\b/, /\bfiction\s+historical\b/],
  },
  {
    id: 'biography-memoir',
    label: 'Biography & Memoir',
    group: 'NONFICTION',
    queries: ['biography memoir', 'memoir autobiography', 'biographical nonfiction life story'],
    subjects: [
      /\bbiograph(?:y|ies)\b/,
      /\bmemoirs?\b/,
      /\bautobiograph(?:y|ies)\b/,
      /\blife\s+stories?\b/,
      /\bbiographical\b/,
    ],
    supporting: [/\bmemoir\b/, /\bbiography\b/, /\bautobiography\b/, /\blife\s+story\b/],
  },
  {
    id: 'popular-science',
    label: 'Popular Science',
    group: 'NONFICTION',
    queries: ['popular science', 'accessible science nonfiction', 'science essays nature'],
    subjects: [
      /\bpopular\s+science\b/,
      /\baccessible\s+science\b/,
      /\bnature\b/,
      /\bphysics\b/,
      /\bbiology\b/,
      /\bpopular\s+nature\b/,
    ],
    supporting: [/\bpopular\s+science\b/, /\baccessible\s+science\b/, /\bnature\b/, /\bphysics\b/, /\bbiology\b/],
    exclude: [/\btext\s?books?\b/, /\bworkbooks?\b/, /\bstudy\s+guides?\b/],
  },
  {
    id: 'philosophy',
    label: 'Philosophy',
    group: 'NONFICTION',
    queries: ['philosophy nonfiction', 'ethics philosophy ideas', 'philosophy essays human nature'],
    subjects: [/\bphilosophy\b/, /\bphilosophical\b/, /\bethics\b/, /\bexistential(?:ism)?\b/],
    supporting: [/\bphilosophy\b/, /\bphilosophical\b/, /\bethics\b/, /\bexistential(?:ism)?\b/],
  },
  {
    id: 'general-nonfiction',
    label: 'General Nonfiction',
    group: 'NONFICTION',
    queries: ['narrative nonfiction culture', 'general nonfiction society', 'nonfiction essays culture politics'],
    subjects: [
      /\bnon\s?fiction\b/,
      /\bessays?\b/,
      /\bculture\b/,
      /\bsociety\b/,
      /\bpolitics\b/,
      /\bpsychology\b/,
      /\beconomics\b/,
      /\btravel\b/,
    ],
    supporting: [/\bnon\s?fiction\b/, /\bculture\b/, /\bsociety\b/, /\bpolitics\b/, /\btravel\b/],
    exclude: [/\bfiction\b(?!\s+non)/],
  },
  {
    id: 'poetry',
    label: 'Poetry',
    group: 'OTHER',
    queries: ['poetry collection poems', 'poetry collections contemporary poems', 'poems collection verse'],
    subjects: [/\bpoetry\b/, /\bpoems?\b/, /\bverse\b/, /\bpoetic\b/],
    supporting: [/\bpoetry\b/, /\bpoems?\b/, /\bverse\b/, /\bpoet\b/],
  },
  {
    id: 'short-story-collections',
    label: 'Short Story Collections',
    group: 'OTHER',
    queries: [
      'short story collection stories',
      'short stories collection fiction',
      'literary short stories collection',
    ],
    subjects: [
      /\bshort\s+stories\b/,
      /\bshort\s+story\b/,
      /\bfiction\s+short\s+stories\b/,
      /\bstories\b/,
    ],
    supporting: [/\bshort\s+stories\b/, /\bshort\s+story\b/, /\bstory\s+collection\b/],
  },
  {
    id: 'essay-collections',
    label: 'Essay Collections',
    group: 'OTHER',
    queries: ['essay collection essays', 'personal essays collection', 'essays collection nonfiction'],
    subjects: [/\bessays?\b/, /\bessay\s+collections?\b/, /\bliterary\s+collections\s+essays\b/],
    supporting: [/\bessays?\b/, /\bessay\s+collection\b/, /\bpersonal\s+essays\b/],
  },
] as const satisfies readonly {
  id: string
  label: string
  group: DiscoveryGroup
  queries: readonly string[]
  subjects: readonly RegExp[]
  supporting: readonly RegExp[]
  exclude?: readonly RegExp[]
}[]

export type DiscoveryCategoryId = (typeof DISCOVERY_CATEGORIES)[number]['id']
export type DiscoveryCategoryDefinition = (typeof DISCOVERY_CATEGORIES)[number]

export const DISCOVERY_CATEGORY_IDS: readonly DiscoveryCategoryId[] = DISCOVERY_CATEGORIES.map(
  (category) => category.id,
)

/**
 * A balanced starter set for readers whose saved preferences predate this
 * feature. It is never shown as if the reader had chosen it.
 */
export const DEFAULT_DISCOVERY_CATEGORY_IDS: readonly DiscoveryCategoryId[] = [
  'contemporary-fiction',
  'literary-fiction',
  'fantasy',
  'mystery',
  'history',
  'biography-memoir',
]

export const DISCOVERY_PREFERENCE_VERSION = 1

const CATEGORY_BY_ID = new Map<string, DiscoveryCategoryDefinition>(
  DISCOVERY_CATEGORIES.map((category) => [category.id, category]),
)

export function isDiscoveryCategoryId(value: unknown): value is DiscoveryCategoryId {
  return typeof value === 'string' && CATEGORY_BY_ID.has(value)
}

/** Drop unknown and repeated ids while keeping the reader's ordering. */
export function normalizeDiscoveryCategoryIds(value: unknown): DiscoveryCategoryId[] {
  if (!Array.isArray(value)) return []
  const result: DiscoveryCategoryId[] = []
  for (const entry of value) {
    if (!isDiscoveryCategoryId(entry) || result.includes(entry)) continue
    result.push(entry)
  }
  return result
}

/** Reads both the JSON form used by current writes and old comma text. */
export function parseStoredDiscoveryCategoryIds(raw: unknown): DiscoveryCategoryId[] {
  if (Array.isArray(raw)) return normalizeDiscoveryCategoryIds(raw)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return normalizeDiscoveryCategoryIds(parsed)
  } catch {
    // Older rows may hold a comma-separated list.
  }
  return normalizeDiscoveryCategoryIds(raw.split(','))
}

export function serializeDiscoveryCategoryIds(ids: readonly DiscoveryCategoryId[]): string {
  return JSON.stringify(normalizeDiscoveryCategoryIds(ids))
}

export function discoveryCategoryLabel(id: string): string {
  return CATEGORY_BY_ID.get(id)?.label ?? id
}

export function discoveryCategoryDefinition(id: DiscoveryCategoryId): DiscoveryCategoryDefinition {
  return CATEGORY_BY_ID.get(id)!
}

export function discoveryCategoryQueries(id: DiscoveryCategoryId): readonly string[] {
  return discoveryCategoryDefinition(id).queries
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Categories and subtitles are subject metadata; titles are weaker evidence. */
function subjectText(book: Book): string {
  return normalizeText(
    [...book.categories, book.mainCategory ?? '', book.subtitle ?? ''].join(' '),
  )
}

function supportingText(book: Book): string {
  return normalizeText(`${book.title} ${book.description}`)
}

/** Independent evidence that the record is a book people read, not a study of one. */
function hasBookForm(book: Book): boolean {
  const text = normalizeText(
    [...book.categories, book.mainCategory ?? '', book.title, book.subtitle ?? ''].join(' '),
  )
  return /\b(?:novels?|novellas?|fiction|short\s+stories|stories|poems?|poetry|verse|essays?|collections?|memoirs?|biograph(?:y|ies)|autobiograph(?:y|ies)|history|non\s?fiction|literary\s+collections)\b/.test(
    text,
  )
}

/**
 * A generic fiction category can describe any genre, so it only supports a
 * match when the category group agrees with the shelf being checked.
 */
function hasGenericSubjectForGroup(book: Book, group: DiscoveryGroup): boolean {
  const subject = subjectText(book)
  if (group === 'FICTION') {
    return /\b(?:fiction|novels?|short\s+stories|stories)\b/.test(subject)
  }
  if (group === 'NONFICTION') {
    return /\b(?:non\s?fiction|history|science|social\s+science|biograph(?:y|ies)|memoirs?|philosophy|psychology|economics|politics|culture|society|essays?)\b/.test(
      subject,
    )
  }
  return /\b(?:fiction|novels?|stories|poetry|poems?|essays?|collections?|literary\s+collections)\b/.test(
    subject,
  )
}

/** Study/reference records can match a genre word while being the wrong book. */
const STUDY_OF_GENRE_PATTERNS: readonly RegExp[] = [
  /\b(?:literary|poetry|poetic|fiction|novel|fantasy|dramatic|shakespearean|comparative)\b[\s\S]{0,60}\b(?:criticism|theor(?:y|ies)|analys(?:is|es)|commentar(?:y|ies)|interpretations?|scholarship|stud(?:y|ies)|monographs?|history)\b/,
  /\b(?:criticism|theor(?:y|ies)|analys(?:is|es)|commentar(?:y|ies)|interpretations?|scholarship|monographs?)\b[\s\S]{0,60}\b(?:literature|literary|novels?|fiction|poetry|poems?|fantasy|authors?|writers?|shakespeare|drama)\b/,
  /\b(?:understanding|interpreting|reading|analyzing|analysing|explaining|teaching)\s+(?:literature|fiction|novels?|poetry|poems?|fantasy|shakespeare|drama|stories)\b/,
  /\b(?:introduction\s+to|guide\s+to|companion\s+to|handbook\s+of|encyclopedia\s+of|dictionary\s+of|bibliography\s+of|critical\s+(?:edition|study|approach))\b[\s\S]{0,60}\b(?:literature|literary|fiction|novels?|poetry|poems?|fantasy|authors?|writers?|poets?|shakespeare|drama|writing)\b/,
  /\b(?:literary\s+studies|comparative\s+literature|literary\s+criticism|literary\s+theory|poetry\s+criticism|poetry\s+analysis|fiction\s+studies|fantasy\s+literature)\b/,
]

const REFERENCE_FORM_PATTERN =
  /\b(?:encyclopedia|dictionary|bibliography|study\s+guides?|text\s?books?|workbooks?|coursebooks?|technical\s+manual|user\s+manual|reference\s+manual)\b/

export type DiscoveryCategoryMatchReason = 'subject' | 'corroborated' | 'study' | 'none'

export interface DiscoveryCategoryMatchResult {
  matched: boolean
  reason: DiscoveryCategoryMatchReason
}

/**
 * Deterministic category eligibility. Positive subject metadata is enough;
 * a weaker title/description signal must be corroborated by book-form metadata
 * and must never be a study/reference publication about the genre.
 */
export function classifyDiscoveryCategoryMatch(
  book: Book,
  id: DiscoveryCategoryId,
): DiscoveryCategoryMatchResult {
  const definition = CATEGORY_BY_ID.get(id)
  if (!definition) return { matched: false, reason: 'none' }

  const subject = subjectText(book)
  const supporting = supportingText(book)
  const studyText = `${subject} ${supporting}`

  const categoryExcluded =
    'exclude' in definition && definition.exclude.some((pattern) => pattern.test(studyText))
  if (
    STUDY_OF_GENRE_PATTERNS.some((pattern) => pattern.test(studyText)) ||
    REFERENCE_FORM_PATTERN.test(studyText) ||
    categoryExcluded
  ) {
    return { matched: false, reason: 'study' }
  }

  if (definition.subjects.some((pattern) => pattern.test(subject))) {
    return { matched: true, reason: 'subject' }
  }
  if (
    hasGenericSubjectForGroup(book, definition.group) &&
    hasBookForm(book) &&
    definition.supporting.some((pattern) => pattern.test(supporting))
  ) {
    return { matched: true, reason: 'corroborated' }
  }
  return { matched: false, reason: 'none' }
}

/** Kept as the small boolean helper used by ranking and prompt context. */
export function matchesDiscoveryCategory(book: Book, id: DiscoveryCategoryId): boolean {
  return classifyDiscoveryCategoryMatch(book, id).matched
}

export function matchesAnyDiscoveryCategory(
  book: Book,
  ids: readonly DiscoveryCategoryId[],
): boolean {
  const selected = normalizeDiscoveryCategoryIds(ids)
  return selected.length > 0 && selected.some((id) => matchesDiscoveryCategory(book, id))
}

export function filterDiscoveryCategoryBooks<T extends Book>(
  books: readonly T[],
  ids: readonly DiscoveryCategoryId[],
): T[] {
  return books.filter((book) => matchesAnyDiscoveryCategory(book, ids))
}

/** Round-robin across selected shelves so no category dominates by default. */
export function buildCategoryRecommendationQueries(
  ids: readonly DiscoveryCategoryId[],
  count = 3,
): string[] {
  const selected = normalizeDiscoveryCategoryIds(ids)
  if (selected.length === 0) return []
  const queries: string[] = []
  for (let index = 0; index < count; index += 1) {
    const id = selected[index % selected.length]
    const variant = Math.floor(index / selected.length) % discoveryCategoryQueries(id).length
    const query = discoveryCategoryQueries(id)[variant]
    if (!queries.includes(query)) queries.push(query)
  }
  return queries
}

export function categoryPreferenceSummary(ids: readonly DiscoveryCategoryId[]): string {
  const selected = normalizeDiscoveryCategoryIds(ids)
  if (selected.length === 0) return 'No categories chosen yet; use balanced reading shelves.'
  return selected.map((id) => discoveryCategoryLabel(id)).join(', ')
}

/** Explicit words for a different shelf override saved choices for one turn. */
const REQUEST_PATTERNS: Record<DiscoveryCategoryId, readonly RegExp[]> = {
  'contemporary-fiction': [/\bcontemporary\s+(?:fiction|novels?)\b/, /\bmodern\s+novels?\b/],
  'literary-fiction': [/\bliterary\s+fiction\b/, /\bliterary\s+novels?\b/],
  fantasy: [/\bfantasy\b/, /\bdragons?\b/, /\bwizards?\b/],
  'science-fiction': [/\bscience\s+fiction\b/, /\bsci\s*fi\b/, /\bdystopian\b/, /\bspeculative\s+fiction\b/],
  mystery: [/\bmystery\b/, /\bdetective\s+(?:fiction|novels?|stories)\b/, /\bcozy\s+mystery\b/],
  thriller: [/\bthrillers?\b/, /\bsuspense\s+novels?\b/, /\bspy\s+novels?\b/],
  romance: [/\bromance\b/, /\bromantic\s+novels?\b/, /\blove\s+stories\b/],
  horror: [/\bhorror\b/, /\bghost\s+stories\b/, /\bhaunted\s+(?:novels?|stories)\b/],
  'historical-fiction': [/\bhistorical\s+fiction\b/, /\bhistorical\s+novels?\b/],
  history: [/\bhistory\b/, /\bnarrative\s+history\b/, /\bworld\s+war\b/, /\bancient\s+history\b/],
  'biography-memoir': [/\bbiograph(?:y|ies)\b/, /\bmemoirs?\b/, /\bautobiograph(?:y|ies)\b/],
  'popular-science': [/\bpopular\s+science\b/, /\baccessible\s+science\b/, /\bscience\s+books\b/],
  philosophy: [/\bphilosophy\b/, /\bphilosophical\b/, /\bethics\b/],
  'general-nonfiction': [/\bnon\s?fiction\b/, /\bnarrative\s+nonfiction\b/],
  poetry: [/\bpoetry\b/, /\bpoems?\b/, /\bverse\b/],
  'short-story-collections': [/\bshort\s+stories\b/, /\bshort\s+story\s+collections?\b/],
  'essay-collections': [/\bessays?\b/, /\bessay\s+collections?\b/, /\bpersonal\s+essays\b/],
}

/**
 * A specific request map only to the shelves it actually names. "Historical
 * fiction" and "science fiction" must not become history or popular science.
 */
export function discoveryCategoryIdsFromText(value: string): DiscoveryCategoryId[] {
  const text = normalizeText(value)
  if (!text) return []

  const disambiguated = text
    .replace(/historical\s+fiction/g, ' historicalfiction ')
    .replace(/science\s+fiction/g, ' sciencefiction ')
    .replace(/sci\s+fi/g, ' sciencefiction ')
    .replace(/narrative\s+nonfiction/g, ' narrativenonfiction ')
    .replace(/non\s?fiction/g, ' nonfiction ')

  const result: DiscoveryCategoryId[] = []
  for (const category of DISCOVERY_CATEGORIES) {
    const patterns =
      category.id === 'history'
        ? [/\bhistory\b/, /\bnarrative\s+history\b/, /\bworld\s+war\b/, /\bancient\s+history\b/]
        : category.id === 'science-fiction'
          ? [/\bsciencefiction\b/, /\bsci\s+fi\b/]
          : category.id === 'historical-fiction'
            ? [/\bhistoricalfiction\b/]
            : category.id === 'popular-science'
              ? [/\bpopular\s+science\b/, /\baccessible\s+science\b/, /\bscience\s+books\b/]
              : REQUEST_PATTERNS[category.id]
    if (patterns.some((pattern) => pattern.test(disambiguated))) result.push(category.id)
  }

  // Broad asks still override defaults, but only within the matching group.
  if (result.length === 0) {
    if (/\b(?:fiction|novels?|stories)\b/.test(disambiguated)) {
      return DISCOVERY_CATEGORIES.filter((category) => category.group === 'FICTION').map(
        (category) => category.id,
      )
    }
    if (/\b(?:nonfiction|narrativenonfiction)\b/.test(disambiguated)) {
      return DISCOVERY_CATEGORIES.filter((category) => category.group === 'NONFICTION').map(
        (category) => category.id,
      )
    }
  }
  return result
}
