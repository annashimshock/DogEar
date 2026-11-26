/**
 * Example gated page. Reached at /settings — no auth logic lives here
 * because (protected)/_layout.tsx already wraps the subtree in <AuthGate>.
 */

import { useNavigate } from 'react-router-dom'
import { signOut, useUser } from 'deepspace'
import { Button } from '@/components/ui'

export default function SettingsPage() {
  const { user } = useUser()
  const navigate = useNavigate()

  return (
    // No background on page wrappers — pages render into whatever the app's
    // (app)/_layout provides (a plain background, or a raised panel), so they
    // stay transparent and inherit it.
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="mb-12 text-4xl font-bold tracking-tight">Settings</h1>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Your account</h2>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <div className="mt-6 border-t border-border pt-6">
            <h3 className="font-serif text-lg text-foreground">Reading shelves</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose the categories DogEar reaches for first in swipe discovery, For You and the
              bookseller&apos;s suggestions.
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => navigate('/preferences')}>
              Edit reading preferences
            </Button>
          </div>

          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>
      </div>
    </div>
  )
}
