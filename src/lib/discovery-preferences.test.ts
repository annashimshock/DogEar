import { describe, expect, it } from 'vitest'
import { DEFAULT_DISCOVERY_CATEGORY_IDS } from './discovery-categories'
import {
  discoveryPreferencePayload,
  readDiscoveryPreferenceState,
  validateDiscoverySelection,
  type DiscoveryPreferenceRecord,
} from './discovery-preferences'

function row(
  data: Partial<DiscoveryPreferenceRecord['data']> = {},
  recordId = 'pref-1',
): DiscoveryPreferenceRecord {
  return {
    recordId,
    data: {
      userId: 'reader-1',
      categoryIds: '["fantasy","mystery"]',
      version: 1,
      onboardingCompleted: 'true',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...data,
    },
  }
}

describe('discovery preference state', () => {
  it('accepts multiple categories and rejects an empty selection', () => {
    const multiple = validateDiscoverySelection(['fantasy', 'history', 'poetry'])
    expect(multiple.valid).toBe(true)
    expect(multiple.categoryIds).toEqual(['fantasy', 'history', 'poetry'])

    const empty = validateDiscoverySelection([])
    expect(empty.valid).toBe(false)
    expect(empty.error).toMatch(/at least one/i)

    expect(validateDiscoverySelection(['fantasy', 'fantasy', 'not-a-category']).categoryIds).toEqual([
      'fantasy',
    ])
  })

  it('persists validated ids, version and completion through the record payload', () => {
    const now = new Date('2026-02-03T04:05:06.000Z')
    expect(discoveryPreferencePayload('reader-1', ['fantasy', 'mystery'], now)).toEqual({
      userId: 'reader-1',
      categoryIds: '["fantasy","mystery"]',
      version: 1,
      onboardingCompleted: 'true',
      updatedAt: '2026-02-03T04:05:06.000Z',
    })
  })

  it('restores saved categories on a later session and does not re-show onboarding', () => {
    const state = readDiscoveryPreferenceState([row()], { signedIn: true })
    expect(state.categoryIds).toEqual(['fantasy', 'mystery'])
    expect(state.effectiveCategoryIds).toEqual(['fantasy', 'mystery'])
    expect(state.onboardingCompleted).toBe(true)
    expect(state.needsOnboarding).toBe(false)
    expect(state.version).toBe(1)
  })

  it('asks first-time signed-in readers for categories and keeps them unblocked afterwards', () => {
    const firstVisit = readDiscoveryPreferenceState([], { signedIn: true })
    expect(firstVisit.categoryIds).toEqual([])
    expect(firstVisit.effectiveCategoryIds).toEqual(DEFAULT_DISCOVERY_CATEGORY_IDS)
    expect(firstVisit.needsOnboarding).toBe(true)

    const justSaved = readDiscoveryPreferenceState([], {
      signedIn: true,
      justSaved: ['fantasy', 'mystery'],
    })
    expect(justSaved.needsOnboarding).toBe(false)
    expect(justSaved.categoryIds).toEqual(['fantasy', 'mystery'])
    expect(justSaved.onboardingCompleted).toBe(true)
  })

  it('does not gate signed-out readers or existing readers with legacy rows', () => {
    expect(readDiscoveryPreferenceState([], { signedIn: false }).needsOnboarding).toBe(false)

    const legacy = readDiscoveryPreferenceState(
      [row({ categoryIds: '', onboardingCompleted: 'false' })],
      { signedIn: true },
    )
    expect(legacy.needsOnboarding).toBe(true)
    expect(legacy.effectiveCategoryIds).toEqual(DEFAULT_DISCOVERY_CATEGORY_IDS)

    const completedWithoutCategories = readDiscoveryPreferenceState(
      [row({ categoryIds: '', onboardingCompleted: 'true' })],
      { signedIn: true },
    )
    expect(completedWithoutCategories.needsOnboarding).toBe(false)
    expect(completedWithoutCategories.effectiveCategoryIds).toEqual(DEFAULT_DISCOVERY_CATEGORY_IDS)
  })

  it('reads comma-separated legacy rows and ignores unknown ids', () => {
    const state = readDiscoveryPreferenceState(
      [row({ categoryIds: 'fantasy,unknown,mystery' })],
      { signedIn: true },
    )
    expect(state.categoryIds).toEqual(['fantasy', 'mystery'])
  })
})
