import type { CollectionSchema } from 'deepspace/schema'

export const booksSchema: CollectionSchema = {
    name: 'books',
    columns: [
        { name: 'title', storage: 'text', interpretation: 'plain' },
        { name: 'author', storage: 'text', interpretation: 'plain' },
        { name: 'description', storage: 'text', interpretation: 'plain' },
        { name: 'coverUrl', storage: 'text', interpretation: 'plain' },
        { name: 'genres', storage: 'text', interpretation: 'plain' },
        { name: 'publishedYear', storage: 'text', interpretation: 'plain' },
    ],
    permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}