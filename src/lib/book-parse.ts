import type { Book } from './books'

function strings(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback
}

function identifiers(value: unknown): Book['industryIdentifiers'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    if (typeof row.type !== 'string' || typeof row.identifier !== 'string') return []
    return [{ type: row.type, identifier: row.identifier }]
  })
}

/** Parse a JSON book snapshot, tolerating rows saved before `bookData` existed. */
export function parseBookSnapshot(raw: string | undefined, fallbackId: string): Book {
  try {
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<Book>
    return {
      source: parsed.source ?? 'google_books',
      sourceId: parsed.sourceId ?? fallbackId,
      title: parsed.title ?? 'Untitled',
      authors: strings(parsed.authors),
      description: parsed.description ?? '',
      categories: strings(parsed.categories),
      publishedDate: parsed.publishedDate ?? '',
      coverUrl: parsed.coverUrl ?? null,
      averageRating:
        typeof parsed.averageRating === 'number' && Number.isFinite(parsed.averageRating)
          ? parsed.averageRating
          : undefined,
      ratingsCount:
        typeof parsed.ratingsCount === 'number' && Number.isFinite(parsed.ratingsCount)
          ? parsed.ratingsCount
          : undefined,
      publisher: typeof parsed.publisher === 'string' ? parsed.publisher : undefined,
      language: typeof parsed.language === 'string' ? parsed.language : undefined,
      pageCount:
        typeof parsed.pageCount === 'number' && Number.isFinite(parsed.pageCount)
          ? parsed.pageCount
          : undefined,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : undefined,
      printType: typeof parsed.printType === 'string' ? parsed.printType : undefined,
      mainCategory: typeof parsed.mainCategory === 'string' ? parsed.mainCategory : undefined,
      industryIdentifiers: identifiers(parsed.industryIdentifiers),
    }
  } catch {
    return {
      source: 'google_books',
      sourceId: fallbackId,
      title: 'Untitled',
      authors: [],
      description: '',
      categories: [],
      publishedDate: '',
      coverUrl: null,
    }
  }
}
