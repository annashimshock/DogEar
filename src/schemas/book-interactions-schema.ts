import type { CollectionSchema } from 'deepspace/schema'

/**
 * One swipe signal per user and book. Likes also save to `user_books`; passes
 * stay here as negative recommendation signals. The JSON `bookData` snapshot
 * keeps a readable history even if the book later drops out of search.
 */
export const bookInteractionsSchema: CollectionSchema = {
  name: 'book_interactions',
  uniqueOn: ['userId', 'bookId'],
  ownerField: 'userId',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      userBound: true,
      immutable: true,
    },
    { name: 'bookId', storage: 'text', interpretation: 'plain' },
    { name: 'action', storage: 'text', interpretation: 'plain' },
    { name: 'bookData', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
