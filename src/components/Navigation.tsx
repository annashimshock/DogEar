/**
 * Bookstore navigation.
 *
 * Links come from `nav.ts` (with role/dev filtering), and every data-testid
 * from the scaffold stays intact — the shipped tests rely on them:
 * `app-navigation`, `nav-sign-in-button`, `nav-user-name`, `nav-user-email`.
 * The wordmark is a small dog-eared page, drawn inline so it inherits ink.
 */

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, signOut } from 'deepspace'
import { ChevronDown, LogOut, Menu, Settings, X } from 'lucide-react'
import { APP_NAME } from '../constants'
import type { Role } from '../constants'
import { nav } from '../nav'
import { cn } from '../lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'

function DogEarMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 3.5h10L20 8.5v12H5z" />
      <path d="M15 3.5v5h5" />
      <path d="M8.5 12.5h6" className="text-sage" />
      <path d="M8.5 16h4" className="text-sage" />
    </svg>
  )
}

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const profileReady = !isSignedIn || (!userLoading && !!user)
  const userRole = (user?.role ?? 'anonymous') as Role | 'anonymous'

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const visibleNav = nav.filter((item) => {
    if (item.devOnly && !import.meta.env.DEV) return false
    if (!item.roles) return true
    if (!profileReady) return false
    if (userRole === 'admin') return true
    return item.roles.includes(userRole as Role)
  })

  const navLink = (item: (typeof nav)[number]) => {
    const active = location.pathname.startsWith(item.path)
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative py-2 text-[12px] font-medium uppercase tracking-[0.16em] transition-colors',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-primary',
        )}
      >
        {item.label}
        <span
          className={cn(
            'absolute -bottom-0.5 left-0 h-px w-full origin-left bg-primary transition-transform duration-300',
            active ? 'scale-x-100' : 'scale-x-0',
          )}
        />
      </Link>
    )
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-sm">
        <nav
          data-testid="app-navigation"
          aria-label="Main navigation"
          className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-5 sm:px-8"
        >
          <Link to="/home" className="flex shrink-0 items-center gap-2.5">
            <DogEarMark />
            <span className="font-serif text-xl font-semibold tracking-tight text-foreground">
              {APP_NAME}
            </span>
          </Link>

          <div className="hidden flex-1 items-center justify-center gap-8 md:flex">
            {visibleNav.map(navLink)}
          </div>

          <div className="flex-1 md:hidden" />

          <div className="flex shrink-0 items-center gap-3">
            {!isLoaded ? null : isSignedIn && !profileReady ? (
              <div className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3">
                <div className="size-6 animate-pulse rounded-full bg-muted" />
                <div className="hidden h-3 w-16 animate-pulse rounded bg-muted sm:block" />
              </div>
            ) : isSignedIn && user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      aria-label="Account menu"
                      className="group flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-2.5 text-sm transition-colors hover:border-primary/50"
                    >
                      <Avatar className="size-6 ring-1 ring-inset ring-border">
                        <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                        <AvatarFallback className="text-[11px]">
                          {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        data-testid="nav-user-name"
                        className="hidden max-w-[130px] truncate text-foreground sm:inline"
                      >
                        {user.name || user.email}
                      </span>
                      <ChevronDown
                        className="size-3.5 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180"
                        aria-hidden
                      />
                    </button>
                  }
                />
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="truncate font-medium text-foreground">
                      {user.name || 'Signed in'}
                    </div>
                    <div
                      data-testid="nav-user-email"
                      className="truncate text-xs font-normal text-muted-foreground"
                    >
                      {user.email}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings aria-hidden />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => signOut()}>
                    <LogOut aria-hidden />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                data-testid="nav-sign-in-button"
                onClick={() => setShowAuthModal(true)}
                className="rounded-full bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-opacity hover:opacity-90"
              >
                Sign in
              </button>
            )}

            <button
              className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-foreground md:hidden"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </nav>

        {mobileMenuOpen && (
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 md:hidden">
            {visibleNav.map(navLink)}
          </div>
        )}
      </header>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </>
  )
}
