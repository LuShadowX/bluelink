/*
 * Regenerate the app icons and the masthead mark.
 *
 * The emblem only exists as raster art (assets/bluelink-logo-source.png is a
 * lockup on black), so this works from public/mark.png — the emblem alone on
 * transparency — and does two things to it:
 *
 *   1. Recolours it. The mark was royal blue; it is now sea blue, and the
 *      recolour preserves each pixel's luminance so the original gradient and
 *      its antialiased edges survive instead of turning into a flat silhouette.
 *   2. Composites it onto white at every size the manifest and the two platforms
 *      ask for. Nothing is ever scaled up: the source is 282x408, and the
 *      largest icon draws it at roughly 330px tall.
 *
 * Run with `node scripts/qa/icons.mjs` after changing the brand colour. The mark
 * is rewritten in place, so the recolour is idempotent only in the sense that
 * re-running maps sea blue onto sea blue — keep the royal-blue original in git
 * history if you need to start over.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { launch, ROOT } from './browser.mjs'

/** Sea blue: the fresh end of the blues, dark enough to read on white. */
const SEA_DARK = [0, 122, 158] // #007A9E — shadowed side of the gradient
const SEA_LIGHT = [56, 214, 240] // #38D6F0 — lit side

/** The mark sits inside this fraction of the icon's height. */
const MARK_HEIGHT = { plain: 0.66, maskable: 0.52 }

const markPath = `${ROOT}/public/mark.png`
const markData = await readFile(markPath)
const markUrl = `data:image/png;base64,${markData.toString('base64')}`

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 } })

/**
 * Recolour in the page rather than in Node: canvas gives us a decoder, a pixel
 * buffer and a PNG encoder for free, and Playwright is already here.
 */
const recoloured = await page.evaluate(
  async ([url, dark, light]) => {
    const img = new Image()
    img.src = url
    await img.decode()

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    const bitmap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const px = bitmap.data
    // The original is one hue over a narrow luminance band, so the band is
    // measured first and then stretched across the new one. Measuring rather
    // than assuming is what keeps the gradient from flattening.
    let min = 1
    let max = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
      if (l < min) min = l
      if (l > max) max = l
    }
    const span = Math.max(0.001, max - min)

    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
      const t = Math.min(1, Math.max(0, (l - min) / span))
      px[i] = Math.round(dark[0] + (light[0] - dark[0]) * t)
      px[i + 1] = Math.round(dark[1] + (light[1] - dark[1]) * t)
      px[i + 2] = Math.round(dark[2] + (light[2] - dark[2]) * t)
    }
    ctx.putImageData(bitmap, 0, 0)
    return canvas.toDataURL('image/png')
  },
  [markUrl, SEA_DARK, SEA_LIGHT]
)

await writeFile(markPath, Buffer.from(recoloured.split(',')[1], 'base64'))
console.log(`public/mark.png            recoloured to sea blue`)

const targets = [
  { file: 'public/icons/icon-192.png', size: 192, fit: MARK_HEIGHT.plain },
  { file: 'public/icons/icon-512.png', size: 512, fit: MARK_HEIGHT.plain },
  // Android crops a maskable icon to a circle, so the mark needs to clear the
  // corners with room to spare.
  { file: 'public/icons/icon-maskable-512.png', size: 512, fit: MARK_HEIGHT.maskable },
  { file: 'public/apple-touch-icon.png', size: 180, fit: MARK_HEIGHT.plain },
  { file: 'public/favicon-64.png', size: 64, fit: 0.74 },
  // Rounded, with real transparency outside the corner radius, for the contexts
  // that do not mask the icon themselves.
  { file: 'public/icons/icon-rounded-512.png', size: 512, fit: MARK_HEIGHT.plain, radius: 114 },
]

for (const target of targets) {
  const shot = await browser.newPage({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1,
  })
  await shot.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">
       <div style="width:${target.size}px;height:${target.size}px;background:#ffffff;
                   ${target.radius ? `border-radius:${(target.radius / 512) * target.size}px;` : ''}
                   display:grid;place-items:center;overflow:hidden">
         <img src="${recoloured}" style="height:${Math.round(target.size * target.fit)}px;width:auto" />
       </div>
     </body></html>`,
    { waitUntil: 'load' }
  )
  await shot.waitForTimeout(180)
  const buffer = await shot.screenshot({ omitBackground: Boolean(target.radius) })
  await writeFile(`${ROOT}/${target.file}`, buffer)
  console.log(
    `${target.file.padEnd(34)} ${target.size}x${target.size}  ${Math.round(buffer.length / 1024)}KB`
  )
  await shot.close()
}

await page.close()
await browser.close()
