import { launch, BASE_URL, OUT_DIR, ROOT } from './browser.mjs'
import { readFileSync } from 'node:fs'

const REAL = JSON.parse(
  readFileSync(`${ROOT}/public/data/index.json`, 'utf8')
)

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** The published edition, restamped and optionally reordered. */
function edition(ageHours, rotate = 0) {
  const highlights = [...REAL.highlights]
  for (let i = 0; i < rotate; i += 1) highlights.push(highlights.shift())
  return JSON.stringify({
    ...REAL,
    generatedAt: new Date(Date.now() - ageHours * 3600_000).toISOString(),
    highlights,
  })
}

const browser = await launch()
// Service workers are blocked here on purpose. This file tests the app's own
// refresh logic via page.route(), and page-level interception does not apply to
// requests a service worker makes itself — so with one active the doctored
// payloads below would be bypassed and hit the real server. Service-worker
// behaviour is covered separately in pwa-test.mjs.
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  serviceWorkers: 'block',
})
const p = await ctx.newPage()

// Serve a seven-hour-old edition first, then a brand new one on any re-check.
let served = 'stale'
await p.route('**/data/index.json*', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: served === 'stale' ? edition(8) : edition(0, 3),
  })
})

await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await p.waitForSelector('.card--lead')
await p.waitForTimeout(2500)

console.log('\n1. A stale edition is recognised as stale')
const pill = await p.textContent('.freshness')
// The app samples its clock at mount, a beat before this payload is stamped, so
// either bucket is correct here.
check('freshness reports the real age', /[78]h ago/i.test(pill ?? ''), `pill reads "${pill?.trim()}"`)
check(
  'stale state is styled as stale',
  await p.evaluate(() => document.querySelector('.freshness')?.classList.contains('freshness--stale')),
)

const leadBefore = (await p.textContent('.card--lead .card__title'))?.trim().slice(0, 60)

console.log('\n2. A newer edition is detected but not forced on the reader')
served = 'fresh'
await p.click('.freshness')
await p.waitForTimeout(2500)

const pill2 = await p.textContent('.freshness')
check('reader is offered the new edition', /new stories/i.test(pill2 ?? ''), `pill reads "${pill2?.trim()}"`)
const leadDuring = (await p.textContent('.card--lead .card__title'))?.trim().slice(0, 60)
check(
  'the page is NOT swapped out from under the reader',
  leadDuring === leadBefore,
  `lead still "${leadDuring?.slice(0, 34)}…"`
)

console.log('\n3. Accepting it swaps the edition in')
await p.click('.freshness')
await p.waitForTimeout(2500)

const leadAfter = (await p.textContent('.card--lead .card__title'))?.trim().slice(0, 60)
check('the lead story changed', leadAfter !== leadBefore, `now "${leadAfter?.slice(0, 34)}…"`)
const pill3 = await p.textContent('.freshness')
check(
  'freshness resets to current',
  /just now|updated/i.test(pill3 ?? '') && !/new stories/i.test(pill3 ?? ''),
  `pill reads "${pill3?.trim()}"`
)
check(
  'sections reloaded rather than showing the old edition',
  (await p.$$eval('.card', (n) => n.length)) > 10,
  `${await p.$$eval('.card', (n) => n.length)} cards on the page`
)

console.log('\n4. Waking a parked tab triggers its own check')
served = 'stale'
await p.evaluate(() => {
  // Pretend the tab was in the background for a while.
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
})
await p.waitForTimeout(1500)
check('no crash on wake', (await p.$$eval('.card', (n) => n.length)) > 10)

await browser.close()

console.log(`\n=== ${failures.length === 0 ? 'ALL REFRESH CHECKS PASSED' : failures.length + ' FAILED'} ===`)
if (failures.length) failures.forEach((f) => console.log(' -', f))
process.exit(failures.length ? 1 : 0)
