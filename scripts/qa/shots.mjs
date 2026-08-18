/*
 * Screenshot sweep.
 *
 * Grabs the front page, a section, the YouTube board and the reader at desktop
 * and phone widths, so a design change can be judged by looking at it rather
 * than by trusting that the CSS compiled.
 */

import { resolve } from 'node:path'
import { BASE_URL, OUT_DIR, launch } from './browser.mjs'

const SHOTS = [
  { name: 'front', hash: '#/', full: false },
  { name: 'front-full', hash: '#/', full: true },
  { name: 'tech', hash: '#/tech', full: false },
  { name: 'youtube', hash: '#/youtube', full: false },
  { name: 'arena', hash: '#/arena', full: false },
  { name: 'movies', hash: '#/movies', full: false },
]

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 950 },
  { label: 'phone', width: 390, height: 844, isMobile: true },
]

const browser = await launch()

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    hasTouch: Boolean(viewport.isMobile),
  })
  const page = await context.newPage()

  for (const shot of SHOTS) {
    await page.goto(`${BASE_URL}${shot.hash}`, { waitUntil: 'load' })
    // Let the fonts land, the images decode and the entry animation finish.
    await page.waitForTimeout(5000)
    const file = resolve(OUT_DIR, `${shot.name}-${viewport.label}.png`)
    await page.screenshot({ path: file, fullPage: shot.full })
    console.log(`  ${file}`)
  }

  // The reader, opened from the lead story.
  await page.goto(`${BASE_URL}#/tech`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  await page.locator('.card--lead .card__link').first().click()
  await page.waitForTimeout(1200)
  const readerFile = resolve(OUT_DIR, `reader-${viewport.label}.png`)
  await page.screenshot({ path: readerFile })
  console.log(`  ${readerFile}`)

  await context.close()
}

await browser.close()
