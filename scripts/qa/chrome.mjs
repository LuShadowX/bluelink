/*
 * The chrome: both themes, the yin-yang menu open and closed, and the reader's
 * topic row. These are the parts a build cannot verify — a passing type check
 * says nothing about whether white type landed on a yellow chip.
 */

import { resolve } from 'node:path'
import { BASE_URL, OUT_DIR, launch } from './browser.mjs'

const browser = await launch()

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    deviceScaleFactor: 2,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  })
  const page = await ctx.newPage()
  await page.goto(BASE_URL, { waitUntil: 'load' })
  await page.waitForTimeout(4500)

  const applied = await page.evaluate(() => document.documentElement.dataset.theme)
  if (applied !== theme) throw new Error(`expected ${theme}, page chose ${applied}`)

  await page.screenshot({ path: resolve(OUT_DIR, `theme-${theme}.png`) })

  // The menu, open.
  await page.click('.yy__button')
  await page.waitForTimeout(700)
  await page.screenshot({
    path: resolve(OUT_DIR, `menu-${theme}.png`),
    clip: { x: 700, y: 0, width: 740, height: 520 },
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  // The about page, which the menu now routes to in-app rather than to GitHub.
  await page.goto(`${BASE_URL}#/about`, { waitUntil: 'load' })
  await page.waitForTimeout(2200)
  await page.screenshot({ path: resolve(OUT_DIR, `about-${theme}.png`) })

  // The reader, at the topic row.
  await page.goto(`${BASE_URL}#/tech`, { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  await page.locator('.card--lead .card__link').first().click()
  await page.waitForTimeout(1300)
  await page.screenshot({ path: resolve(OUT_DIR, `reader-${theme}.png`) })

  console.log(
    `  ${theme}: theme-${theme}.png, menu-${theme}.png, about-${theme}.png, reader-${theme}.png`
  )
  await ctx.close()
}

// And the theme toggle itself: pressing it must flip the attribute and stick.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await ctx.newPage()
await page.goto(BASE_URL, { waitUntil: 'load' })
await page.waitForTimeout(2500)
const before = await page.evaluate(() => document.documentElement.dataset.theme)
await page.click('.icon-button--theme')
await page.waitForTimeout(600)
const after = await page.evaluate(() => document.documentElement.dataset.theme)
const stored = await page.evaluate(() => localStorage.getItem('bluelink:theme'))
const meta = await page.getAttribute('meta[name="theme-color"]', 'content')
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2000)
const persisted = await page.evaluate(() => document.documentElement.dataset.theme)

console.log(`  toggle: ${before} -> ${after}  stored=${stored}  theme-color=${meta}`)
console.log(`  survives a reload: ${persisted === after ? 'yes' : `NO (${persisted})`}`)
if (before === after || stored !== after || persisted !== after) {
  console.error('\n  FAIL: the theme toggle did not hold')
  process.exitCode = 1
}

await browser.close()
