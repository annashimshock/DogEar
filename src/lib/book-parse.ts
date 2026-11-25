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
