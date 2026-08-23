import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { NEW_PASSWORD, login } from './helpers'

// Named z-* so it runs LAST (alphabetical, one worker): by then the admin password is
// NEW_PASSWORD and the libraries/clip/command from earlier specs exist, so every page
// is audited with real content in it.

test.describe.configure({ mode: 'serial' })

/** WCAG A/AA audit via axe-core; fails with a readable summary of any violation. */
async function auditCurrentPage(page: import('@playwright/test').Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => String(n.target)).join(' | ')}`,
  )
  expect(summary, `axe violations on ${name}`).toEqual([])
}

test('login page passes the axe WCAG A/AA audit', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await auditCurrentPage(page, '/login')
})

test('library (Browse) passes the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/')
  // Any card will do — with the virtualized grid only the top window is in the DOM.
  await expect(page.locator('button[aria-label^="Open "]').first()).toBeVisible()
  await auditCurrentPage(page, '/')
})

test('watch page passes the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await expect(page).not.toHaveURL(/\/login/) // session settled before using page.request
  // The ocean card sits deep in the (virtualized) list now — resolve its id and go direct.
  const list = await (await page.request.get('/api/media?q=ocean')).json()
  await page.goto(`/watch/${list.data[0].id}`)
  await expect(page.locator('video').first()).toBeVisible()
  await auditCurrentPage(page, '/watch/:id')
})

test('clips page passes the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/clips')
  await expect(page.getByTitle('Ocean moment')).toBeVisible()
  await auditCurrentPage(page, '/clips')
})

test('commands page passes the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/commands')
  await expect(page.getByText('Echo greeting').first()).toBeVisible()
  await auditCurrentPage(page, '/commands')
})

test('admin settings pages pass the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  for (const path of ['/settings/repositories', '/settings/branding', '/settings/commands', '/settings/system']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await auditCurrentPage(page, path)
  }
})
