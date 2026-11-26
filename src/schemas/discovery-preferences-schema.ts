import type { CollectionSchema } from 'deepspace/schema'

/**
 * One owner-scoped row per reader holds the categories chosen during onboarding
 * and later edited from Settings. `categoryIds` is a JSON array in a text
 * column, matching the snapshot convention used by the other owned collections.
 */
export const discoveryPreferencesSchema: CollectionSchema = {
  name: 'discovery_preferences',
  uniqueOn: ['userId'],
  ownerField: 'userId',
  columns: [
    {
      name: 'userId',
      storage: 'text',
      interpretation: 'plain',
      userBound: true,
      immutable: true,
      required: true,
    },
    { name: 'categoryIds', storage: 'text', interpretation: 'plain' },
    { name: 'version', storage: 'number', interpretation: 'plain' },
    { name: 'onboardingCompleted', storage: 'text', interpretation: 'plain' },
    { name: 'updatedAt', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
