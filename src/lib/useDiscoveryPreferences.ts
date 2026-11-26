/**
 * Persisted reader categories.
 *
 * The row lives in the owner-scoped `discovery_preferences` collection, so it
 * survives sessions and syncs to the worker. The small local override only
 * smooths the moment between a confirmed write and the realtime record update.
 */

import { useCallback, useMemo, useState } from 'react'
import { useAuth, useMutations, useQuery } from 'deepspace'
import type { DiscoveryCategoryId } from './discovery-categories'
import {
  discoveryPreferencePayload,
  readDiscoveryPreferenceState,
  validateDiscoverySelection,
} from './discovery-preferences'

interface DiscoveryPreferencesRow {
  userId: string
  categoryIds: string
  version: number
  onboardingCompleted: string
  updatedAt: string
}

export function useDiscoveryPreferences() {
  const { isSignedIn, userId } = useAuth()
  const ownerId = userId ?? '__anonymous__'
  const [justSaved, setJustSaved] = useState<DiscoveryCategoryId[] | null>(null)

  const { records, status } = useQuery<DiscoveryPreferencesRow>('discovery_preferences', {
    where: { userId: ownerId },
    limit: 5,
  })
  const { ready, createConfirmed, putConfirmed } = useMutations<DiscoveryPreferencesRow>(
    'discovery_preferences',
  )

  // A sign-out/sign-in switch must not leak the previous reader's local choice.
  const [previousUserId, setPreviousUserId] = useState(userId)
  if (previousUserId !== userId) {
    setPreviousUserId(userId)
    setJustSaved(null)
  }

  const loading = isSignedIn && (!ready || status !== 'ready')
  const state = useMemo(
    () => readDiscoveryPreferenceState(records, { signedIn: isSignedIn, justSaved }),
    [records, isSignedIn, justSaved],
  )

  const savePreferences = useCallback(
    async (ids: readonly DiscoveryCategoryId[]): Promise<void> => {
      if (!userId) throw new Error('Sign in to save your shelves.')
      const valid = validateDiscoverySelection(ids)
      if (!valid.valid) throw new Error(valid.error ?? 'Choose at least one category.')

      const payload = discoveryPreferencePayload(userId, valid.categoryIds)
      const existing = records.find((item) => item.data.userId === userId)
      if (existing) await putConfirmed(existing.recordId, payload)
      else await createConfirmed(payload)

      setJustSaved(valid.categoryIds)
    },
    [createConfirmed, putConfirmed, records, userId],
  )

  return {
    isSignedIn,
    loading,
    canWrite: ready && isSignedIn,
    needsOnboarding: !loading && state.needsOnboarding,
    onboardingCompleted: state.onboardingCompleted,
    categoryIds: state.categoryIds,
    effectiveCategoryIds: state.effectiveCategoryIds,
    version: state.version,
    savePreferences,
  }
}
