/**
 * Personalization data flow: swipes persist, For You sends the current profile,
 * and chat requests remain separate from the general reading profile.
 */
import type { Page } from '@playwright/test'
import { expect, loadAllTestAccounts, test, users } from 'deepspace/testing'

// Unique titles keep the swipe queue fresh even when a test account already
// has earlier swipes from a previous run.
const RUN_ID = Math.random().toString(36).slice(2, 9)

const LIKED_CANDIDATE = {
  source: 'google_books',
  sourceId: `silent-patient-personal-${RUN_ID}`,
  // Curated titles must match the front-table query targets; a unique author
  // keeps each run from colliding with earlier swipes on the same account.
  title: 'The Silent Patient',
  authors: [`Alex Michaelides ${RUN_ID}`],
  description: 'A catalogue description from Google Books.',
  categories: ['Fiction', 'Mystery', 'Thriller'],
  publishedDate: '2019-02-05',
  coverUrl: null,
  averageRating: 4.1,
  ratingsCount: 4821,
  publisher: 'DogEar Press',
  language: 'en',
  pageCount: 336,
}

const PASSED_CANDIDATE = {
  ...LIKED_CANDIDATE,
  sourceId: `project-hail-mary-personal-${RUN_ID}`,
  title: 'Project Hail Mary',
  authors: [`Andy Weir ${RUN_ID}`],
  categories: ['Fiction', 'Science Fiction'],
}

const HISTORY_BOOK = {
  ...LIKED_CANDIDATE,
  sourceId: `coastlines-history-${RUN_ID}`,
  title: `A History of Coastlines ${RUN_ID}`,
  authors: ['Nolan Reed'],
  description: 'A nonfiction history record from Google Books.',
  categories: ['History'],
}

interface PreferenceBody {
  message?: string
  preferences?: {
    liked?: string[]
    passed?: string[]
    saved?: { title: string; status: string }[]
    excludedIds?: string[]
  }
}

async function mockSwipeCandidates(page: Page) {
  await page.route('**/api/books/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalItems: 2,
        books: [LIKED_CANDIDATE, PASSED_CANDIDATE],
      }),
    })
  })
}

const usableTestAccounts = loadAllTestAccounts().length
test.describe('For You personalization', () => {
  test.skip(
    usableTestAccounts < 1,
    'Needs 1 test account. Create one with `npx deepspace test accounts create ' +
      '--email <name>@deepspace.test --name "<name>" --password-stdin`.',
  )

  test('swipe likes and passes reach For You as current preference signals', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page
    await mockSwipeCandidates(page)

    let personalBody: PreferenceBody | undefined
    await page.route('**/api/books/personal', async (route) => {
      personalBody = route.request().postDataJSON() as PreferenceBody
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: '',
          books: [{ ...LIKED_CANDIDATE, reason: 'A mystery from the fiction shelves.' }],
          basis: 'personal',
        }),
      })
    })

    await page.goto('/home')
    const card = page.getByTestId('swipe-card')
    await expect(card).toBeVisible()
    const likedTitle = await card.locator('h3').innerText()
    await page.getByTestId('swipe-like').click()
    await expect(page.getByText('2 of 2', { exact: true })).toBeVisible()
    const passedTitle = await card.locator('h3').innerText()
    await page.getByTestId('swipe-pass').click()

    await page.goto('/for-you')
    await expect(page.getByTestId('personal-recommendations')).toBeVisible()
    await expect(page.getByTestId('personal-recommendations').getByRole('heading').first()).toBeVisible()
    await expect.poll(() => personalBody).toBeDefined()
    expect(personalBody?.preferences?.liked).toContain(likedTitle)
    expect(personalBody?.preferences?.passed).toContain(passedTitle)
    expect(personalBody?.preferences?.excludedIds?.length).toBeGreaterThan(0)
  })

  test('an explicit history request stays relevant and grounded in real records', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page
    await mockPersonalShelfWithNoBooks(page)

    let recommendBody: PreferenceBody | undefined
    await page.route('**/api/books/recommend', async (route) => {
      recommendBody = route.request().postDataJSON() as PreferenceBody
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Here is a history pick from the shelves.',
          books: [{ ...HISTORY_BOOK, reason: 'A History of Coastlines is a history title.' }],
          assistantId: 'asst-history-flow',
        }),
      })
    })

    await page.goto('/for-you')
    await page
      .getByRole('textbox', { name: 'Tell the bookseller what you want to read' })
      .fill('I want a nonfiction history book about coastlines')
    await page.getByRole('button', { name: 'Ask the bookseller' }).click()

    await expect(page.getByTestId('chat-recommendations')).toContainText(HISTORY_BOOK.title)
    await expect(page.getByTestId('chat-recommendations')).toContainText('Nolan Reed')
    expect(recommendBody?.message).toContain('history')
    expect(recommendBody?.preferences).toBeDefined()
  })
})

async function mockPersonalShelfWithNoBooks(page: Page) {
  await page.route('**/api/books/personal', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply: '', books: [], basis: 'starter' }),
    })
  })
}
