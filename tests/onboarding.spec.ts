/**
 * First-run category gate and later preference editing.
 *
 * The shared test account may already have saved categories from an earlier
 * run, so the first-run branch is exercised only when it is actually available;
 * the persistence and exact-option assertions always run.
 */
import { expect, loadAllTestAccounts, test, users } from 'deepspace/testing'

const EXPECTED_LABELS = [
  'Contemporary Fiction',
  'Literary Fiction',
  'Fantasy',
  'Science Fiction',
  'Mystery',
  'Thriller',
  'Romance',
  'Horror',
  'Historical Fiction',
  'History',
  'Biography & Memoir',
  'Popular Science',
  'Philosophy',
  'General Nonfiction',
  'Poetry',
  'Short Story Collections',
  'Essay Collections',
]

const usableTestAccounts = loadAllTestAccounts().length

test.describe('Discovery categories', () => {
  test.skip(
    usableTestAccounts < 1,
    'Needs 1 test account. Create one with `npx deepspace test accounts create ' +
      '--email <name>@deepspace.test --name "<name>" --password-stdin`.',
  )

  test('validates a selection and restores it after a reload', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page

    await page.goto('/preferences')
    const options = page.getByTestId('category-option')
    await expect(options).toHaveCount(17, { timeout: 15_000 })
    expect((await options.allInnerTexts()).map((text) => text.trim())).toEqual(EXPECTED_LABELS)
    expect(await page.getByText(/magazine|textbook|study guide/i).count()).toBe(0)

    const save = page.getByTestId('category-continue')
    await expect(save).toBeEnabled({ timeout: 15_000 })

    // Clear the editor completely: an empty selection must never be saved.
    const selected = page.locator('[data-testid="category-option"][aria-pressed="true"]')
    while ((await selected.count()) > 0) await selected.first().click()
    await expect(save).toBeDisabled()
    await expect(page.getByText('Choose at least one category to continue.')).toBeVisible()

    await page.locator('[data-category-id="fantasy"]').click()
    await page.locator('[data-category-id="mystery"]').click()
    await expect(page.locator('[data-category-id="fantasy"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-category-id="mystery"]')).toHaveAttribute('aria-pressed', 'true')
    await save.click()

    await page.reload()
    await expect(page.getByTestId('category-option')).toHaveCount(17)
    await expect(page.locator('[data-category-id="fantasy"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-category-id="mystery"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-category-id="history"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('does not repeat onboarding after preferences are saved', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page

    await page.goto('/onboarding')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // A brand-new reader sees the gate before Swipe Discovery; a returning
    // reader sees the already-set panel instead of the form.
    const firstRun = (await page.getByTestId('category-onboarding').count()) > 0
    if (firstRun) {
      await page.locator('[data-category-id="fantasy"]').click()
      await page.locator('[data-category-id="mystery"]').click()
      await page.getByTestId('category-continue').click()
    }

    await expect(page.getByTestId('category-onboarding')).toHaveCount(0)
    await expect(page.getByText('Your shelves are already set.')).toBeVisible()
    await page.goto('/home')
    await expect(page.getByTestId('swipe-discovery')).toBeVisible()
    await expect(page.getByTestId('category-onboarding')).toHaveCount(0)
  })

  test('Discover does not render the removed shelves', async ({ users }) => {
    const [reader] = await users(1)
    const page = reader.page

    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    if ((await page.getByTestId('category-onboarding').count()) > 0) {
      await page.locator('[data-category-id="fantasy"]').click()
      await page.locator('[data-category-id="mystery"]').click()
      await page.getByTestId('category-continue').click()
    }

    await expect(page.getByTestId('swipe-discovery')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Fantasy, Properly Shelved' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Worth Staying Up For' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Quietly Beautiful' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Beyond the Story' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /freshly\s+shelved/i })).toHaveCount(0)
  })
})
