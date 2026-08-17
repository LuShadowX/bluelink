#!/usr/bin/env node
/*
 * Pulse feed pipeline.
 *
 * Reads scripts/feeds.json, pulls every RSS/Atom feed, normalises the items
 * into one shape, de-duplicates across publishers, and writes static JSON into
 * public/data/. The app itself never talks to a publisher — it reads these
 * files. That keeps the client free of CORS proxies and API keys, and means a
 * publisher going down degrades one section instead of the whole app.
 *
 * Run manually with `npm run news`; in production the GitHub Actions cron in
 * .github/workflows/refresh-news.yml runs it every six hours and commits the
 * result.
 */

import { XMLParser } from 'fast-xml-parser'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = resolve(ROOT, 'public/data')

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const FEED_TIMEOUT_MS = 15_000
const CONCURRENCY = 8
/** Anything older than this is stale enough to be noise rather than news. */
const MAX_AGE_DAYS = 21
/** Stories kept per topic. Deep enough to scroll, small enough to stay fast. */
const PER_TOPIC_LIMIT = 60
const SUMMARY_MAX = 260

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  // Feeds are wildly inconsistent about whether a single child is an array.
  // Forcing the containers we care about means downstream code never branches.
  isArray: (name) =>
    ['item', 'entry', 'media:content', 'enclosure', 'link', 'category'].includes(name),
})

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
  mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', trade: '™', copy: '©', reg: '®', deg: '°', eacute: 'é',
  egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä',
  szlig: 'ß', ntilde: 'ñ', pound: '£', euro: '€', middot: '·', bull: '•',
  laquo: '«', raquo: '»', times: '×', frac12: '½', prime: '′', Prime: '″',
}

/** Feeds routinely double-encode; two passes clears `&amp;#8217;`. */
function decodeEntities(input) {
  let out = String(input)
  for (let pass = 0; pass < 2; pass += 1) {
    out = out
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
      .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => {
        const hit = NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()]
        return hit ?? m
      })
  }
  return out
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

