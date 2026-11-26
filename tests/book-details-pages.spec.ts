/**
 * The same BookDetailsModal opens from every surface that shows a book.
 * Google Books records are mocked at the browser boundary so each page shows
 * one known book with full metadata.
 */
import type { Page } from '@playwright/test'
import { expect, loadAllTestAccounts, test, users } from 'deepspace/testing'

const RUN_ID = Math.random().toString(36).slice(2, 9)

const DETAIL_BOOK = {
  source: 'google_books',
  sourceId: `universal-modal-test-${RUN_ID}`,
  title: 'The Silent Patient',
  authors: [`Alex Michaelides ${RUN_ID}`],
  description:
    'A complete catalogue description that stays intact in the shared dialog and is never clipped to the card preview.',
  categories: ['Fiction', 'Mystery', 'Thriller'],
  publishedDate: '2019-02-05',
  coverUrl: null,
  averageRating: 4.1,
  ratingsCount: 4821,
  publisher: 'DogEar Press',
  language: 'en',
  pageCount: 336,
  printType: 'BOOK',
  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781250301697' }],
}

const RECOMMENDED = { ...DETAIL_BOOK, reason: 'A mystery in a category you enjoy.' }

async function mockGoogleBooks(page: Page) {
  await page.route('**/api/books/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalItems: 1, books: [DETAIL_BOOK] }),
    })
  })
}

async function mockPersonalShelf(page: Page, books: typeof RECOMMENDED[] = [RECOMMENDED]) {
  await page.route('**/api/books/personal', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply: '', books, basis: 'starter' }),
    })
  })
}

async function expectModal(page: Page) {
  const modal = page.getByTestId('book-details-modal')
  await expect(modal).toBeVisible()
  await expect(page.getByTestId('book-details-title')).toHaveText(DETAIL_BOOK.title)
  await expect(page.getByTestId('book-details-description')).toHaveText(DETAIL_BOOK.description)
  return modal
}

test.describe('book details across discover surfaces', () => {
  test('opens from a Discover shelf and closes without navigation', async ({ page }) => {
    await mockGoogleBooks(page)
    await page.goto('/home')

    const shelf = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Fantasy, Properly Shelved' }),
    })
    await expect(page.getByRole('heading', { name: 'Worth Staying Up For' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Quietly Beautiful' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Beyond the Story' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /freshly\s+shelved/i })).toHaveCount(0)
    await shelf.getByTestId('book-card-details').first().click()
    await expectModal(page)
    expect(page.url()).toContain('/home')
    expect(page.url()).not.toContain('/book')

    await page.getByTestId('book-details-close').click()
    await expect(page.getByTestId('book-details-modal')).toBeHidden()
  })

  test('opens from search results and closes with Escape', async ({ page }) => {
    await mockGoogleBooks(page)
    await page.goto('/home')
    await page.getByRole('searchbox', { name: 'Search books' }).fill('mystery')
    await page.getByRole('button', { name: 'Find books' }).click()

    await page.getByTestId('book-card-details').first().click()
    await expectModal(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('book-details-modal')).toBeHidden()
    await expect(page.getByRole('heading', { name: '“mystery”' })).toBeVisible()
  })
})

const usableTestAccounts = loadAllTestAccounts().length
test.describe('book details across saved and recommended books', () => {
  test.skip(
    usableTestAccounts < 1,
    'Needs 1 test account. Create one with `npx deepspace test accounts create ' +
      '--email <name>@deepspace.test --name "<name>" --password-stdin`.',
  )

  test('opens from For You, updates a shelf, and stays in sync in My Library', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page
    await mockGoogleBooks(page)
    await mockPersonalShelf(page)

    await page.goto('/for-you')
    await expect(page.getByTestId('personal-recommendations')).toBeVisible()
    await page.getByTestId('personal-recommendations').getByTestId('book-card-details').click()
    await expectModal(page)

    await page.getByTestId('book-details-status-read').click()
    await expect(page.getByTestId('book-details-current-status')).toContainText('read shelf')
    await expect(page.getByTestId('book-details-feedback')).toContainText('read shelf')
    await page.getByTestId('book-details-close').click()

    await page.goto('/library')
    await page.getByRole('tab', { name: /^Read/ }).click()
    const savedCard = page
      .getByRole('tabpanel', { name: /^Read/ })
      .getByRole('article')
      .filter({ hasText: DETAIL_BOOK.authors[0] })
    await expect(savedCard.getByRole('heading', { name: DETAIL_BOOK.title })).toBeVisible()
    await savedCard.getByTestId('book-card-details').click()
    await expectModal(page)
    await expect(page.getByTestId('book-details-status-read')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('book-details-close').click()
  })

  test('opens from an AI chat recommendation row', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page
    await mockPersonalShelf(page, [])
    await page.route('**/api/books/recommend', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'A few possibilities from the shelves.',
          books: [RECOMMENDED],
          assistantId: 'asst-universal-modal-test',
        }),
      })
    })

    await page.goto('/for-you')
    await page.getByRole('textbox', { name: 'Tell the AI what you want to read' }).fill(
      'A mystery I can finish in a weekend',
    )
    await page.getByRole('button', { name: 'Ask the AI' }).click()
    await expect(page.getByTestId('chat-book-details')).toBeVisible()
    await page.getByTestId('chat-book-details').click()
    await expectModal(page)
    await page.getByTestId('book-details-close').click()
  })
})
