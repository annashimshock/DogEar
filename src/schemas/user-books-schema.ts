
import type { CollectionSchema } from 'deepspace/schema'

export const userBooksSchema: CollectionSchema = {
  name: 'user_books',

  // Each user can have only one entry for each book.
  uniqueOn: ['userId', 'bookId'],

  // Use userId to enforce record ownership.
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
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'notes', storage: 'text', interpretation: 'plain' },
  ],

  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
