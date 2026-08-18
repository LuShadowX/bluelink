import { launch, BASE_URL, OUT_DIR, ROOT } from './browser.mjs'

const URL = BASE_URL
const OUT = OUT_DIR

const fails = []
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!pass) fails.push(label)
}

const browser = await launch()

// ---- 1. Manifest and icons -------------------------------------------------
console.log('\n1. Installability')
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(URL, { waitUntil: 'domcontentloaded' })

  const href = await p.getAttribute('link[rel="manifest"]', 'href')
  ok('manifest is linked', !!href, href ?? '')

  const manifest = await p.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    const res = await fetch(link.href)
    return res.ok ? await res.json() : null
  })
  ok('manifest parses as JSON', !!manifest)
  if (manifest) {
    ok('has name + short_name', !!manifest.name && !!manifest.short_name, manifest.short_name)
    ok('display is standalone', manifest.display === 'standalone', manifest.display)
    ok('has 192px icon', manifest.icons.some((i) => i.sizes === '192x192'))
    ok('has 512px icon', manifest.icons.some((i) => i.sizes === '512x512'))
    ok(
      'has a maskable icon (Android adaptive)',
      manifest.icons.some((i) => (i.purpose ?? '').includes('maskable'))
    )

    const icons = await p.evaluate(async (m) => {
      const out = []
      for (const icon of m.icons) {
        const url = new URL(icon.src, document.baseURI).toString()
        try {
          const r = await fetch(url)
          out.push({ src: icon.src, status: r.status })
        } catch {
          out.push({ src: icon.src, status: 0 })
        }
      }
      return out
    }, manifest)
    const broken = icons.filter((i) => i.status !== 200)
    ok('every icon actually resolves', broken.length === 0, `${icons.length} icons, ${broken.length} broken`)
    for (const b of broken) console.log('        missing:', b.src, b.status)
  }

  const appleIcon = await p.getAttribute('link[rel="apple-touch-icon"]', 'href')
  ok('apple-touch-icon present (iOS home screen)', !!appleIcon)
  /*
   * The app rewrites theme-color to match the active theme, so this checks that
   * it agrees with the theme rather than pinning one literal value — the browser
   * chrome not matching the page is the actual defect.
   */
  const themeColor = (await p.getAttribute('meta[name="theme-color"]', 'content')) ?? ''
  const theme = await p.evaluate(() => document.documentElement.dataset.theme)
  const expected = theme === 'dark' ? '#0a0b10' : '#ffffff'
  ok(
    'theme-color matches the theme',
    themeColor.toLowerCase() === expected,
    `${theme} / ${themeColor}`
  )
  await ctx.close()
}