function stripHtml(input) {
  return decodeEntities(
    String(input)
      // Drop whole blocks whose text content is never prose.
      .replace(/<(script|style|figcaption)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pull plain text out of a node that may be a string, {#text}, or CDATA. */
function text(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return text(node[0])
  if (typeof node === 'object') {
    if ('#text' in node) return String(node['#text'])
    if ('@_href' in node) return String(node['@_href'])
  }
  return ''
}

const TRACKING_PARAMS =
  /^(utm_|ito$|ico$|cmpid$|CMP$|ns_|at_|fbclid$|gclid$|mc_cid$|mc_eid$|smid$|partner$|sh$|srnd$|taid$|guccounter$)/i

/**
 * Tidy a URL without changing which resource it points at: resolve it against
 * the feed, force https so nothing is blocked as mixed content on an https
 * host, drop the fragment, and strip campaign parameters.
 *
 * The host and path are left exactly as published. That matters — an earlier
 * version folded `www.` away and Engadget's image host started refusing the
 * requests, because for plenty of servers `www` is a different machine, not a
 * cosmetic prefix. Normalising for comparison is dedupeKey's job instead.
 */
function cleanUrl(raw, base) {
  const value = decodeEntities(String(raw ?? '')).trim()
  if (!value) return ''
  // Backstop against a node reaching here and stringifying itself.
  if (value.includes('[object')) return ''
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.protocol = 'https:'
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * Comparison form only, never fetched. Two syndication partners publishing the
 * same story with `www`, a trailing slash and reshuffled query order should
 * collapse to one entry, and the article id should stay stable between runs.
 */
function dedupeKey(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : '/'
    url.searchParams.sort()
    return `${host}${path}${url.search}`
  } catch {
    return rawUrl
  }
}

function hash(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

/** Titles differ by punctuation and casing across syndication partners. */
function titleKey(title) {
  return stripHtml(title)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
}

function truncate(value, max) {
  const clean = value.trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastStop > max * 0.55) return cut.slice(0, lastStop + 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:—–-]$/, '')}…`
}

function parseDate(...candidates) {
  const skewLimit = Date.now() + 36 * 60 * 60 * 1000
  for (const candidate of candidates) {
    const raw = text(candidate).trim()
    if (!raw) continue
    const ms = Date.parse(raw)
    // Ignore obvious clock nonsense — some feeds ship 1970 or ten years out.
    if (Number.isFinite(ms) && ms > 0 && ms < skewLimit) return new Date(ms).toISOString()
  }
  return null
}

// ---------------------------------------------------------------------------
// Image extraction — the layout leans on artwork, so this tries hard.
// ---------------------------------------------------------------------------

const BAD_IMAGE =
  /(1x1|pixel|spacer|blank|avatar|gravatar|feedburner|doubleclick|badge|button|icon[-_.]|logo[-_.]?\d*\.(png|gif))/i

/**
 * Hosts that answer with `Cross-Origin-Resource-Policy: same-origin`. The file
 * is real and returns 200, but no browser will ever render it on another
 * origin, so recording it as artwork only buys a guaranteed failed request and
 * a console error. Better to report no image and let the fallback plate do its
 * job deliberately.
 */
const UNEMBEDDABLE_IMAGE_HOSTS = new Set(['images.nintendolife.com'])

function isUsableImage(url) {
  if (!url) return false
  if (BAD_IMAGE.test(url)) return false
  try {
    if (UNEMBEDDABLE_IMAGE_HOSTS.has(new URL(url).hostname.toLowerCase())) return false
  } catch {
    return false
  }
  return (
    /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(url) ||
    /\/(image|photo|media|thumb|resize|crop)/i.test(url)
  )
}

function pickImage(item, base) {
  const candidates = []
  const push = (value) => {
    // Never hand a raw node to cleanUrl. Feeds ship <image> and <media:thumbnail>
    // as elements with children, and stringifying one produces the literal
    // "[object Object]", which then resolves against the feed base into a
    // plausible-looking URL that can only ever 404.
    const raw =
      typeof value === 'string' || typeof value === 'number' ? String(value) : text(value)
    if (!raw) return
    const url = cleanUrl(raw, base)
    if (!url) return
    // Rejected here rather than in the final pick, because the last-resort
    // branch below falls back to candidates[0] and would otherwise let a
    // known-unembeddable URL through anyway.
    try {
      if (UNEMBEDDABLE_IMAGE_HOSTS.has(new URL(url).hostname.toLowerCase())) return
    } catch {
      return
    }
    candidates.push(url)
  }

  // media:content — prefer the widest declared variant.
  const media = item['media:content']
  if (Array.isArray(media)) {
    const images = media
      .filter((m) => {
        const type = String(m?.['@_type'] ?? '')
        const medium = String(m?.['@_medium'] ?? '')
        return medium === 'image' || type.startsWith('image/') || (!type && !medium)
      })
      .sort((a, b) => Number(b?.['@_width'] ?? 0) - Number(a?.['@_width'] ?? 0))
    for (const m of images) push(m?.['@_url'])
  }

  push(item['media:thumbnail']?.['@_url'])
  push(item['media:thumbnail'])

  const group = item['media:group']?.['media:content']
  if (Array.isArray(group)) for (const m of group) push(m?.['@_url'])

  if (Array.isArray(item.enclosure)) {
    for (const enc of item.enclosure) {
      const type = String(enc?.['@_type'] ?? '')
      const url = String(enc?.['@_url'] ?? '')
      if (type.startsWith('image/') || isUsableImage(url)) push(url)
    }
  }

  push(item['itunes:image']?.['@_href'])
  push(item.image?.url ?? item.image)

  // Last resort: first sensible <img> in the body HTML.
  const html = [
    text(item['content:encoded']),
    text(item.content),
    text(item.description),
    text(item.summary),
  ].join(' ')
  for (const match of html.matchAll(/<img[^>]+?src=["']([^"']+)["']/gi)) push(match[1])
  // Some publishers only ship srcset.
  for (const match of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
    const widest = String(match[1])
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop()
    push(widest)
  }

  return candidates.find(isUsableImage) ?? candidates[0] ?? null
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function itemLink(item, base) {
  // Atom: prefer rel="alternate" text/html over self and enclosure links.
  if (Array.isArray(item.link)) {
    const links = item.link.filter((l) => typeof l === 'object')
    const alternate =
      links.find(
        (l) => l['@_rel'] === 'alternate' && String(l['@_type'] ?? '').includes('html')
      ) ??
      links.find((l) => l['@_rel'] === 'alternate') ??
      links.find((l) => !l['@_rel'])
    const url = cleanUrl(alternate?.['@_href'] ?? text(item.link), base)
    if (url) return url
  }
  for (const candidate of [item.link, item['feedburner:origLink'], item.guid, item.id]) {
    const url = cleanUrl(text(candidate), base)
    if (url) return url
  }
  return ''
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeItem(item, feed, topic) {
  const title = stripHtml(text(item.title))
  const url = itemLink(item, feed.url)
  if (!title || !url || title.length < 8) return null

  const publishedAt = parseDate(
    item.pubDate,
    item.published,
    item.updated,
    item['dc:date'],
    item.date,
    item['a10:updated']
  )

  const rawSummary =
    text(item.description) ||
    text(item.summary) ||
    text(item['media:description']) ||
    text(item['content:encoded']) ||
    text(item.content)

  let summary = truncate(stripHtml(rawSummary), SUMMARY_MAX)
  // A summary that merely repeats the headline is worse than no summary.
  if (
    titleKey(summary).startsWith(titleKey(title).slice(0, 40)) &&
    summary.length < title.length + 24
  ) {
    summary = ''
  }

  const author = stripHtml(
    text(item['dc:creator']) || text(item.author?.name) || text(item.author) || ''
  ).slice(0, 60)

  return {
    id: hash(dedupeKey(url)),
    topic,
    title,
    url,
    summary,
    image: pickImage(item, feed.url),
    source: feed.name,
    sourceHost: safeHost(url),
    author: author && !/^https?:/i.test(author) ? author : '',
    publishedAt,
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchFeed(feed, topic) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const body = await res.text()
    if (!/<(rss|feed|rdf:RDF)/i.test(body)) throw new Error('not a feed')

    const doc = parser.parse(body)
    const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'] ?? doc?.feed ?? {}
    const rawItems = channel.item ?? channel.entry ?? doc?.feed?.entry ?? []

    const items = []
    for (const raw of Array.isArray(rawItems) ? rawItems : [rawItems]) {
      const item = normalizeItem(raw, feed, topic)
      if (item) items.push(item)
    }
    return { ok: true, feed: feed.name, count: items.length, items }
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message ?? 'error')
    return { ok: false, feed: feed.name, url: feed.url, reason, items: [] }
  } finally {
    clearTimeout(timer)
  }
}

/** Bounded parallelism: fast, but never 40 sockets at once. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function dedupe(items) {
  const byId = new Set()
  const byTitle = new Set()
  const out = []
  for (const item of items) {
    const tkey = titleKey(item.title)
    if (byId.has(item.id) || (tkey && byTitle.has(tkey))) continue
    byId.add(item.id)
    if (tkey) byTitle.add(tkey)
    out.push(item)
  }
  return out
}

function byNewest(a, b) {
  return (Date.parse(b.publishedAt ?? 0) || 0) - (Date.parse(a.publishedAt ?? 0) || 0)
}

/**
 * Ranking for the front page. Recency dominates, but artwork and a real
 * summary count because the lead slot is a large image well: a great story
 * with no picture makes a worse lead than a good story with one.
 */
function prominence(item, now) {
  const published = Date.parse(item.publishedAt ?? '') || now - 48 * 3600_000
  const ageHours = Math.max(0, (now - published) / 3600_000)
  let score = 100 - Math.min(72, ageHours) * 1.15
  if (item.image) score += 26
  if (item.summary.length > 90) score += 9
  else if (item.summary) score += 4
  return score
}

/**
 * Round-robin across topics so the front page shows range. Without this the
 * ranking is honest but lopsided: whichever section published most recently
 * takes the whole first screen, and a five-topic app looks like a sports app.
 */
function interleaveByTopic(items, topicOrder) {
  const queues = new Map(topicOrder.map((topic) => [topic, []]))
  for (const item of items) queues.get(item.topic)?.push(item)

  const out = []
  let placed = true
  while (placed) {
    placed = false
    for (const topic of topicOrder) {
      const next = queues.get(topic)?.shift()
      if (next) {
        out.push(next)
        placed = true
      }
    }
  }
  return out
}

/** Keeps one prolific publisher from owning a whole screen. */
function spreadBySource(items, maxRun = 2) {
  const out = []
  const pending = [...items]
  let guard = 0
  while (pending.length && guard++ < pending.length * 4 + 50) {
    let index = pending.findIndex((candidate) => {
      const run = out.slice(-maxRun)
      return run.length < maxRun || !run.every((prev) => prev.source === candidate.source)
    })
    if (index === -1) index = 0
    out.push(pending.splice(index, 1)[0])
  }
  return [...out, ...pending]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now()
  const config = JSON.parse(await readFile(resolve(HERE, 'feeds.json'), 'utf8'))
  const now = Date.now()
  const cutoff = now - MAX_AGE_DAYS * 86_400_000
  const topicNames = Object.keys(config).filter((k) => k !== 'rejected')

  const jobs = []
  for (const topic of topicNames) {
    for (const feed of config[topic]) jobs.push({ topic, feed })
  }

  console.log(`\n  Pulse · pulling ${jobs.length} feeds across ${topicNames.length} topics\n`)

  const results = await mapLimit(jobs, CONCURRENCY, ({ feed, topic }) => fetchFeed(feed, topic))

  const byTopic = new Map()
  const failures = []
  for (const result of results) {
    if (!result.ok) {
      failures.push(result)
      continue
    }
    for (const item of result.items) {
      if (!byTopic.has(item.topic)) byTopic.set(item.topic, [])
      byTopic.get(item.topic).push(item)
    }
  }

  await mkdir(OUT_DIR, { recursive: true })

  const generatedAt = new Date(now).toISOString()
  const topicSummaries = []
  const everything = []

  for (const topic of topicNames) {
    const fresh = (byTopic.get(topic) ?? []).filter((item) => {
      const published = Date.parse(item.publishedAt ?? '')
      // Undated items are kept — plenty of good feeds omit dates — but they
      // are stamped with the run time so the UI always has something to show.
      if (!Number.isFinite(published)) {
        item.publishedAt = generatedAt
        item.dateEstimated = true
        return true
      }
      return published >= cutoff
    })

    const ranked = dedupe(fresh).sort(byNewest)
    const articles = spreadBySource(ranked).slice(0, PER_TOPIC_LIMIT)
    const sources = new Set(articles.map((a) => a.source)).size

    await writeFile(
      resolve(OUT_DIR, `${topic}.json`),
      `${JSON.stringify({ topic, generatedAt, count: articles.length, articles })}\n`
    )

    topicSummaries.push({
      topic,
      count: articles.length,
      sources,
      newestAt: articles[0]?.publishedAt ?? null,
    })
    everything.push(...articles)

    console.log(
      `  ${topic.padEnd(10)} ${String(articles.length).padStart(3)} stories · ${sources} sources`
    )
  }

  // Front page: rank everything, take each topic's best in rotation, then
  // break up any publisher that still lands twice in a row.
  const highlights = spreadBySource(
    interleaveByTopic(
      dedupe(everything).sort((a, b) => prominence(b, now) - prominence(a, now)),
      topicNames
    ).slice(0, 90),
    1
  )

  await writeFile(
    resolve(OUT_DIR, 'index.json'),
    `${JSON.stringify({
      generatedAt,
      refreshIntervalHours: 6,
      nextRefreshAt: new Date(now + 6 * 3600_000).toISOString(),
      totalArticles: everything.length,
      topics: topicSummaries,
      feedsAttempted: jobs.length,
      feedsFailed: failures.length,
      failures: failures.map((f) => ({ feed: f.feed, reason: f.reason })),
      highlights,
    })}\n`
  )

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n  ${everything.length} stories written to public/data in ${seconds}s`)
  if (failures.length) {
    console.log(`  ${failures.length} feed(s) unavailable this run:`)
    for (const f of failures) console.log(`    · ${f.feed} — ${f.reason}`)
  }
  console.log('')

  // Only a total wipeout is a build failure; individual publishers break often.
  if (everything.length === 0) {
    console.error('  No stories fetched at all — refusing to publish an empty issue.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n  Feed pipeline crashed:', err)
  process.exit(1)
})
