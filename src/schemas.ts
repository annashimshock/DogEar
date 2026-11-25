/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { AI_CHATS_SCHEMA, AI_MESSAGES_SCHEMA } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { booksSchema } from './schemas/books-schema'
import { userBooksSchema } from './schemas/user-books-schema'
import { bookInteractionsSchema } from './schemas/book-interactions-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  booksSchema,
  userBooksSchema,
  bookInteractionsSchema,
  // Registering these activates the worker's owner-checked chat routes and
  // lets the client subscribe to its own conversations and messages. Writes
  // stay worker-mediated (`create: false`) so message roles cannot be forged.
  AI_CHATS_SCHEMA,
  AI_MESSAGES_SCHEMA,
]