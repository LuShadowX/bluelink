import type { IndexPayload, TopicPayload } from '../types'
import type { TopicId } from '../config/topics'

/**
 * Feed payloads are static files served alongside the app, so they resolve
 * against document.baseURI rather than a hardcoded root. That keeps one build
 * working on a dev server, a GitHub Pages subpath, and a file:// WebView shell.
 */
function dataUrl(name: string, bustAt?: number): string {
  const url = new URL(`data/${name}.json`, document.baseURI)
  // Only bust on a deliberate re-check; the first load should hit the cache.
  if (bustAt) url.searchParams.set('t', String(bustAt))
  return url.toString()
}

async function getJson<T>(name: string, bustAt?: number): Promise<T> {
  const res = await fetch(dataUrl(name, bustAt), {
    cache: bustAt ? 'reload' : 'default',
  })
  if (!res.ok) {
    throw new Error(`Could not load ${name}.json (${res.status})`)
  }
  return (await res.json()) as T
}

export function loadIndex(bustAt?: number): Promise<IndexPayload> {
  return getJson<IndexPayload>('index', bustAt)
}

export function loadTopic(topic: TopicId, bustAt?: number): Promise<TopicPayload> {
  return getJson<TopicPayload>(topic, bustAt)
}
