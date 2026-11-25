/**
 * Book details modal — opened from a swipe card, never a route change.
 *
 * The Google Books route is mocked with one known record so the assertions
 * describe the modal, not whichever books are trending that day.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const FULL_DESCRIPTION =
  'A complete catalogue description that keeps going well past the three lines shown on the swipe card. ' +
  'It follows an archivist through forgotten letters, a rain-soaked coastal town, and the quiet decisions ' +
  'that turn a stack of paper into a family history.'

const DETAIL_BOOK = {
  source: 'google_books',
  sourceId: 'book-details-test-work',
  title: 'The Silent Patient',
  authors: ['Alex Michaelides'],
  description: FULL_DESCRIPTION,
  categories: ['Fiction', ' Literary Fiction', 'Book Club'],
  publishedDate: '2024-05-18',
  coverUrl: null,
  averageRating: 4.6,
  ratingsCount: 321,
  publisher: 'DogEar Press',
  language: 'en',
  pageCount: 344,
}

async function mockSwipeBook(page: Page) {
  await page.route('**/api/books/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalItems: 1, books: [DETAIL_BOOK] }),
    })
  })
  await page.goto('/home')
  await expect(page.getByTestId('swipe-card')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('swipe-card')).toContainText(DETAIL_BOOK.title)
}

async function openDetails(page: Page) {
  await page.getByTestId('book-details-open').click()
  await expect(page.getByTestId('book-details-modal')).toBeVisible()
}

test.describe('book details modal', () => {
  test('opens from the card, shows the full Google Books record, and closes', async ({ page }) => {
    await mockSwipeBook(page)
    await openDetails(page)

    const modal = page.getByTestId('book-details-modal')
    await expect(page.getByTestId('book-details-title')).toHaveText(DETAIL_BOOK.title)
    await expect(page.getByTestId('book-details-authors')).toHaveText('Alex Michaelides')
    await expect(page.getByTestId('book-details-description')).toHaveText(FULL_DESCRIPTION)
    await expect(page.getByTestId('book-details-metadata')).toContainText('DogEar Press')
    await expect(page.getByTestId('book-details-metadata')).toContainText('344')
    await expect(page.getByTestId('book-details-metadata')).toContainText('Fiction')
    await expect(page.getByTestId('book-details-published')).toHaveText('May 18, 2024')
    await expect(page.getByTestId('book-details-rating')).toContainText('4.6')
    await expect(page.getByTestId('book-details-rating')).toContainText('321 ratings')
    expect(page.url()).not.toContain('/book')

    await page.getByTestId('book-details-close').click()
    await expect(modal).toBeHidden()
    await expect(page.getByTestId('swipe-card')).toBeVisible()
  })

  test('closes on backdrop click and on Escape', async ({ page }) => {
    await mockSwipeBook(page)
    await openDetails(page)

    await page.mouse.click(4, 4)
    await expect(page.getByTestId('book-details-modal')).toBeHidden()

    await openDetails(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('book-details-modal')).toBeHidden()
  })

  test('a short drag on the card does not open the modal', async ({ page }) => {
    await mockSwipeBook(page)
    const card = page.getByTestId('swipe-card')
    const box = await card.boundingBox()
    expect(box).not.toBeNull()

    const startX = box!.x + box!.width / 2
    const startY = box!.y + box!.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 40, startY, { steps: 4 })
    await page.mouse.up()

    await expect(page.getByTestId('book-details-modal')).toHaveCount(0)
    await expect(card).toContainText(DETAIL_BOOK.title)
  })

  test('clicking inside the modal neither closes it nor advances the swipe', async ({ page }) => {
    await mockSwipeBook(page)
    await openDetails(page)

    await page.getByTestId('book-details-description').click()
    await expect(page.getByTestId('book-details-modal')).toBeVisible()

    await page.getByTestId('book-details-close').click()
    await expect(page.getByTestId('swipe-card')).toContainText(DETAIL_BOOK.title)
    await expect(page.getByText('1 of 1', { exact: true })).toBeVisible()
    await expect(page.getByTestId('swipe-like')).toBeVisible()
  })
})

const usableTestAccounts = loadAllTestAccounts().length
test.describe('book details library actions', () => {
  test.skip(
    usableTestAccounts < 1,
    'Needs 1 test account. Create one with `npx deepspace test accounts create ' +
      '--email <name>@deepspace.test --name "<name>" --password-stdin`.',
  )

  test('saves, updates, and remembers all three shelf statuses', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page
    await mockSwipeBook(page)
    await openDetails(page)

    const want = page.getByTestId('book-details-status-want')
    const reading = page.getByTestId('book-details-status-reading')
    const read = page.getByTestId('book-details-status-read')

    await want.click()
    await expect(want).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('book-details-current-status')).toContainText('want to read')
    await expect(page.getByTestId('book-details-feedback')).toContainText('want to read shelf')

    await reading.click()
    await expect(reading).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('book-details-current-status')).toContainText('currently reading')
    await expect(page.getByTestId('book-details-feedback')).toContainText('currently reading shelf')

    await read.click()
    await expect(read).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('book-details-current-status')).toContainText('read shelf')
    await expect(page.getByTestId('book-details-feedback')).toContainText('read shelf')
    await expect(want).toHaveAttribute('aria-pressed', 'false')

    // The library is already correct without a reload or a fresh visit.
    await page.getByTestId('book-details-close').click()
    await openDetails(page)
    await expect(page.getByTestId('book-details-status-read')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('book-details-close').click()
    await page.getByRole('link', { name: /My Library/i }).click()
    await page.getByRole('tab', { name: /^Read/ }).click()
    await expect(
      page.getByRole('tabpanel', { name: /^Read/ }).getByRole('heading', { name: DETAIL_BOOK.title }),
    ).toBeVisible()
  })
})
