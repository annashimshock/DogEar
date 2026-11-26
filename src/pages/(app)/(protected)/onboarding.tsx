/**
 * First-run shelf selection. Reached at /onboarding; the protected layout
 * supplies auth and the app layout supplies the record providers.
 */

import { useNavigate } from 'react-router-dom'
import { DiscoveryOnboarding } from '../../../components/onboarding/DiscoveryOnboarding'
import { Button } from '../../../components/ui'
import { useDiscoveryPreferences } from '../../../lib/useDiscoveryPreferences'

export default function OnboardingPage() {
  const navigate = useNavigate()
  const preferences = useDiscoveryPreferences()

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">
          Welcome to DogEar
        </p>
        <h1 className="max-w-3xl font-serif text-[2.4rem] leading-[1.1] tracking-tight sm:text-5xl">
          A good recommendation starts with{' '}
          <span className="italic text-primary">knowing your shelves.</span>
        </h1>

        {preferences.loading ? (
          <div className="mt-10 h-72 animate-pulse rounded-2xl border border-border bg-card" />
        ) : !preferences.needsOnboarding ? (
          <div className="mt-10 rounded-2xl border border-border bg-card p-8">
            <h2 className="font-serif text-2xl text-foreground">Your shelves are already set.</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              You can revisit your categories whenever you like.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/home')}>Back to Discover</Button>
              <Button variant="secondary" onClick={() => navigate('/preferences')}>
                Edit categories
              </Button>
            </div>
          </div>
        ) : (
          <DiscoveryOnboarding className="mt-10" onSaved={() => navigate('/home')} />
        )}
      </div>
    </main>
  )
}
