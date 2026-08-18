/*
 * Shared setup for the QA scripts.
 *
 * Playwright is deliberately NOT a dependency of this project — it is only
 * needed to check the app, never to build or run it, and its browser downloads
 * are large. This resolves it from wherever it happens to be: a local install
 * if someone added one, otherwise the cache `npx playwright` leaves behind.
 *
 * Chrome is driven through `channel: 'chrome'` so the system browser is used
 * and no separate browser download is required.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Point at any deployment: BLUELINK_URL=https://... node scripts/qa/pwa.mjs */
export const BASE_URL = process.env.BLUELINK_URL ?? 'http://localhost:4173/'

/** Screenshots land here. Gitignored. */
export const OUT_DIR = process.env.BLUELINK_QA_OUT ?? resolve(ROOT, '.qa-output')

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    // Not installed locally — fall through to the npx cache.
  }

  const cache = resolve(homedir(), '.npm/_npx')
  if (existsSync(cache)) {
    for (const entry of await readdir(cache)) {
      const candidate = resolve(cache, entry, 'node_modules/playwright/index.mjs')
      if (existsSync(candidate)) return import(pathToFileURL(candidate).href)
    }
  }

  throw new Error(
    'Playwright not found.\n' +
      '  Populate the npx cache with:  npx playwright@latest --version\n' +
      '  or install it locally with:   npm i -D playwright'
  )
}

export async function launch(options = {}) {
  await mkdir(OUT_DIR, { recursive: true })
  const { chromium } = await loadPlaywright()
  return chromium.launch({ channel: 'chrome', ...options })
}
