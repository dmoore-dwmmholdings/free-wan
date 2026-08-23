import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BOOTSTRAP_PASSWORD, NEW_PASSWORD, login } from './helpers'

const mediaDir = join(dirname(fileURLToPath(import.meta.url)), '.media', 'Photos')

// The flows build on each other (bootstrap password → changed password → library added),
// so run them in order in one worker.
test.describe.configure({ mode: 'serial' })

test('redirects an unauthenticated visitor to the login screen', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('bootstrap login forces a password change, then lands in the app', async ({ page }) => {
  await login(page, BOOTSTRAP_PASSWORD)
  await expect(page).toHaveURL(/\/change-password/)
  await expect(page.getByText('Set a new password to continue')).toBeVisible()

  await page.getByLabel('Current password').fill(BOOTSTRAP_PASSWORD)
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Update password' }).click()

  // Lands on the library, authenticated.
  await expect(page).not.toHaveURL(/\/(login|change-password)/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})

test('the old bootstrap password no longer works', async ({ page }) => {
  await login(page, BOOTSTRAP_PASSWORD)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText(/invalid|failed|incorrect/i)).toBeVisible()
})

test('admin adds a library, scans it, and the item appears in Browse', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/settings/repositories')

  await page.getByLabel('Name').fill('E2E Photos')
  await page.getByLabel('Folder path').fill(mediaDir)
  await page.getByLabel('Type').selectOption('image')
  await page.getByRole('button', { name: 'Add repository' }).click()
  await expect(page.getByText('E2E Photos')).toBeVisible()

  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  // The repo list repolls every 5s; the single-file scan finishes well within the timeout.
  await expect(page.getByText(/online/i).first()).toBeVisible({ timeout: 20_000 })

  await page.goto('/')
  await expect(page.getByTitle('red')).toBeVisible({ timeout: 10_000 })
})

test('serves the branded PWA manifest', async ({ page }) => {
  const res = await page.request.get('/api/manifest.webmanifest')
  expect(res.ok()).toBe(true)
  const manifest = await res.json()
  expect(manifest.name).toBe('FreeWAN')
  expect(manifest.icons.length).toBeGreaterThanOrEqual(1)
})
