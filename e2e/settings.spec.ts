import { test, expect } from '@playwright/test'
import { NEW_PASSWORD, login } from './helpers'

// Runs after core.spec.ts and media.spec.ts (alphabetical, one worker): the admin
// password is already NEW_PASSWORD. Covers the two remaining browser-unverified
// surfaces — the branding editor and the commands UI.

test.describe.configure({ mode: 'serial' })

test('branding editor renames the site and it applies live', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/settings/branding')

  await page.getByLabel('Site name').fill('E2E Cinema')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  // ThemeProvider picks the change up and retitles the document.
  await expect(page).toHaveTitle('E2E Cinema')
  // The public API and the PWA manifest both reflect it.
  expect((await (await page.request.get('/api/branding')).json()).siteName).toBe('E2E Cinema')
  expect((await (await page.request.get('/api/manifest.webmanifest')).json()).name).toBe('E2E Cinema')
})

test('admin creates a command in the editor and a user-facing run shows live output', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/settings/commands')

  await page.getByRole('button', { name: 'New command' }).click()
  await page.getByLabel('Name').fill('Echo greeting')
  await page.getByLabel('Executable').selectOption('node')
  await page.getByLabel('Argument template (JSON)').fill('["-e", "console.log(\'e2e-hello\')"]')
  await page.getByRole('button', { name: 'Create command' }).click()

  // Modal closes; the command is listed.
  await expect(page.getByText('Echo greeting')).toBeVisible()

  await page.goto('/commands')
  // Built-in maintenance commands are listed too — select ours before running.
  await page.getByRole('button', { name: /Echo greeting/ }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()

  // The sandboxed spawn streams output back into the run console.
  await expect(page.getByText('e2e-hello')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('succeeded')).toBeVisible({ timeout: 15_000 })
})
