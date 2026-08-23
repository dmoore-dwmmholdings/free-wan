import type { Page } from '@playwright/test'

// The bootstrap password comes from ADMIN_PASSWORD in playwright.config.ts; the first spec
// (core.spec.ts) changes it to NEW_PASSWORD, which every later flow signs in with. The spec
// files build on each other and run in order on the one worker.
export const BOOTSTRAP_PASSWORD = 'e2e-admin-pass-1'
export const NEW_PASSWORD = 'e2e-new-pass-22'

export async function login(page: Page, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
