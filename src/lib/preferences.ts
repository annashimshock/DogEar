/**
 * The compact preference profile sent with recommendation requests. It is
 * derived from the signed-in user's own subscribed records — never from a
 * static list — and validated again on the server against the JWT subject.
 */

import type { SavedBook } from './books'
import type { BookInteraction } from './useBookInteractions'

export interface PreferenceSummary {
  userId: string
  liked: string[]
  passed: string[]
  saved: { title: string; status: string }[]
  authors: string[]
  categories: string[]
  /** Exact Google Books ids to leave out of recommendation shelves. */
  excludedIds: string[]
  /** Recent requests from the reader's own conversations. */
  conversationHints: string[]
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit)
}

export function buildPreferenceSummary(
  userId: string,
  savedBooks: SavedBook[],
  interactions: BookInteraction[],
  recentRequests: string[] = [],
): PreferenceSummary {
  const likedBooks = interactions.filter((item) => item.action === 'like')
  const passedBooks = interactions.filter((item) => item.action === 'pass')
  // Every saved book is a positive signal; reading and finished shelves carry
  // extra context on the server, but a Want to Read pick still counts.
  const enjoyed = [...likedBooks, ...savedBooks]

  return {
    userId,
    liked: unique(likedBooks.map((book) => book.title), 12),
    passed: unique(passedBooks.map((book) => book.title), 12),
    saved: savedBooks.slice(0, 20).map((book) => ({ title: book.title, status: book.status })),
    authors: unique(enjoyed.flatMap((book) => book.authors), 12),
    categories: unique(enjoyed.flatMap((book) => book.categories), 12),
    excludedIds: unique([...savedBooks, ...interactions].map((book) => book.sourceId), 100),
    conversationHints: unique(recentRequests.map((text) => text.slice(0, 200)), 8),
  }
}
