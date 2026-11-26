/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 */

import { useEffect } from 'react'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function Landing() {
  useEffect(() => {
    window.location.replace('/home')
  }, [])

  return (
    <>
      <Seo {...seo} path="/" />
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="text-muted-foreground">
          Opening DogEar...
        </p>
        <a
          href="/home"
          className="mt-3 text-primary underline"
        >
          Continue to DogEar
        </a>
      </main>
    </>
  )
}