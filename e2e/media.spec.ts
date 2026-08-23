import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { NEW_PASSWORD, login } from './helpers'

// Runs after core.spec.ts (alphabetical, one worker): the admin password is already
// NEW_PASSWORD and the photo library from the core flow is still indexed.
const videosDir = join(dirname(fileURLToPath(import.meta.url)), '.media', 'Videos')

test.describe.configure({ mode: 'serial' })

let videoId: string

test('a video library scans and its item is browsable', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await expect(page).not.toHaveURL(/\/login/)

  // Set up through the API with the browser session — the add-library UI is covered by
  // core.spec.ts; these flows are about playback.
  const create = await page.request.post('/api/admin/repositories', {
    data: { name: 'E2E Videos', rootPath: videosDir, type: 'video' },
  })
  expect(create.status()).toBe(201)
  const repo = await create.json()
  expect((await page.request.post(`/api/admin/repositories/${repo.id}/scan`, { data: {} })).status()).toBe(202)
  await expect
    .poll(async () => (await (await page.request.get(`/api/admin/repositories/${repo.id}/scan`)).json()).status, {
      timeout: 20_000,
    })
    .toBe('succeeded')

  const list = await (await page.request.get('/api/media?q=ocean')).json()
  expect(list.data).toHaveLength(1)
  videoId = list.data[0].id

  await page.goto('/')
  await expect(page.getByTitle('ocean')).toBeVisible()
})

test('the watch page direct-plays the video', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto(`/watch/${videoId}`)
  const video = page.locator('video').first()
  await expect(video).toBeVisible()
  // Time actually advancing proves playback, not just element presence.
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
    .toBeGreaterThan(0.5)
})

test('a clip can be built from the video and appears in /clips', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto(`/clips/new?source=${videoId}`)
  const video = page.locator('video').first()
  await video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((res) => {
        if (v.readyState >= 1) return res()
        v.addEventListener('loadedmetadata', () => res(), { once: true })
      }),
  )

  await page.getByRole('button', { name: 'Set in' }).click() // in-point at 0.0
  await video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<void>((res) => {
        v.pause()
        v.addEventListener('seeked', () => res(), { once: true })
        v.currentTime = 1.5
      }),
  )
  await page.getByRole('button', { name: 'Set out' }).click()
  await page.getByPlaceholder('Clip name…').fill('Ocean moment')
  await page.getByRole('button', { name: 'Save clip' }).click()

  await expect(page).toHaveURL(/\/clips$/)
  await expect(page.getByTitle('Ocean moment')).toBeVisible()
})

test('a photo card opens the gallery overlay; Escape closes it', async ({ page }) => {
  await login(page, NEW_PASSWORD)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open red' }).click()

  // The Details link only exists inside the gallery chrome.
  await expect(page.getByLabel('Details')).toBeVisible()
  await expect(page.getByLabel('Close')).toBeVisible()

  // Double-tap zooms the image in (2.5×) and a second double-tap restores it.
  const img = page.locator('img[alt="red"]')
  await img.dblclick()
  await expect(img).toHaveAttribute('style', /scale\(2\.5\)/)
  await img.dblclick()
  await expect(img).toHaveAttribute('style', /scale\(1\)/)

  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Details')).toHaveCount(0)
})
