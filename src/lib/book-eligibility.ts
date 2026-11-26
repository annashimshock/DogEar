/**
 * Central book eligibility for DogEar discovery.
 *
 * This is deliberately eligibility-first: a Google Books record must positively
 * look like a standalone, reader-facing book before it can be returned by the
 * worker or drawn on any discovery surface. Ranking, ratings, AI queries and
 * reader preferences are applied only after this gate.
 */

import type { Book } from './books'

export type EligibilityReason =
  | 'missing-identity'
  | 'missing-title'
  | 'not-book-print-type'
  | 'missing-publication-date'
  | 'missing-publisher'
  | 'missing-categories'
  | 'excluded-category'
  | 'excluded-publication'
  | 'serial-identifier'
  | 'serial-category'
  | 'serial-title'
  | 'serial-description'
  | 'serial-issue'
  | 'course-material'
  | 'research-publication'
  | 'scholarly-reference'
  | 'catalog-record'
  | 'insufficient-evidence'

export interface EligibilityResult {
  eligible: boolean
  reasons: EligibilityReason[]
}

const ISBN_LABEL = /\bisbn(?:[_-]?(?:10|13))?\b/i
const ISSN_LABEL = /\bissn\b/i
const DOI_LABEL = /\bdoi\b|\barxiv\b|\bpmid\b|10\.\d{4,9}\//i

const SERIAL_CATEGORIES =
  /\b(?:periodicals?|serials?|journals?|magazines?|newspapers?|newsletters?|bulletins?|gazettes?|annals?|proceedings?|dissertations?|theses|thesis)\b/i

const SERIAL_TITLE_PATTERNS = [
  /\b(?:literary|poetry|fiction|essay|creative writing|academic|scholarly|scientific|medical|historical)\s+(?:journal|magazine|review|quarterly|annual)\b/i,
  /\b(?:journal|magazine|periodical|serial)\s+(?:of|for)\b/i,
  /\b(?:a|the)\s+magazine of\b/i,
  /\b(?:monthly|weekly|quarterly|bimonthly|biweekly|semiannual)\b.{0,50}\b(?:magazine|journal|review|periodical)\b/i,
  /\b(?:magazine|journal|periodical|newsletter)\s+(?:volume|vol\.?|issue|no\.?|number)\b/i,
  /\b(?:conference proceedings|international conference|conference on|symposium on|proceedings of)\b/i,
  /\b(?:yearbook|annual review|annual report)\b/i,
  /\bnewsletter\b/i,
]

const KNOWN_SERIAL_TITLES = [
  /^(?:the\s+)?(?:paris review|granta|poetry|new yorker|atlantic monthly|times literary supplement|tls|literary review|poetry review|southern review|kenyon review|yale review|new republic|nation|nature|cell|lancet|jama|scientific american|national geographic|smithsonian|economist|time|newsweek|harvard review|journal of ethics)(?:\s*(?::|vol(?:ume)?|issue|no\.?|number|\d+)\b.*)?$/i,
]

/** Titles that are inherently recurring, even when Google supplies an ISBN. */
const STRONG_SERIAL_TITLES = [
  /\b(?:conference proceedings|proceedings of|international conference on|symposium on)\b/i,
  /\b(?:yearbook|annual review|annual report)\b/i,
]

const ISSUE_LABELS = /\b(?:vol(?:ume)?s?|issue|no\.?|number)\s*#?\s*\d+\b/i

const PERIODIC_DESCRIPTIONS = [
  /\b(?:published|issued|appears)\s+(?:quarterly|monthly|bimonthly|biweekly|weekly|annually|semiannually)\b/i,
  /\b(?:volumes?|vols?)\.?\s*\d+\b[^.]{0,80}\b(?:include|contains)\b/i,
  /\bissues?\s+(?:for|from)\s+(?:18|19|20)\d{2}\b/i,
  /\b(?:latest|current|spring|summer|fall|autumn|winter)\s+issue\b/i,
  /\b(?:continues|successor to|previous title|frequency)\b/i,
  /\b(?:an?|the)\s+[^.]{0,60}\b(?:quarterly|monthly|bimonthly|biweekly|weekly)\b\.?\s*$/i,
]

