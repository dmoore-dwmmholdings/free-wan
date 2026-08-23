import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { NEW_PASSWORD, login } from './helpers'

// Runs after settings.spec.ts, before z-a11y.spec.ts. Proves the virtualized Browse grid:
// infinite scroll loads ALL pages of a 120-item library, while the number of MOUNTED cards
// stays bounded (only visible rows + overscan are in the DOM).
const bulkDir = join(dirname(fileURLToPath(import.meta.url)), '.media', 'Bulk')

test('a 120-item library fully loads on scroll with a bounded card DOM', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, NEW_PASSWORD)
  await expect(page).not.toHaveURL(/\/login/)

  const create = await page.request.post('/api/admin/repositories', {
    data: { name: 'E2E Bulk', rootPath: bulkDir, type: 'image' },
  })
  expect(create.status()).toBe(201)
  const repo = await create.json()
  expect((await page.request.post(`/api/admin/repositories/${repo.id}/scan`, { data: {} })).status()).toBe(202)
  await expect
    .poll(async () => (await (await page.request.get(`/api/admin/repositories/${repo.id}/scan`)).json()).status, {
      timeout: 60_000,
    })
    .toBe('succeeded')

  await page.goto('/')
  await expect(page.getByText(/12[0-9] items|1[0-9][0-9] items/)).toBeVisible()

  // Scroll until every page has loaded: neither the "Load more" fallback nor the
  // "Loading more…" indicator remains once hasNextPage is exhausted.
  // Note: title derivation turns underscores into spaces → "bulk 001" … "bulk 120".
  const cards = page.locator('button[aria-label^="Open bulk "]')
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(400)
        return (
          (await page.getByRole('button', { name: 'Load more' }).count()) +
          (await page.getByText('Loading more…').count())
        )
      },
      { timeout: 30_000 },
    )
    .toBe(0)

  // All items are reachable: at the very bottom the last item (added:desc → bulk_001
  // sorts last) gets mounted by the virtualizer…
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.getByRole('button', { name: 'Open bulk 001' })).toBeVisible()
  // …but the DOM only holds the visible window of cards, not the whole library.
  const mounted = await cards.count()
  expect(mounted).toBeGreaterThan(0)
  expect(mounted).toBeLessThan(80)
})
