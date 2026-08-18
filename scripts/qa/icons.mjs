import { launch, BASE_URL, OUT_DIR, ROOT } from './browser.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'


const source = await readFile(`${ROOT}/scripts/icon-source.svg`, 'utf8')

// Strip the authoring comment so it can be inlined into a page.
const svg = source.slice(source.indexOf('<svg'))
/** Rounded variant for contexts the OS does not mask (Chrome tab, desktop). */
const rounded = svg.replace('<rect width="512" height="512"', '<rect width="512" height="512" rx="114"')

await mkdir(`${ROOT}/public/icons`, { recursive: true })

const browser = await launch()

const targets = [
  // Full-bleed square: Android masks these itself, iOS rounds them.
  { file: 'public/icons/icon-192.png', size: 192, art: svg, transparent: false },
  { file: 'public/icons/icon-512.png', size: 512, art: svg, transparent: false },
  { file: 'public/icons/icon-maskable-512.png', size: 512, art: svg, transparent: false },
  { file: 'public/apple-touch-icon.png', size: 180, art: svg, transparent: false },
  // Rounded, with real transparency outside the corner radius.
  { file: 'public/icons/icon-rounded-512.png', size: 512, art: rounded, transparent: true },
]

for (const target of targets) {
  const page = await browser.newPage({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:transparent">
       <div style="width:${target.size}px;height:${target.size}px">
         ${target.art.replace(/width="512" height="512"/, `width="${target.size}" height="${target.size}"`)}
       </div>
     </body></html>`,
    { waitUntil: 'load' }
  )
  await page.waitForTimeout(220)
  const buffer = await page.screenshot({ omitBackground: target.transparent })
  await writeFile(`${ROOT}/${target.file}`, buffer)
  console.log(`${target.file}  ${target.size}x${target.size}  ${Math.round(buffer.length / 1024)}KB`)
  await page.close()
}

await browser.close()
