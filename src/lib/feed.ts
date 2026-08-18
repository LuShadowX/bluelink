import type { IndexPayload, TopicPayload } from '../types'
import type { TopicId } from '../config/topics'

/**
 * Where an edition is read from.
 *
 * On the web the JSON sits next to the app, so resolving against
 * document.baseURI is correct and works on any host or subpath.
 *
 * Inside a native shell it is not. Capacitor bundles the web assets into the
 * app, so a relative resolve reads the copy that was frozen when the app was
 * built — and keeps reading it forever. The four-hour refresh would appear to
 * run and silently change nothing. Native builds therefore set
 * VITE_DATA_ORIGIN to the live edition and fall back to the bundled copy, which
 * also gives them an instant first paint and something to read offline.
 */
const REMOTE_ORIGIN: string | null = (() => {
  const configured = import.meta.env.VITE_DATA_ORIGIN as string | undefined
  if (!configured) return null
  return configured.endsWith('/') ? configured : `${configured}/`
})()

/** Ordered by preference: live edition first, bundled copy as the safety net. */
function sources(name: string, bustAt?: number): string[] {
  const build = (base: string) => {
    const url = new URL(`data/${name}.json`, base)
    // Only bust on a deliberate re-check; the first load should hit the cache.
    if (bustAt) url.searchParams.set('t', String(bustAt))
    return url.toString()
  }

  const local = build(document.baseURI)
  return REMOTE_ORIGIN ? [build(REMOTE_ORIGIN), local] : [local]
}

async function getJson<T>(name: string, bustAt?: number): Promise<T> {
  const candidates = sources(name, bustAt)
  let lastError: unknown = null

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: bustAt ? 'reload' : 'default' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (err) {
      lastError = err
      // Try the next source. A failure here is normal offline, or when a
      // native build cannot reach the network and must read what it shipped.
    }
  }

  throw new Error(
    `Could not load ${name}.json` +
      (lastError instanceof Error ? ` (${lastError.message})` : '')
  )
}

export function loadIndex(bustAt?: number): Promise<IndexPayload> {
  return getJson<IndexPayload>('index', bustAt)
}

export function loadTopic(topic: TopicId, bustAt?: number): Promise<TopicPayload> {
  return getJson<TopicPayload>(topic, bustAt)
}

/**
 * Open a publisher's article outside the app.
 *
 * In a browser this is an ordinary new tab. Inside a native WebView a plain
 * target="_blank" navigates the app's own view instead, stranding the reader on
 * someone else's site with no back button, so the Capacitor Browser plugin is
 * used when it is present. Resolved at runtime to avoid a dependency the web
 * build does not need.
 */
interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean
    Plugins?: { Browser?: { open: (options: { url: string }) => Promise<void> } }
  }
}

export function openExternal(url: string): void {
  const native = (window as unknown as CapacitorGlobal).Capacitor
  const browser = native?.Plugins?.Browser
  if (native?.isNativePlatform?.() && browser) {
    void browser.open({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