const COURSE_TITLES = [
  /\btext\s?books?\b/i,
  /\bworkbooks?\b/i,
  /\bcoursebooks?\b/i,
  /\bstudy guides?\b/i,
  /\bexam(?:ination)?s?\b.{0,40}\bprep(?:aration)?\b/i,
  /\btest prep\b/i,
  /\bpractice (?:tests?|questions?|problems?)\b/i,
  /\banswer keys?\b/i,
  /\b(?:solutions?|instructor'?s?|teacher'?s?) manual\b/i,
  /\bteacher'?s? edition\b/i,
  /\bfor dummies\b/i,
  /\bschaum'?s outline\b/i,
  /\b(?:sat|act|gre|gmat|lsat|mcat|toefl|ielts)\b.{0,30}\b(?:prep|practice|study|review)\b/i,
  /\bap\s+(?:english|history|chemistry|biology|calculus)\b.{0,30}\b(?:prep|review|study)\b/i,
  /\bcollege\s+(?:algebra|chemistry|physics|biology|calculus|statistics|economics)\b/i,
  /\bhigh\s?school\b.{0,40}\b(?:textbook|workbook|course)\b/i,
  /\bgrade\s+\d+\b.{0,40}\b(?:workbook|textbook|study)\b/i,
]

const COURSE_DESCRIPTIONS =
  /\b(?:course textbook|classroom textbook|student workbook|test preparation guide|study guide for)\b/i

const TEXTBOOK_SUBJECTS =
  /\b(?:calculus|algebra|chemistry|physics|biology|statistics|microeconomics|macroeconomics)\b/i
const ACADEMIC_SUBJECT_CATEGORIES =
  /\b(?:education|mathematics|study aids?|test preparation|examination|reference)\b/i

const MANUAL_TITLES = /\b(?:technical|user'?s?|owner'?s?|reference) manual\b/i

const RESEARCH_TITLES = [
  /\bdissertations?\b/i,
  /\bdoctoral thesis\b/i,
  /\bph\s?d\.?\s+thesis\b/i,
  /\bmaster'?s thesis\b/i,
  /\bresearch papers?\b/i,
  /\bworking papers?\b/i,
  /\bpreprints?\b/i,
  /\barxiv\b/i,
  /\bdoi\b/i,
  /\bpubmed\b/i,
  /\bjstor\b/i,
]

const RESEARCH_CATEGORIES =
  /\b(?:proceedings?|research papers?|dissertations?|theses|thesis|study aids?|test preparation|examination)\b/i

const RESEARCH_DESCRIPTIONS =
  /\bsubmitted in partial fulfillment\b|\bdissertation submitted\b|\bpeer reviewed research article\b|\bconference paper\b|\bthesis submitted\b/i

const SCHOLARLY_REFERENCE_TITLES =
  /\b(?:encyclopedia|dictionary|handbook|compendium|reference|thesaurus|bibliography)\b|\b(?:advanced|classical|modern)\s+[^,]{0,40}\s+(?:theory|methods?|approaches?)\b/i

const SCHOLARLY_REFERENCE_CATEGORIES =
  /\b(?:academic|scholarly|reference|library science|literary criticism)\b/i

const ACADEMIC_PUBLISHERS =
  /\b(?:springer|elsevier|wiley|taylor\s*&?\s*francis|routledge|sage publications|wolters kluwer|ieee|acm|nature publishing|academic press|palgrave|university press|research press|oxford university press|cambridge university press)\b/i

const READER_CATEGORIES =
  /\b(?:fiction|novels?|fantasy|science fiction|mystery|thriller|suspense|romance|historical fiction|history|biograph(?:y|ies)|autobiograph(?:y|ies)|memoirs?|popular science|science|nature|philosophy|psychology|economics|politics|essays?|literature|literary collections|poetry|short stories|comics|graphic novels|travel|true crime|art|music|religion|self help|health|cooking|business|sports|humor)\b/i

const READER_TITLE_SIGNALS =
  /\b(?:novel|novellas?|stories|poems|poetry|essays?|memoir|biography|history|philosophy|fiction|fantasy|mystery|thriller|romance|science|nature)\b/i

/**
 * Google Books categories that describe publications DogEar never recommends.
 * These are checked only against real category metadata, never against a title
 * or description, so an excluded category cannot be talked around by fuzzy
 * matching. Legitimate subjects such as history, philosophy and science are
 * deliberately absent: they remain eligible when the record is a real book.
 */
const EXCLUDED_CATEGORY_PATTERNS: readonly RegExp[] = [
  /\b(?:antiques?|collectibles?)\b/i,
  /\breference\b/i,
  /\b(?:study\s+aids?|test\s+preparation|examination)\b/i,
  /\b(?:education|teaching|teacher|classroom|curriculum|instruction)\b/i,
  /\b(?:writing(?:\s+guides?)?|rhetoric|composition|grammar|language\s+arts)\b/i,
  /\b(?:business\s+(?:manuals?|guides?)|management\s+(?:manuals?|guides?)|professional\s+training|training\s+materials?|career\s+guides?|vocational)\b/i,
  /\b(?:technical|user|owner|reference)\s+manuals?\b|\bmanuals?\b/i,
  /\b(?:proceedings?|research(?:\s+papers?)?|dissertations?|theses|thesis|academic|scholarly|conference)\b/i,
  /\b(?:literary\s+(?:criticism|theory|studies)|poetry\s+(?:criticism|analysis)|comparative\s+literature|fiction\s+studies|fantasy\s+literature)\b/i,
  /\b(?:periodicals?|serials?|journals?|magazines?|newspapers?|newsletters?|bulletins?)\b/i,
]

