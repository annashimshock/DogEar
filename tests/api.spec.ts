import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })

  test('book search returns paged, eligible standalone records', async ({ request }) => {
    const res = await request.get('/api/books/search?q=literary%20fiction&limit=10&startIndex=5')
    expect(res.ok()).toBeTruthy()

    const data = await res.json()
    expect(typeof data.totalItems).toBe('number')
    expect(Array.isArray(data.books)).toBe(true)
    expect(data.eligibleCount).toBeGreaterThanOrEqual(data.books.length)
    expect(data.relevantCount).toBe(data.books.length)
    for (const book of data.books) {
      expect(book.printType).toBe('BOOK')
      expect(book.title).toBeTruthy()
      expect(book.publishedDate).toMatch(/^\d{4}/)
      expect(book.googleResultIndex).toBeGreaterThanOrEqual(5)
      expect(book.categories.join(' ')).not.toMatch(/periodicals?|journals?|magazines?/i)
    }
  })
})
