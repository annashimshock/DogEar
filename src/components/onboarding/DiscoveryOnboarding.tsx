/**
 * Category choice shared by first-run onboarding and later preference editing.
 * The cards are data-driven from the central category catalogue, so the app
 * never offers magazines, journals, textbooks or study material as a taste.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, cn, useToast } from '@/components/ui'
import {
  DISCOVERY_CATEGORIES,
  DISCOVERY_GROUPS,
  type DiscoveryCategoryId,
  type DiscoveryGroup,
} from '../../lib/discovery-categories'
import { validateDiscoverySelection } from '../../lib/discovery-preferences'
import { useDiscoveryPreferences } from '../../lib/useDiscoveryPreferences'

export interface DiscoveryOnboardingProps {
  mode?: 'onboarding' | 'editing'
  onSaved?: () => void
  className?: string
}

const GROUP_COPY: Record<DiscoveryGroup, string> = {
  FICTION: 'Stories, imagined worlds and everything in between.',
  NONFICTION: 'True stories, big ideas and a little real-world wonder.',
  OTHER: 'Small forms, collected with care.',
}

export function DiscoveryOnboarding({
  mode = 'onboarding',
  onSaved,
  className,
}: DiscoveryOnboardingProps) {
  const preferences = useDiscoveryPreferences()
  const { success, error: notifyError } = useToast()
  const [selected, setSelected] = useState<readonly DiscoveryCategoryId[]>(
    mode === 'editing' ? preferences.effectiveCategoryIds : [],
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (mode === 'editing') setSelected(preferences.effectiveCategoryIds)
    // The saved ids only seed this editor once; afterwards local choice wins.
  }, [mode, preferences.categoryIds.join('|')])

  const grouped = useMemo(
    () =>
      DISCOVERY_GROUPS.map((group) => ({
        group,
        categories: DISCOVERY_CATEGORIES.filter((category) => category.group === group),
      })),
    [],
  )

  function toggle(id: DiscoveryCategoryId) {
    setMessage('')
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  async function save() {
    const validation = validateDiscoverySelection(selected)
    if (!validation.valid) {
      setMessage(validation.error ?? 'Choose at least one shelf so we know where to begin.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await preferences.savePreferences(validation.categoryIds)
      success(mode === 'editing' ? 'Your shelves have been updated.' : 'Your shelves are ready.')
      onSaved?.()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'We could not save your shelves.'
      setMessage(text)
      notifyError(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid="category-onboarding"
      className={cn(
        'rounded-2xl border border-border bg-card p-6 shadow-[0_18px_40px_-28px_rgba(40,41,35,0.35)] sm:p-9',
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-sage">
        {mode === 'editing' ? 'Your reading tastes' : 'Before we shelve your first book'}
      </p>
      <h2 className="mt-3 font-serif text-3xl leading-tight text-foreground sm:text-4xl">
        {mode === 'editing' ? 'Set your shelves again' : 'What are you in the mood to read?'}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Pick the shelves you would like us to reach for first. Choose as many as you like — we
        will use them to shape your swipe deck, your For You shelf and the bookseller&apos;s
        suggestions. You can change them any time.
      </p>

      <div className="mt-8 space-y-8">
        {grouped.map(({ group, categories }) => (
          <div key={group}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                {group}
              </h3>
              <p className="text-xs text-muted-foreground">{GROUP_COPY[group]}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => {
                const active = selected.includes(category.id)
                return (
                  <button
                    key={category.id}
                    type="button"
                    data-testid="category-option"
                    data-category-id={category.id}
                    aria-pressed={active}
                    onClick={() => toggle(category.id)}
                    className={cn(
                      'flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground shadow-sm'
                        : 'border-border bg-background/60 text-muted-foreground hover:border-primary/60 hover:text-foreground',
                    )}
                  >
                    <span className={cn('font-medium', active && 'text-foreground')}>
                      {category.label}
                    </span>
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border',
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                      aria-hidden
                    >
                      {active && <Check className="size-3" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border pt-6">
        <Button
          type="button"
          data-testid="category-continue"
          onClick={() => void save()}
          loading={saving}
          disabled={!preferences.canWrite || (saving === false && selected.length === 0)}
          className="rounded-full bg-primary px-7 text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary/90"
        >
          {mode === 'editing' ? 'Save my shelves' : 'Start browsing'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {selected.length === 0
            ? 'Choose at least one category to continue.'
            : `${selected.length} ${selected.length === 1 ? 'shelf' : 'shelves'} selected`}
        </p>
        {message && (
          <p role="alert" data-testid="category-error" className="w-full text-xs text-destructive">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