// ---- 2. Service worker + offline -------------------------------------------
console.log('\n2. Offline capability')
{
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(URL, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead', { timeout: 20000 })

  const state = await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    const sw = reg.active
    // `ready` resolves as soon as there is an active worker, which can still be
    // mid-activation while its install-time precache finishes.
    if (sw && sw.state !== 'activated') {
      await new Promise((resolve) => {
        const onChange = () => {
          if (sw.state === 'activated') {
            sw.removeEventListener('statechange', onChange)
            resolve()
          }
        }
        sw.addEventListener('statechange', onChange)
        setTimeout(resolve, 10000)
      })
    }
    return { scope: reg.scope, active: !!reg.active, state: reg.active?.state }
  })
  ok('service worker activated', state.active && state.state === 'activated', state.state ?? 'none')
  ok('scope covers the app', state.scope.endsWith('/'), state.scope)

  // Let the precache finish and the page warm its runtime caches.
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await p.waitForTimeout(6000)

  const caches = await p.evaluate(async () => {
    const names = await window.caches.keys()
    const out = {}
    for (const n of names) out[n] = (await (await window.caches.open(n)).keys()).length
    return out
  })
  console.log('        caches:', JSON.stringify(caches))
  ok('shell was precached', Object.entries(caches).some(([n, c]) => n.includes('shell') && c > 5))
  ok('an edition is cached for offline', Object.entries(caches).some(([n, c]) => n.includes('data') && c > 0) || Object.entries(caches).some(([n, c]) => n.includes('shell') && c > 8))

  // Now cut the network and reload — the real test.
  await ctx.setOffline(true)
  await p.reload({ waitUntil: 'domcontentloaded' })
  const offlineWorks = await p
    .waitForSelector('.card--lead', { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  ok('app still loads with the network cut', offlineWorks)

  if (offlineWorks) {
    const info = await p.evaluate(() => ({
      cards: document.querySelectorAll('.card').length,
      lead: document.querySelector('.card--lead .card__title')?.textContent?.trim().slice(0, 44),
    }))
    ok('real stories render offline', info.cards > 5, `${info.cards} cards, lead "${info.lead}"`)
    await p.screenshot({ path: `${OUT_DIR}/20-offline.png` })

    // Section navigation offline exercises the cached topic payloads.
    await p.evaluate(() => { window.location.hash = '#/games' })
    await p.waitForTimeout(2500)
    const gamesOffline = await p.evaluate(() => document.querySelectorAll('.card').length)
    ok('a section opens offline too', gamesOffline > 5, `${gamesOffline} cards`)
  }

  await ctx.setOffline(false)
  await ctx.close()
}

// ---- 3. Pull to refresh on a touch device ----------------------------------
console.log('\n3. Pull to refresh (touch only)')
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  })
  const p = await ctx.newPage()
  await p.goto(URL, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead', { timeout: 20000 })
  await p.waitForTimeout(2500)

  const coarse = await p.evaluate(
    () => window.matchMedia('(hover: none) and (pointer: coarse)').matches
  )
  ok('device reports as coarse pointer', coarse)

  // Drive a real drag from the top of the page.
  const drag = async (totalY, steps = 14) => {
    await p.evaluate(
      async ([totalY, steps]) => {
        const target = document.documentElement
        const mk = (type, y) => {
          const t = new Touch({ identifier: 1, target, clientX: 195, clientY: y })
          return new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [t],
            targetTouches: type === 'touchend' ? [] : [t],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          })
        }
        window.scrollTo(0, 0)
        window.dispatchEvent(mk('touchstart', 100))
        for (let i = 1; i <= steps; i += 1) {
          window.dispatchEvent(mk('touchmove', 100 + (totalY * i) / steps))
          await new Promise((r) => setTimeout(r, 22))
        }
      },
      [totalY, steps]
    )
  }

  await drag(150)
  await p.waitForTimeout(180)
  const mid = await p.evaluate(() => {
    const el = document.querySelector('.pull')
    return el ? { text: el.textContent?.trim(), armed: el.classList.contains('pull--armed') } : null
  })
  ok('indicator appears while pulling', !!mid, mid ? `"${mid.text}"` : 'not rendered')
  ok('passes the arm threshold', !!mid?.armed, mid?.armed ? 'armed' : 'not armed')
  if (mid) await p.screenshot({ path: `${OUT_DIR}/21-pull.png` })

  await p.evaluate(() => {
    const t = new Touch({ identifier: 1, target: document.documentElement, clientX: 195, clientY: 250 })
    window.dispatchEvent(
      new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true })
    )
  })
  await p.waitForTimeout(400)
  const busy = await p.evaluate(() => {
    const el = document.querySelector('.pull')
    return el ? el.textContent?.trim() : null
  })
  console.log('        after release:', busy ?? 'indicator dismissed')

  await p.waitForTimeout(3500)
  const settled = await p.evaluate(() => ({
    indicator: !!document.querySelector('.pull'),
    cards: document.querySelectorAll('.card').length,
  }))
  ok('gesture completes and clears', !settled.indicator)
  ok('page intact after refresh', settled.cards > 5, `${settled.cards} cards`)

  // A short pull must NOT trigger a refresh.
  await drag(20)
  await p.waitForTimeout(150)
  const shortPull = await p.evaluate(() => {
    const el = document.querySelector('.pull')
    return el?.classList.contains('pull--armed') ?? false
  })
  ok('a short pull does not arm', !shortPull)

  await ctx.close()
}

await browser.close()
console.log(`\n=== ${fails.length === 0 ? 'ALL PWA CHECKS PASSED' : fails.length + ' FAILED'} ===`)
fails.forEach((f) => console.log(' -', f))
process.exit(fails.length ? 1 : 0)
