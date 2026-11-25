/**
 * Saved-books data layer. Everything lives in the existing `user_books`
 * collection; the book snapshot is stored with each row so a shelf renders
 * without another Google Books round trip.
 */

import { useCallback } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { Book, BookStatus, SavedBook } from './books'
import { parseBookSnapshot } from './book-parse'

interface UserBookRow {
  userId: string
  bookId: string
  status: BookStatus
  notes: string
  bookData: string
}

export function useSavedBooks() {
  const { isSignedIn, userId } = useAuth()
  const ownerId = userId ?? '__anonymous__'

  const { records, status: loadStatus } = useQuery<UserBookRow>('user_books', {
    where: { userId: ownerId },
    limit: 200,
  })
  const { ready, createConfirmed, putConfirmed, removeConfirmed } =
    useMutations<UserBookRow>('user_books')

  const savedBooks: SavedBook[] = records.map((record) => {
    const row = record.data
    return {
      ...parseBookSnapshot(row.bookData, row.bookId),
      recordId: record.recordId,
      status: row.status === 'reading' || row.status === 'read' ? row.status : 'want',
      notes: row.notes ?? '',
    }
  })

  const findRecord = useCallback(
    (id: string) => records.find((record) => record.data.bookId === id),
    [records],
  )

  const saveBook = useCallback(
    async (book: Book, bookStatus: BookStatus = 'want') => {
      if (!userId) throw new Error('Sign in to save books.')
      const id = book.sourceId
      const existing = findRecord(id)
      if (existing) {
        await putConfirmed(existing.recordId, { status: bookStatus })
        return
      }
      await createConfirmed({
        userId,
        bookId: id,
        status: bookStatus,
        notes: '',
        bookData: JSON.stringify(book),
      })
    },
    [userId, findRecord, putConfirmed, createConfirmed],
  )

  const setStatus = useCallback(
    async (id: string, bookStatus: BookStatus) => {
      const record = findRecord(id)
      if (record) await putConfirmed(record.recordId, { status: bookStatus })
    },
    [findRecord, putConfirmed],
  )

  const removeBook = useCallback(
    async (id: string) => {
      const record = findRecord(id)
      if (record) await removeConfirmed(record.recordId)
    },
    [findRecord, removeConfirmed],
  )

  return {
    isSignedIn,
    canWrite: ready && isSignedIn,
    loading: loadStatus === 'loading',
    savedBooks,
    isSaved: (id: string) => savedBooks.some((book) => book.sourceId === id),
    saveBook,
    setStatus,
    removeBook,
  }
}
