/**
 * Pure reading preference state helpers.
 *
 * The React hook owns only the live record subscription; validation, storage
 * decoding and the onboarding gate are kept here so they can be tested without
 * mounting DeepSpace providers.
 */

import {
  DEFAULT_DISCOVERY_CATEGORY_IDS,
  DISCOVERY_PREFERENCE_VERSION,
  normalizeDiscoveryCategoryIds,
  parseStoredDiscoveryCategoryIds,
  type DiscoveryCategoryId,
} from './discovery-categories'

export interface DiscoveryPreferenceRecordData {
  userId?: string
  categoryIds?: unknown
  version?: number
  onboardingCompleted?: unknown
  updatedAt?: string
}

export interface DiscoveryPreferenceRecord {
  recordId: string
  data: DiscoveryPreferenceRecordData
}

export interface DiscoveryPreferenceState {
  categoryIds: DiscoveryCategoryId[]
  effectiveCategoryIds: readonly DiscoveryCategoryId[]
  onboardingCompleted: boolean
  needsOnboarding: boolean
  version: number
}

export interface DiscoveryPreferenceOptions {
  signedIn: boolean
  /** Local confirmation used only until the realtime row catches up. */
  justSaved?: readonly DiscoveryCategoryId[] | null
}

function isCompleted(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * A missing row means the reader has not chosen yet. Existing readers are never
 * blocked by a legacy row that predates categories: the balanced defaults keep
 * their shelves working, and /preferences offers the one-time update.
 */
export function readDiscoveryPreferenceState(
  rows: readonly DiscoveryPreferenceRecord[],
  options: DiscoveryPreferenceOptions,
): DiscoveryPreferenceState {
  const row = rows[0]
  const storedIds = parseStoredDiscoveryCategoryIds(row?.data.categoryIds)
  const onboardingCompleted = rows.some((entry) => isCompleted(entry.data.onboardingCompleted))
  const justSaved =
    options.justSaved === null || options.justSaved === undefined
      ? null
      : normalizeDiscoveryCategoryIds(options.justSaved)
  const categoryIds = justSaved ?? storedIds
  const effectiveCategoryIds =
    categoryIds.length > 0 ? categoryIds : DEFAULT_DISCOVERY_CATEGORY_IDS

  return {
    categoryIds,
    effectiveCategoryIds,
    onboardingCompleted: onboardingCompleted || justSaved !== null,
    needsOnboarding: options.signedIn && !onboardingCompleted && justSaved === null,
    version: typeof row?.data.version === 'number' ? row.data.version : DISCOVERY_PREFERENCE_VERSION,
  }
}

export interface DiscoverySelectionValidation {
  valid: boolean
  categoryIds: DiscoveryCategoryId[]
  error?: string
}

/** Also used by the UI, so an empty selection cannot be persisted anywhere. */
export function validateDiscoverySelection(value: unknown): DiscoverySelectionValidation {
  const categoryIds = normalizeDiscoveryCategoryIds(value)
  if (categoryIds.length === 0) {
    return { valid: false, categoryIds, error: 'Choose at least one category.' }
  }
  return { valid: true, categoryIds }
}

export function discoveryPreferencePayload(
  userId: string,
  categoryIds: readonly DiscoveryCategoryId[],
  now: Date = new Date(),
) {
  return {
    userId,
    categoryIds: JSON.stringify(normalizeDiscoveryCategoryIds(categoryIds)),
    version: DISCOVERY_PREFERENCE_VERSION,
    onboardingCompleted: 'true',
    updatedAt: now.toISOString(),
  }
}
