/*
 * BlueLink service worker.
 *
 * Written by hand rather than generated, because the caching rules here are
 * specific enough that a default precache-everything strategy would fight the
 * app: the whole point of BlueLink is that an edition is replaced every four hours,
 * so the JSON must never be served from cache while the network is reachable.
 *
 * Strategy per resource, and why:
 *   navigation      network-first  — a deploy should be picked up on next launch
 *   data/*.json     network-first  — a stale edition offline beats no edition,
 *                                    but a fresh one always wins
 *   assets/*        cache-first    — Vite hashes these, so they are immutable
 *   icons, manifest cache-first    — change only with a new SW version
 *   publisher images stale-while-revalidate, capped — nice to have offline,
 *                                    never allowed to eat unbounded storage
 */

const VERSION = 'bluelink-v2'
const SHELL_CACHE = `${VERSION}-shell`
const DATA_CACHE = `${VERSION}-data`
const IMAGE_CACHE = `${VERSION}-images`
const FONT_CACHE = `${VERSION}-fonts`

/** Cross-origin images are opaque and padded in the quota, so keep this modest. */
const IMAGE_LIMIT = 80

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon-64.png',
  './mark.png',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  // Shipping one edition means the app is readable the moment it is installed,
  // even if the network disappears immediately afterwards.
  './data/index.json',
  './data/tech.json',
  './data/ai.json',
  './data/sports.json',
  './data/games.json',
  './data/lifestyle.json',
  './data/youtube.json',
]

/**
 * Find the build's own script and stylesheet URLs by reading index.html.
 *
 * These filenames are content-hashed by Vite, so they cannot be listed above.
 * They also cannot be left to the runtime handler: on a first visit the page
 * has already fetched them before this worker activates, so nothing intercepts
 * them and the cache stays empty — the app would serve its HTML offline and
 * then fail to boot because the JS beside it was never stored.
 */
function buildAssetsIn(html, base) {
  const urls = new Set()
  for (const match of html.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/gi)) {
    const raw = match[1]
    if (!raw) continue
    try {
      const url = new URL(raw, base)
      // Same-origin only. Fonts and other third parties are runtime-cached.
      if (url.origin === self.location.origin) urls.add(url.toString())
    } catch {
      // Not a resolvable URL; ignore.
    }
  }
  return [...urls]
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const wanted = new Set(
        PRECACHE.map((path) => new URL(path, self.registration.scope).toString())
      )

      // Read the shell first so its hashed assets join the precache list.
      try {
        const indexUrl = new URL('index.html', self.registration.scope)
        const request = new Request(indexUrl, { cache: 'reload' })
        const response = await fetch(request)
        if (response.ok) {
          const copy = response.clone()
          const html = await response.text()
          await cache.put(cacheKeyFor(request), copy)
          for (const url of buildAssetsIn(html, indexUrl)) wanted.add(url)
        }
      } catch {
        // Offline during install; the runtime handlers will fill in later.
      }

      // Individually, so one 404 cannot fail the whole installation.
      await Promise.all(
        [...wanted].map(async (url) => {
          try {
            const request = new Request(url, { cache: 'reload' })
            const response = await fetch(request)
            if (response.ok) await cache.put(cacheKeyFor(request), response)
          } catch {
            // Not deployed, or unreachable right now.
          }
        })
      )

      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE, IMAGE_CACHE, FONT_CACHE])
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name)
      }
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting()
})

/**
 * Cache key with the query string removed.
 *
 * The app appends ?t=<timestamp> when it deliberately re-checks for a new
 * edition. Keyed on the full URL, every check would deposit a new entry and the
 * offline fallback would never find the one it wanted.
 */
function cacheKeyFor(request) {
  const url = new URL(request.url)
  url.search = ''
  return url.toString()
}

const isData = (url) => url.pathname.includes('/data/') && url.pathname.endsWith('.json')
const isImmutableAsset = (url) => url.pathname.includes('/assets/')
const isIcon = (url) =>
  url.pathname.includes('/icons/') ||
  url.pathname.endsWith('favicon-64.png') ||
  url.pathname.endsWith('mark.png') ||
  url.pathname.endsWith('apple-touch-icon.png') ||
  url.pathname.endsWith('manifest.webmanifest')

async function networkFirst(request, cacheName) {
  const key = cacheKeyFor(request)
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      await cache.put(key, response.clone())
    }
    return response
  } catch (err) {
    const cached = await caches.match(key)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request, cacheName) {
  const key = cacheKeyFor(request)
  const cached = await caches.match(key)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(cacheName)
    await cache.put(key, response.clone())
  }
  return response
}

/** Serve what we have, refresh in the background, and keep the cache bounded. */
async function staleWhileRevalidate(request, cacheName, limit) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const revalidate = fetch(request)
    .then(async (response) => {
      // Opaque cross-origin responses report status 0; that is expected and
      // still cacheable. Genuine errors are not.
      if (response.status === 0 || response.ok) {
        await cache.put(request, response.clone())
        await trim(cache, limit)
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    void revalidate
    return cached
  }
  const fresh = await revalidate
  if (fresh) return fresh
  return new Response('', { status: 504, statusText: 'Offline and not cached' })
}

async function trim(cache, limit) {
  const keys = await cache.keys()
  if (keys.length <= limit) return
  // Oldest-first: Cache Storage preserves insertion order.
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  // A navigation must survive being offline, so fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          return (
            (await caches.match(new URL('index.html', self.registration.scope).toString())) ??
            (await caches.match(self.registration.scope)) ??
            new Response('BlueLink is offline.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            })
          )
        }
      })()
    )
    return
  }

  if (url.origin === self.location.origin) {
    if (isData(url)) {
      event.respondWith(networkFirst(request, DATA_CACHE))
    } else if (isImmutableAsset(url) || isIcon(url)) {
      event.respondWith(cacheFirst(request, SHELL_CACHE))
    }
    return
  }

  // Google Fonts. Cached so the app keeps its own typography offline instead of
  // silently dropping to the local serif fallback.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE, 40))
    return
  }

  // Cross-origin: publisher artwork. Everything else is left alone.
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, IMAGE_LIMIT))
  }
})
