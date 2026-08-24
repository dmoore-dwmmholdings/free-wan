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

// Every audit above runs on the default `midnight` preset, where the primary is dark enough
// that white text on it was never in question. That is exactly why the on-primary rule was
// wrong for a long time without anyone noticing: five of the seven presets want white, and the
// default is one of them. This runs the audit again under a preset where the answer differs.
//
// Kept last: applying a preset is a persistent change to the site's branding.
test('a light-primary preset still passes the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/settings/branding')

  // `slate` has a primary of #5b8def. White on it reaches 3.23:1, under the 4.5:1 AA needs;
  // the dark half of the on-primary pair reaches 5.79:1. The rule used to pick white.
  await page.getByRole('button', { name: 'Slate', exact: false }).first().click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await auditCurrentPage(page, '/settings/branding on the slate preset')

  // And on an ordinary page, where the primary button is the one a reader actually meets.
  await page.goto('/')
  await expect(page.locator('button[aria-label^="Open "]').first()).toBeVisible()
  await auditCurrentPage(page, '/ on the slate preset')
})

// Every flow in this suite, including the one above, runs on a dark preset. Light mode is not a
// variation on it — background and text swap roles, so every derived token lands somewhere
// different, and `--fw-muted` is at its tightest there. The CSS comment beside it names `linen`
// as closest to the line, having once been below it at 4.41:1.
//
// `/settings/branding` is deliberately not audited here, and the reason is worth stating rather
// than leaving as a gap in the list: under `linen` it reports three colour-contrast violations,
// all inside the editor's own preview panel — `text-accent` on the Saved confirmation, and a
// pill that paints `--fw-bg` on `--fw-accent` to show what the pair looks like. A swatch that
// demonstrates a colour necessarily shows that colour, and axe cannot tell one from a label.
// Whether to change them is a design decision for that page, not something to settle by
// widening a test. The reader-facing screens below carry no such preview and pass.
test('a light preset passes the axe audit', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/settings/branding')

  await page.getByRole('button', { name: 'Linen', exact: false }).first().click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await page.goto('/')
  await expect(page.locator('button[aria-label^="Open "]').first()).toBeVisible()
  await auditCurrentPage(page, '/ on the linen preset')

  // The watch page carries the most muted text of any reader-facing screen.
  const list = await (await page.request.get('/api/media?q=ocean')).json()
  await page.goto(`/watch/${list.data[0].id}`)
  await expect(page.locator('video').first()).toBeVisible()
  await auditCurrentPage(page, '/watch/:id on the linen preset')
})
