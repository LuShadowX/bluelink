import { launch, BASE_URL, OUT_DIR, ROOT } from './browser.mjs'

const URL = BASE_URL
const OUT = OUT_DIR

const browser = await launch()
const problems = []

async function page(width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  })
  const p = await ctx.newPage()
  p.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`)
  })
  p.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`))
  return { ctx, p }
}

async function settle(p, ms = 3500) {
  await p.waitForLoadState('networkidle').catch(() => {})
  await p.waitForTimeout(ms)
}

// ---- Desktop ----
{
  const { ctx, p } = await page(1600, 1000)
  await p.goto(URL, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead', { timeout: 15000 })
  await settle(p, 4500)

  await p.screenshot({ path: `${OUT_DIR}/01-hero.png` })

  // Overflow check: nothing should push the page sideways.
  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  if (overflow > 2) problems.push(`desktop horizontal overflow: ${overflow}px`)

  // How much of the lead is readable without scrolling?
  const leadFits = await p.evaluate(() => {
    const byline = document.querySelector('.card--lead .card__byline')
    return byline ? Math.round(byline.getBoundingClientRect().bottom) : -1
  })
  console.log('lead byline bottom at', leadFits, 'px (viewport 1000)')

  // Mid-page: the section bands.
  await p.evaluate(() => window.scrollTo(0, 2100))
  await p.waitForTimeout(1400)
  await p.screenshot({ path: `${OUT_DIR}/02-bands.png` })

  // Reader.
  await p.evaluate(() => window.scrollTo(0, 0))
  await p.waitForTimeout(600)
  await p.click('.card--lead .card__link')
  await p.waitForSelector('.reader', { timeout: 8000 })
  await settle(p, 2500)
  await p.screenshot({ path: `${OUT_DIR}/03-reader.png` })

  const readerTitle = await p.textContent('.reader__title')
  if (!readerTitle?.trim()) problems.push('reader opened with no title')

  await p.keyboard.press('Escape')
  await p.waitForTimeout(900)
  if (await p.$('.reader')) problems.push('Escape did not close the reader')

  // Search.
  await p.keyboard.press('/')
  await p.waitForSelector('.search__panel', { timeout: 6000 })
  await p.fill('.search__input', 'apple')
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${OUT_DIR}/04-search.png` })
  const hits = await p.$$eval('.search__result', (n) => n.length)
  console.log('search "apple" results:', hits)
  if (hits === 0) problems.push('search returned nothing for "apple"')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)

  // Topic page.
  await p.goto(`${URL}#/ai`, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead', { timeout: 12000 })
  await settle(p, 3500)
  await p.screenshot({ path: `${OUT_DIR}/05-topic-ai.png` })

  // Save two stories, then look at the saved page.
  await p.evaluate(() => window.scrollTo(0, 0))
  const savers = await p.$$('.card__save')
  for (const s of savers.slice(0, 3)) await s.click().catch(() => {})
  await p.waitForTimeout(500)
  await p.goto(`${URL}#/saved`, { waitUntil: 'domcontentloaded' })
  await settle(p, 2200)
  await p.screenshot({ path: `${OUT_DIR}/06-saved.png` })
  const savedCount = await p.$$eval('.card', (n) => n.length)
  console.log('saved page cards:', savedCount)
  if (savedCount === 0) problems.push('saving a story did not populate the saved page')

  await ctx.close()
}

// ---- Phone ----
{
  const { ctx, p } = await page(390, 844)
  await p.goto(URL, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead', { timeout: 15000 })
  await settle(p, 4000)
  await p.screenshot({ path: `${OUT_DIR}/07-phone-top.png` })

  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  if (overflow > 2) problems.push(`phone horizontal overflow: ${overflow}px`)

  await p.evaluate(() => window.scrollTo(0, 1500))
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${OUT_DIR}/08-phone-scroll.png` })

  // Tap target audit — anything interactive under 40px on a phone is a miss.
  const small = await p.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button, a')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.height < 30) {
        out.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}`
        )
      }
    }
    return [...new Set(out)].slice(0, 12)
  })
  if (small.length) console.log('small tap targets:', small.join(' | '))

  await ctx.close()
}

// ---- Image health across the front page ----
{
  const { ctx, p } = await page(1600, 1000)
  await p.goto(URL, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead', { timeout: 15000 })
  await p.evaluate(async () => {
    // Force every lazy image to start loading.
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 90))
    }
    window.scrollTo(0, 0)
  })
  await settle(p, 6000)
  const imgs = await p.$$eval('img.story-image__img', (nodes) =>
    nodes.map((n) => ({ ok: n.naturalWidth > 1, src: n.currentSrc || n.src }))
  )
  const broken = imgs.filter((i) => !i.ok)
  const fallbacks = await p.$$eval('.story-image__fallback', (n) => n.length)
  console.log(
    `images: ${imgs.length - broken.length}/${imgs.length} loaded, ${broken.length} broken, ${fallbacks} fallback plates`
  )
  for (const b of broken.slice(0, 8)) console.log('  broken:', b.src.slice(0, 110))
  await ctx.close()
}

await browser.close()

console.log('\n=== ISSUES ===')
if (problems.length === 0) console.log('none')
else problems.forEach((p) => console.log(' -', p))
