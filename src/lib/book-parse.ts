import type { Book } from './books'

/** Parse a JSON book snapshot, tolerating rows saved before `bookData` existed. */
export function parseBookSnapshot(raw: string | undefined, fallbackId: string): Book {
  try {
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<Book>
    return {
      source: parsed.source ?? 'google_books',
      sourceId: parsed.sourceId ?? fallbackId,
      title: parsed.title ?? 'Untitled',
      authors: parsed.authors ?? [],
      description: parsed.description ?? '',
      categories: parsed.categories ?? [],
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