/**
 * Explicit publication forms that are never reading shelves. These are
 * rejection signals only: they do not supply a publisher or a category when
 * Google Books omits that metadata.
 */
const EXCLUDED_TITLE_PATTERNS: readonly RegExp[] = [
  /\bantiques?\s*(?:&|and)?\s*collectibles?\b/i,
  /\b(?:teacher'?s?|teaching)\s+(?:guide|manual|edition|materials?)\b/i,
  /\b(?:writing|grammar|rhetoric|composition)\s+(?:guide|manual|handbook|workbook|course|primer)\b/i,
  /\b(?:business|management|professional|corporate)\s+(?:manual|handbook|training|development)\b/i,
  /\b(?:professional|corporate|employee|vocational)\s+training\b|\btraining\s+materials?\b/i,
  /\b(?:academic|scholarly)\s+(?:research|paper|article|publication|study|studies)s?\b/i,
  /\b(?:literary|poetry|poetic|fiction|novel)\s+(?:criticism|theor(?:y|ies)|analys(?:is|es)|stud(?:y|ies))\b/i,
]

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function publicationYear(book: Book): number | undefined {
  const match = /^(\d{4})(?:-\d{1,2}(?:-\d{1,2})?)?$/.exec(book.publishedDate.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const latest = new Date().getUTCFullYear() + 2
  return year >= 1450 && year <= latest ? year : undefined
}

/** Publisher is mandatory metadata; whitespace and markup do not count. */
function publisherText(book: Book): string {
  return normalize(book.publisher ?? '')
}

function identifierText(book: Book): { text: string[]; hasIsbn: boolean; serial: boolean } {
  let hasIsbn = false
  let serial = false
  const text = (book.industryIdentifiers ?? []).map((entry) => {
    const type = normalize(entry.type ?? '')
    const identifier = normalize(entry.identifier ?? '')
    if (ISBN_LABEL.test(type) || ISBN_LABEL.test(identifier)) hasIsbn = true
    if (ISSN_LABEL.test(type) || DOI_LABEL.test(type) || DOI_LABEL.test(identifier)) serial = true
    if (/^\d{4}-\d{3}[\dx]$/.test(identifier)) serial = true
    return `${type} ${identifier}`.trim()
  })
  return { text, hasIsbn, serial }
}

/** Only real, nonempty Google Books categories count; titles never do. */
function categorySegments(book: Book): string[] {
  return [...book.categories, book.mainCategory ?? '']
    .map(normalize)
    .flatMap((category) => category.split(/[,&/]/))
    .map(normalize)
    .filter((category) => category.length >= 2 && /[a-z0-9]/.test(category))
}

function matchesAny(patterns: readonly RegExp[], values: readonly string[]): boolean {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)))
}

/**
 * Reasons are diagnostic only. An empty list does not mean eligible: positive
 * evidence is checked separately below.
 */
