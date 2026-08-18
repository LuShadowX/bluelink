import { launch, BASE_URL, OUT_DIR, ROOT } from './browser.mjs'

const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const p = await ctx.newPage()

const failed = []
p.on('requestfailed', (r) => {
  if (r.resourceType() === 'image') failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 90)}`)
})
p.on('response', (r) => {
  if (r.request().resourceType() === 'image' && r.status() >= 400) {
    failed.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`)
  }
})

await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await p.waitForSelector('.card--lead')

// Walk the whole page slowly so every lazy image genuinely enters the viewport
// and is given time to finish, then walk back up.
await p.evaluate(async () => {
  const step = 500
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y)
    await new Promise((r) => setTimeout(r, 320))
  }
})
await p.waitForTimeout(6000)

const report = await p.evaluate(async () => {
  const imgs = [...document.querySelectorAll('img.story-image__img')]
  // Wait for anything still in flight.
  await Promise.all(
    imgs.map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.addEventListener('load', res, { once: true })
              img.addEventListener('error', res, { once: true })
              setTimeout(res, 9000)
            })
    )
  )
  return {
    total: imgs.length,
    loaded: imgs.filter((i) => i.naturalWidth > 1).length,
    stillBroken: imgs
      .filter((i) => i.naturalWidth <= 1)
      .map((i) => ({ complete: i.complete, src: (i.currentSrc || i.src).slice(0, 100) })),
    fallbacks: document.querySelectorAll('.story-image__fallback').length,
  }
})

console.log(`images on page: ${report.total}`)
console.log(`loaded ok:      ${report.loaded}`)
console.log(`fallback plates: ${report.fallbacks} (no artwork in the feed at all)`)
console.log(`still failing:  ${report.stillBroken.length}`)
for (const b of report.stillBroken) console.log(`   complete=${b.complete} ${b.src}`)
console.log('\nnetwork-level image failures:')
console.log(failed.length ? [...new Set(failed)].join('\n') : '  none')

await browser.close()
