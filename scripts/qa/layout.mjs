import { launch, BASE_URL, OUT_DIR, ROOT } from './browser.mjs'

const OUT = OUT_DIR
const browser = await launch()

for (const width of [1600, 1024, 760, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  const p = await ctx.newPage()
  await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('.card--lead')
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await p.waitForTimeout(3000)

  const result = await p.evaluate(() => {
    const rows = []
    for (const grid of document.querySelectorAll('.grid--4, .grid--3')) {
      const cells = [...grid.children]
      const cols = new Set(cells.map((c) => Math.round(c.getBoundingClientRect().left)))
      const perRow = cols.size
      for (let i = 0; i < cells.length; i += perRow) {
        const group = cells.slice(i, i + perRow)
        if (group.length < 2) continue
        const widths = group.map((c) => Math.round(c.getBoundingClientRect().width))
        const titles = group
          .map((c) => c.querySelector('.card__title'))
          .filter(Boolean)
          .map((t) => Math.round(t.getBoundingClientRect().top))
        rows.push({
          widths: [...new Set(widths)],
          titleSpread: titles.length > 1 ? Math.max(...titles) - Math.min(...titles) : 0,
        })
      }
    }
    return {
      rows,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  const badWidth = result.rows.filter((r) => r.widths.length > 1)
  const badBaseline = result.rows.filter((r) => r.titleSpread > 2)
  console.log(
    `${String(width).padStart(4)}px  rows=${result.rows.length}  unequal-columns=${badWidth.length}  misaligned-headlines=${badBaseline.length}  overflow=${result.overflow}px`
  )
  if (badWidth.length) console.log('        widths:', JSON.stringify(badWidth.slice(0, 3)))
  if (badBaseline.length) {
    console.log('        spreads:', badBaseline.slice(0, 4).map((r) => r.titleSpread + 'px').join(', '))
  }

  if (width === 1600) {
    await p.evaluate(() => window.scrollTo(0, 2100))
    await p.waitForTimeout(1200)
    await p.screenshot({ path: `${OUT_DIR}/09-bands-fixed.png` })
  }
  await ctx.close()
}

await browser.close()
