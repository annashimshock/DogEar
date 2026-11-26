/** Editable reading categories, linked from Settings. */

import { useDiscoveryPreferences } from '../../../lib/useDiscoveryPreferences'
import { DiscoveryOnboarding } from '../../../components/onboarding/DiscoveryOnboarding'

export default function PreferencesPage() {
  const preferences = useDiscoveryPreferences()

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">
          Your account
        </p>
        <h1 className="font-serif text-[2.4rem] leading-[1.1] tracking-tight sm:text-5xl">
          Reading preferences
        </h1>
        {preferences.loading ? (
          <div className="mt-10 h-72 animate-pulse rounded-2xl border border-border bg-card" />
        ) : (
          <DiscoveryOnboarding mode="editing" className="mt-10" />
        )}
      </div>
    </main>
  )
}
