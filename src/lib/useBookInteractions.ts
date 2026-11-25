/**
 * Swipe signal data layer. Likes and passes are one owner-scoped row per book
 * in `book_interactions`; the book snapshot keeps a durable, readable history.
 */

import { useCallback } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { Book } from './books'
import { parseBookSnapshot } from './book-parse'

export type SwipeAction = 'like' | 'pass'

export interface BookInteraction extends Book {
  recordId: string
  action: SwipeAction
}

interface InteractionRow {
  userId: string
  bookId: string
  action: SwipeAction
  bookData: string
}

export function useBookInteractions() {
  const { isSignedIn, userId } = useAuth()
  const ownerId = userId ?? '__anonymous__'

  const { records, status: loadStatus } = useQuery<InteractionRow>('book_interactions', {
    where: { userId: ownerId },
    limit: 200,
  })
  const { ready, createConfirmed, putConfirmed, removeConfirmed } =
    useMutations<InteractionRow>('book_interactions')

  const interactions: BookInteraction[] = records.map((record) => {
    const row = record.data
    return {
      ...parseBookSnapshot(row.bookData, row.bookId),
      recordId: record.recordId,
      action: row.action === 'pass' ? 'pass' : 'like',
    }
  })

  const findRecord = useCallback(
    (id: string) => records.find((record) => record.data.bookId === id),
    [records],
  )

  /** Store a swipe and return the row id so the UI can undo that exact row. */
  const recordSwipe = useCallback(
    async (book: Book, action: SwipeAction): Promise<string> => {
      if (!userId) throw new Error('Sign in to save your reading preferences.')
      const existing = findRecord(book.sourceId)
      if (existing) {
        await putConfirmed(existing.recordId, {
          action,
          bookData: JSON.stringify(book),
        })
        return existing.recordId
      }
      return createConfirmed({
        userId,
        bookId: book.sourceId,
        action,
        bookData: JSON.stringify(book),
      })
    },
    [userId, findRecord, putConfirmed, createConfirmed],
  )

  const undoSwipe = useCallback(
    async (recordId: string) => {
      await removeConfirmed(recordId)
    },
    [removeConfirmed],
  )

  return {
    isSignedIn,
    canWrite: ready && isSignedIn,
    loading: loadStatus === 'loading',
    interactions,
    passedIds: new Set(interactions.filter((item) => item.action === 'pass').map((item) => item.sourceId)),
    likedIds: new Set(interactions.filter((item) => item.action === 'like').map((item) => item.sourceId)),
    recordSwipe,
    undoSwipe,
  }
}