function rejectionReasons(book: Book): EligibilityReason[] {
  const reasons: EligibilityReason[] = []
  const title = normalize(book.title)
  const subtitle = normalize(book.subtitle ?? '')
  const titleText = [title, subtitle].filter(Boolean).join(' ')
  const description = normalize(book.description)
  const publisher = publisherText(book)
  const printType = normalize(book.printType ?? '')
  const categories = categorySegments(book)
  const identifiers = identifierText(book)
  const year = publicationYear(book)

  if (!book.source || !book.sourceId) reasons.push('missing-identity')
  if (title.length < 3) reasons.push('missing-title')
  if (printType !== 'book') reasons.push('not-book-print-type')
  if (year === undefined) reasons.push('missing-publication-date')
  if (!publisher) reasons.push('missing-publisher')
  if (categories.length === 0) reasons.push('missing-categories')
  if (categories.some((category) => EXCLUDED_CATEGORY_PATTERNS.some((pattern) => pattern.test(category)))) {
    reasons.push('excluded-category')
  }
  // A convincing reading title cannot talk around an excluded publication form,
  // and these forms are rejected even when Google supplies generic categories.
  if (matchesAny(EXCLUDED_TITLE_PATTERNS, [titleText])) reasons.push('excluded-publication')

  const isSerialCategory = categories.some((category) => SERIAL_CATEGORIES.test(category))
  const isSerialTitle = matchesAny(SERIAL_TITLE_PATTERNS, [titleText])
  const knownSerial = KNOWN_SERIAL_TITLES.some((pattern) => pattern.test(title))
  const issueLabel = ISSUE_LABELS.test(titleText) || ISSUE_LABELS.test(description)
  const periodicDescription = matchesAny(PERIODIC_DESCRIPTIONS, [description, subtitle])
  const weakSerialSignals =
    /\b(?:quarterly|monthly|weekly|bimonthly|biweekly|annually|semiannual)\b/.test(subtitle) ||
    knownSerial ||
    issueLabel ||
    periodicDescription
  const serialSignals = [
    identifiers.serial,
    isSerialCategory,
    isSerialTitle,
    weakSerialSignals,
    /^(?:magazine|periodical|serial|journal|newspaper)/.test(printType),
  ].filter(Boolean).length

  const strongSerialTitle =
    matchesAny(STRONG_SERIAL_TITLES, [titleText]) ||
    (knownSerial && (!identifiers.hasIsbn || identifiers.serial))

  if (identifiers.serial) reasons.push('serial-identifier')
  if (isSerialCategory) reasons.push('serial-category')
  if (
    strongSerialTitle ||
    ((isSerialTitle || knownSerial || issueLabel || periodicDescription) &&
      (serialSignals >= 2 || !identifiers.hasIsbn))
  ) {
    reasons.push('serial-title')
  }
  if (issueLabel && (!identifiers.hasIsbn || serialSignals >= 2)) reasons.push('serial-issue')
  if (periodicDescription && (!identifiers.hasIsbn || serialSignals >= 2)) {
    reasons.push('serial-description')
  }

  // A library-catalog row with an OTHER id, no creator, no cover and almost no
  // description is a serial/issue record that Google mislabeled as a book.
  const catalogOnly =
    identifiers.text.length > 0 &&
    !identifiers.hasIsbn &&
    book.authors.length === 0 &&
    !book.coverUrl &&
    description.length < 40 &&
    !publisher
  if (catalogOnly) reasons.push('catalog-record')

  if (
    matchesAny(COURSE_TITLES, [titleText]) ||
    COURSE_DESCRIPTIONS.test(description) ||
    (TEXTBOOK_SUBJECTS.test(titleText) &&
      categories.some((category) => ACADEMIC_SUBJECT_CATEGORIES.test(category)))
  ) {
    reasons.push('course-material')
  }
  if (MANUAL_TITLES.test(titleText)) reasons.push('course-material')
  if (
    matchesAny(RESEARCH_TITLES, [titleText]) ||
    categories.some((category) => RESEARCH_CATEGORIES.test(category)) ||
    RESEARCH_DESCRIPTIONS.test(description)
  ) {
    reasons.push('research-publication')
  }

  const scholarlyReference =
    SCHOLARLY_REFERENCE_TITLES.test(titleText) &&
    (ACADEMIC_PUBLISHERS.test(publisher) ||
      categories.some((category) => SCHOLARLY_REFERENCE_CATEGORIES.test(category)))
  if (scholarlyReference) reasons.push('scholarly-reference')

  return reasons
}

/** Positive signals that this is a real, standalone, reader-facing book. */
function evidenceScore(book: Book): number {
  const identifiers = identifierText(book)
  const categories = categorySegments(book)
  const description = normalize(book.description)
  const titleText = `${normalize(book.title)} ${normalize(book.subtitle ?? '')}`.trim()

  return [
    identifiers.hasIsbn,
    book.authors.length > 0,
    publicationYear(book) !== undefined,
    categories.some((category) => READER_CATEGORIES.test(category)),
    READER_TITLE_SIGNALS.test(titleText) || READER_TITLE_SIGNALS.test(description),
    description.length >= 60,
    !!publisherText(book),
  ].filter(Boolean).length
}

/**
 * Eligibility is independent of rating, ranking, or any model suggestion.
 * `printType: BOOK` is required, but never sufficient on its own.
 */
export function classifyBookEligibility(book: Book): EligibilityResult {
  const reasons = rejectionReasons(book)
  if (reasons.length === 0 && evidenceScore(book) < 3) reasons.push('insufficient-evidence')
  return { eligible: reasons.length === 0, reasons }
}

export function isEligibleBook(book: Book): boolean {
  return classifyBookEligibility(book).eligible
}

/** Use at every client boundary before anything can be rendered as a book. */
export function filterEligibleBooks<T extends Book>(books: readonly T[]): T[] {
  return books.filter(isEligibleBook)
}
