#!/usr/bin/env node
/*
 * BlueLink feed pipeline.
 *
 * Reads scripts/feeds.json, pulls every RSS/Atom feed plus the public Atom feed
 * of each curated YouTube channel, normalises everything into one article
 * shape, de-duplicates across publishers, keeps the best twenty per section,
 * then enriches those twenty by reading the article page itself. The result is
 * static JSON in public/data/. The app never talks to a publisher — it reads
 * these files. That keeps the client free of CORS proxies and API keys, and
 * means a publisher going down degrades one section instead of the whole app.
 *
 * Four stages:
 *   1. collect   — every news feed and creator feed, in parallel
 *   2. select    — rank on recency + source tier + completeness, keep 20
 *   3. enrich    — fetch each kept page for real artwork and a longer excerpt
 *   4. write     — one file per section, plus index.json and youtube.json
 *
 * Run manually with `npm run news`; in production the GitHub Actions cron in
 * .github/workflows/refresh-news.yml runs it every four hours and commits the
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
/**
 * Stories kept per topic. Twenty is a deliberate edit rather than a technical
 * limit: a section you can finish reading is worth more than an endless scroll,
 * and it is few enough that every one of them can be enriched by fetching the
 * page (see enrichArticle) inside a single scheduled run.
 */
const PER_TOPIC_LIMIT = 15
/** Slots one publisher may hold in a section, before backfill. */
const PER_SOURCE_CAP = 4
/** Front-page rotation. Seven sections at a handful each, then ranking decides. */
const HIGHLIGHT_LIMIT = 42
/** The card dek. Two or three lines under a headline. */
const SUMMARY_MAX = 300
/**
 * Plain-text ceiling for a candidate body. Past this a field is a full article
 * dump rather than an excerpt, and preferring it would mean truncating from a
 * worse starting point than a purpose-written standfirst.
 */
const SUMMARY_SOURCE_MAX = 4000
/** A boilerplate rule that would leave less than this is skipped. */
const SUMMARY_MIN_AFTER_STRIP = 40

// --- Enrichment (stage 3) --------------------------------------------------
/** Paragraphs of real reporting kept for the reader, beyond the dek. */
const BODY_MAX_PARAGRAPHS = 4
const BODY_MAX_CHARS = 1200
/**
 * The reader shows bullets rather than paragraphs, so the excerpt is reduced to
 * a handful of the most informative sentences. Four is the point where a reader
 * still takes the whole thing in at a glance.
 */
const POINTS_MAX = 4
const POINT_MAX_CHARS = 200
/** A sentence outside this range is a fragment or a paragraph, not a point. */
const POINT_MIN_CHARS = 45
const POINT_SOURCE_MAX = 320
/** A candidate paragraph outside this range is furniture, not prose. */
const PARAGRAPH_MIN = 60
const PARAGRAPH_MAX = 700
/** Page fetches are slower and flakier than feeds, so they run wider. */
const ENRICH_CONCURRENCY = 10
const PAGE_TIMEOUT_MS = 14_000
/** Only the first slice of a page is parsed; article HTML is front-loaded. */
const PAGE_MAX_BYTES = 600_000

// --- YouTube ---------------------------------------------------------------
/** Videos shown under a section's news. A rail, not a second feed. */
const VIDEOS_PER_TOPIC = 8
/** The trending board. */
const YOUTUBE_LIMIT = 20
/** A three-week-old upload is not what is trending right now. */
const VIDEO_MAX_AGE_DAYS = 12
/** How far down the video ranking the Shorts check bothers to look. */
const SHORTS_CHECK_LIMIT = 60
/**
 * YouTube is fetched far more gently than the news feeds.
 *
 * The channel feeds and the Shorts probe all hit one host, and 51 channels in a
 * burst — plus a HEAD for every candidate — is enough to get that host answering
 * 404 to everything for a while. It is not an outage and not the User-Agent: the
 * same request succeeds again later. So the pull is narrow, spaced, and retried.
 */
const CREATOR_CONCURRENCY = 4
const CREATOR_RETRIES = 3
const CREATOR_RETRY_MS = 700

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

/**
 * Marks where a block element ended, so joinBlocks can punctuate the seam.
 *
 * A NUL is the sentinel because it cannot appear in feed text and cannot be
 * produced by entity decoding either — safeCodePoint rejects anything below 9
 * — so splitting on it is unambiguous where splitting on a space would not be.
 * Written as an escape rather than the character itself, so the file stays
 * plain text to every tool that reads it.
 */
const BLOCK_BREAK = '\u0000'

/**
 * Rejoin the pieces a block element separated, adding the full stop the markup
 * was carrying.
 *
 * Without this, a publisher whose feed summary is a standfirst followed by the
 * first paragraph — the Guardian does exactly that — reads as one runaway
 * sentence: "…products that harm young people More than half of the states…".
 * The tag was the punctuation, and dropping it silently corrupts the prose.
 */
function joinBlocks(input) {
  const parts = input
    .split(BLOCK_BREAK)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  let out = ''
  for (const part of parts) {
    if (!out) {
      out = part
      continue
    }
    out += /[.!?:;,…"”’)\]-]$/.test(out) ? ' ' : '. '
    out += part
  }
  return out
}

function stripHtml(input) {
  return (
    joinBlocks(
      decodeEntities(
        String(input)
          // Drop whole blocks whose text content is never prose.
          .replace(/<(script|style|figcaption)[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, BLOCK_BREAK)
          .replace(/<[^>]+>/g, ' ')
      )
    )
      /*
       * Reattach a drop cap. Publishers set the opening letter in its own
       * element, and replacing that element with a space — which every other tag
       * needs — leaves "B uying a vacuum cleaner". Only the very first letter is
       * treated this way, and A and I are excluded, because "A quick fix" and
       * "I went back" are sentences rather than drop caps.
       */
      .replace(/^([B-HJ-Z]) (?=[a-z]{2})/, '$1')
  )
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

/**
 * Comparison form for a block of prose: casing and punctuation removed, length
 * untouched. Deliberately not titleKey, which caps at 90 characters — fine for
 * a headline, useless for deciding whether a 400-character paragraph is already
 * inside the dek.
 */
function proseKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

/**
 * Publisher furniture that carries no information: syndication footers, "read
 * on" markers, share/related link lists and attribution tails. Each rule is
 * applied once, in order, by stripBoilerplate.
 */
const BOILERPLATE_RULES = [
  // Leading byline: "By Jane Doe —" / "By Jane Doe,".
  { name: 'leadingByline', re: /^\s*By\s+[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3}\s*(?:—|–|-|,)\s+/ },
  // WordPress/FeedBurner footer: "The post <headline> appeared first on <Publisher>."
  { name: 'syndicationFooter', re: /\s*The post\b[\s\S]{0,300}?\bappeared first on\b[^.]{0,120}\.?/gi },
  // "Share this:" and the sharing furniture that follows it.
  { name: 'shareTail', re: /\s*\bShare this\b\s*:?[\s\S]*$/i },
  // "Related:" / "Related Stories:" — everything after is a link list.
  { name: 'relatedTail', re: /\s*\bRelated(?:\s+(?:Stories|Reading|Articles|Posts))?\s*:[\s\S]*$/i },
  // Markers left where the feed cut the article off.
  {
    name: 'continuationMarkers',
    re: /\s*(?:\[\s*(?:…|\.{2,})\s*\]|\bContinue reading\b[^.]{0,80}|\bRead (?:more|the full story|the full article)\b[^.]{0,80})\s*[.…]*/gi,
  },
  // Ars Technica ships a bare "Enlarge" as the lead-image link text.
  { name: 'enlargeMarker', re: /^Enlarge\s*\/?\s*/ },
  // A picture credit that arrived as body text rather than a <figcaption>:
  // "CT scan of a narwhal tusk: Credit: Adrian Rodriguez Palomo/CC BY-NC."
  // Anchored to the start and bounded, so a "Credit:" inside real prose later in
  // the piece is left alone.
  {
    name: 'leadingCredit',
    re: /^(?:Enlarge\s*\/?\s*)?[^.]{0,120}?\b(?:Credit|Photo|Image|Photograph|Illustration|Picture)s?\s*:\s*[^.]{1,90}\.\s+(?=[A-Z])/,
  },
  // A label the publisher set as a bold run rather than a heading, so it
  // arrived welded to the first sentence: "Summary Clash Royale is updating…".
  {
    name: 'leadingLabel',
    re: /^\s*(?:summary|overview|tl;?\s?dr|in short|key points?|the gist)\s*[:\-\u2013\u2014]?\s+(?=[A-Z])/i,
  },
  // Trailing attribution: "Source: Foo" / "via Foo".
  { name: 'trailingSource', re: /\s*(?:Source\s*:\s*|[Vv]ia\s+)[A-Z][^.\n]{0,40}\s*$/ },
  // Two or more bullet-led fragments at the end: a related-links list that lost
  // its markup on the way through the feed. One bullet is left alone, because a
  // single one is as likely to be part of the sentence.
  { name: 'bulletTail', re: /(?:\s*[•·]\s*[^•·]{5,90}){2,}\s*$/ },
]

/**
 * Conservative by design: a rule that would leave almost nothing behind has
 * over-matched, so its effect is dropped rather than emptying the summary.
 */
function stripBoilerplate(input) {
  let out = String(input).trim()
  for (const rule of BOILERPLATE_RULES) {
    const next = out.replace(rule.re, ' ').replace(/\s+/g, ' ').trim()
    if (next === out) continue
    if (next.length < SUMMARY_MIN_AFTER_STRIP && out.length >= SUMMARY_MIN_AFTER_STRIP) continue
    out = next
  }
  return out.replace(/\s+([,.;:!?])/g, '$1').trim()
}

/**
 * Feeds disagree about which field holds the real prose: `description` is often
 * a one-line teaser while `content:encoded` carries the article. So collect
 * every candidate, clean each, and keep the longest that still reads as an
 * excerpt rather than a whole page.
 */
function pickSummarySource(item) {
  const candidates = [
    item.description,
    item.summary,
    item['media:description'],
    item['content:encoded'],
    item.content,
    item['dc:description'],
    item.subtitle,
  ]

  let best = ''
  let oversized = ''
  for (const candidate of candidates) {
    const plain = stripBoilerplate(stripHtml(text(candidate)))
    if (!plain) continue
    if (plain.length > SUMMARY_SOURCE_MAX) {
      // Only used if nothing sane exists — better than reporting no summary.
      if (!oversized) oversized = plain.slice(0, SUMMARY_SOURCE_MAX)
      continue
    }
    if (plain.length > best.length) best = plain
  }
  return best || oversized
}

/**
 * The richest HTML the feed carries, left as markup so paragraph boundaries
 * survive. `description` is usually a teaser; `content:encoded` is where a
 * publisher that syndicates properly puts the article.
 */
function pickContentHtml(item) {
  let best = ''
  for (const candidate of [item['content:encoded'], item.content, item.description, item.summary]) {
    const html = typeof candidate === 'string' ? candidate : text(candidate)
    if (html.length > best.length) best = html
  }
  return best
}

/**
 * A summary that merely repeats the headline is worse than no summary. When a
 * longer summary only *opens* with the headline, drop that duplicated sentence
 * and keep the real reporting underneath it.
 */
function dropEchoedHeadline(summary, title) {
  const key = titleKey(title)
  if (!summary || !key) return summary
  if (!titleKey(summary).startsWith(key.slice(0, 40))) return summary

  const opener = summary.match(/^[\s\S]*?[.!?…](?:\s+|$)/)
  if (opener) {
    const rest = summary.slice(opener[0].length).trim()
    // Only a genuine restatement — a lead paragraph that happens to start with
    // the headline's words is real prose and must survive intact.
    const echoes = titleKey(opener[0]).length <= key.length + 20
    if (echoes && rest.length >= 60 && !titleKey(rest).startsWith(key.slice(0, 40))) return rest
  }
  return summary.length < title.length + 24 ? '' : summary
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

/**
 * Commerce and SEO filler that arrives through otherwise excellent feeds:
 * coupon pages, affiliate deal roundups, horoscopes, live-blog stubs. It is
 * published by the same newsroom, so tier cannot catch it — only the headline
 * can. Dropped outright rather than demoted, because a section of twenty has no
 * room to be charitable.
 */
const LOW_VALUE_TITLE = new RegExp(
  [
    // Affiliate and commerce
    'promo code|coupon|discount code|best deals|save \\d+%|\\d+% off|gift guide',
    '\\bdeals?\\b.*\\b(?:today|week|month|now)\\b',
    // Shopping roundups: "The best vacuum cleaners in the UK…" is a storefront
    // with a byline, and it should never lead a technology section.
    '^(?:the )?best\\b(?=.*\\b(?:for|of|in|under|we tested|tested)\\b)',
    '\\bbuying guide\\b|\\bworth buying\\b|\\bwhere to buy\\b',
    // Puzzles, horoscopes and other daily filler
    'horoscope|\\bsudoku\\b|crossword|word(?:le)? answer|quiz:|puzzle',
    // Live-blog stubs, which are a page of timestamps rather than a story
    'as it happened|live updates? —|liveblog|sponsored',
  ].join('|'),
  'i'
)

/**
 * True when a feed with a `match` list has nothing to do with this section. No
 * publisher runs a Clash Royale feed, so that section is built by taking the
 * mobile-gaming and esports feeds and keeping only what mentions the games.
 * Matched against the headline and the raw summary, since a match in the body
 * alone usually means the story is about something else entirely.
 */
function matchesFeed(feed, title, summary) {
  if (!Array.isArray(feed.match) || feed.match.length === 0) return true
  const haystack = `${title} ${summary}`.toLowerCase()
  return feed.match.some((term) => haystack.includes(String(term).toLowerCase()))
}

function normalizeItem(item, feed, topic) {
  const title = stripHtml(text(item.title))
  const url = itemLink(item, feed.url)
  if (!title || !url || title.length < 8) return null
  if (LOW_VALUE_TITLE.test(title)) return null

  const publishedAt = parseDate(
    item.pubDate,
    item.published,
    item.updated,
    item['dc:date'],
    item.date,
    item['a10:updated']
  )

  const summary = truncate(
    dropEchoedHeadline(pickSummarySource(item), title),
    SUMMARY_MAX
  )

  /*
   * Ars Technica, GameSpot and PC Gamer all ship several paragraphs of real
   * article inside the feed and all three refuse a plain server fetch of the
   * page, so mining the feed here is not a fallback — for those publishers it
   * is the only excerpt the reader will ever get. enrichArticle overrides this
   * later only if the page turns out to give more.
   */
  if (!matchesFeed(feed, title, summary)) return null

  const body = buildBody(htmlParagraphs(pickContentHtml(item)), summary)
  const points = buildPoints(summary, body, title)
  const tags = buildTags(item, title, topic)

  const author = stripHtml(
    text(item['dc:creator']) || text(item.author?.name) || text(item.author) || ''
  ).slice(0, 60)

  const image = pickImage(item, feed.url)

  return {
    id: hash(dedupeKey(url)),
    kind: 'article',
    topic,
    title,
    url,
    summary,
    body,
    points,
    tags,
    image,
    imageFrom: image ? 'feed' : null,
    imageCredit: null,
    imageCreditUrl: null,
    source: feed.name,
    sourceHost: safeHost(url),
    /** 1 = major newsroom or primary source. Used by rank(), shown as a mark. */
    tier: Number(feed.tier) || 2,
    author: author && !/^https?:/i.test(author) ? author : '',
    publishedAt,
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * `extract` lets a caller take over turning the parsed document into items —
 * used for YouTube's Atom feed, whose entries carry a video rather than an
 * article and need their own normaliser.
 */
async function fetchFeed(feed, topic, extract) {
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
    if (extract) {
      const items = extract(doc)
      return { ok: true, feed: feed.name, count: items.length, items }
    }

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
// Enrichment — a feed entry is a teaser; the page is the story.
//
// Every kept article is fetched once and mined for two things the feed usually
// withholds: the real lead artwork (which is why a third of the grid used to
// show fallback plates) and a few paragraphs of actual reporting, so opening a
// story gives you something to read instead of a headline and a link.
//
// Runs on the final twenty per section only. Enriching everything the feeds
// return would be ~1,500 requests; enriching the edition is ~120.
// ---------------------------------------------------------------------------

async function fetchPage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (type && !/html|xml/i.test(type)) return null
    const body = await res.text()
    return body.slice(0, PAGE_MAX_BYTES)
  } catch {
    // Paywalls, bot walls and timeouts are all normal here. The article simply
    // keeps whatever the feed gave it.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** First matching <meta> content for any of `names`, in the order given. */
function metaContent(html, names) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const name of names) {
    const wanted = new RegExp(`(?:property|name|itemprop)\\s*=\\s*["']${name}["']`, 'i')
    for (const tag of tags) {
      if (!wanted.test(tag)) continue
      const value = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]
      if (value) return decodeEntities(value).trim()
    }
  }
  return ''
}

function pageImage(html, base) {
  const meta = metaContent(html, [
    'og:image:secure_url',
    'og:image',
    'twitter:image',
    'twitter:image:src',
  ])
  const candidates = [meta]

  const linked = html.match(/<link[^>]+rel=["']image_src["'][^>]*>/i)?.[0]
  if (linked) candidates.push(linked.match(/href=["']([^"']+)["']/i)?.[1] ?? '')

  // Schema.org blocks: "image": "…" or "image": { "url": "…" }.
  for (const match of html.matchAll(/"image"\s*:\s*(?:\{[^{}]*?"url"\s*:\s*)?"([^"]{12,})"/g)) {
    candidates.push(match[1])
  }

  // Last resort: the widest-looking <img> in the document body.
  for (const match of html.matchAll(/<img\b[^>]+?src=["']([^"']{20,})["'][^>]*>/gi)) {
    candidates.push(match[1])
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    const url = cleanUrl(candidate.replace(/\\\//g, '/'), base)
    if (url && isUsableImage(url)) return url
  }
  return null
}

/**
 * Furniture that reads like a sentence but carries no reporting: consent
 * notices, newsletter pitches, legal tails, share prompts.
 */
const JUNK_PARAGRAPH =
  /(cookies?\b|consent|newsletter|sign\s?up|subscribe|advertisement|all rights reserved|terms of (?:use|service)|privacy policy|follow us on|share this|©\s?\d{4}|enable javascript|ad-?block|you(?:'| a)re reading|this article (?:is|was) (?:originally )?published)/i

function htmlParagraphs(html) {
  // Everything that is definitely not article prose, removed before matching so
  // a nav or footer paragraph never wins.
  const scoped = html
    .replace(/<(script|style|noscript|template|svg|form|aside|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ')

  const seen = new Set()
  const out = []
  for (const match of scoped.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const plain = stripBoilerplate(stripHtml(match[1]))
    if (plain.length < PARAGRAPH_MIN || plain.length > PARAGRAPH_MAX) continue
    // Real prose ends sentences. Bylines, tags and captions usually do not.
    if (!/[.!?]["'’”]?$/.test(plain)) continue
    if (JUNK_PARAGRAPH.test(plain)) continue
    // A wall of links or a stat block: too few spaces for its length.
    if (plain.split(' ').length < 12) continue
    const key = plain.slice(0, 60).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(plain)
    if (out.length >= 12) break
  }
  return out
}

/**
 * Drop anything the dek already said, then keep the opening few paragraphs.
 *
 * The containment test matters: plenty of publishers build the feed summary out
 * of the standfirst *plus* the first paragraph, so a prefix comparison passes
 * while the reader gets the same sentence twice in a row.
 */
function buildBody(paragraphs, summary) {
  const dek = proseKey(summary)
  /*
   * The dek is truncated, so when a publisher builds it out of the standfirst
   * plus the opening paragraph it ends mid-sentence — and the two prefix tests
   * below both miss, because the shared text sits at the *end* of the dek and
   * the *start* of the paragraph. Matching on the dek's tail is what actually
   * catches it, and without it the reader shows the same sentence twice.
   */
  const dekTail = dek.slice(-40)
  const body = []
  let total = 0
  for (const paragraph of paragraphs) {
    const key = proseKey(paragraph)
    const opening = key.slice(0, 70)
    if (dek && opening && (dek.includes(opening) || key.includes(dek.slice(0, 70)))) continue
    if (dekTail.length >= 24 && key.includes(dekTail)) continue
    if (total + paragraph.length > BODY_MAX_CHARS && body.length) break
    body.push(paragraph)
    total += paragraph.length
    if (body.length >= BODY_MAX_PARAGRAPHS) break
  }
  return body
}

async function enrichArticle(article) {
  const html = await fetchPage(article.url)
  if (!html) return article

  if (!article.image) {
    const image = pageImage(html, article.url)
    if (image) {
      article.image = image
      article.imageFrom = 'page'
    }
  }

  const paragraphs = htmlParagraphs(html)

  // A feed that shipped only a headline gets its dek from the page too.
  if (article.summary.length < 90) {
    const better =
      metaContent(html, ['og:description', 'twitter:description', 'description']) ||
      paragraphs[0] ||
      ''
    const cleaned = truncate(dropEchoedHeadline(stripBoilerplate(better), article.title), SUMMARY_MAX)
    if (cleaned.length > article.summary.length) article.summary = cleaned
  }

  /*
   * Keep whichever excerpt is longer. The page is usually richer, but plenty of
   * hosts answer a server fetch with a consent wall that is a valid 200 and
   * contains no article at all — Ars Technica and PC Gamer both do, and both
   * syndicate several real paragraphs in the feed. Overwriting unconditionally
   * threw those away.
   */
  const fromPage = buildBody(paragraphs, article.summary)
  const weight = (body) => body.reduce((sum, p) => sum + p.length, 0)
  if (weight(fromPage) > weight(article.body)) article.body = fromPage

  // The bullets are only as good as the text they were drawn from, and the page
  // has usually just improved on the feed.
  article.points = buildPoints(article.summary, article.body, article.title)

  return article
}

const STOPWORDS = new Set(
  ('the a an and or but for nor of to in on at by from with without as is are was were be been ' +
    'being it its this that these those his her their our your my not no so than then there here ' +
    'what which who whom how why when where will would can could should may might must have has had ' +
    'do does did done say says said new now more most also just after before over under about into ' +
    'up down out off again once all any both each few other some such only own same too very s t don ' +
    'you we they he she i me him them us if because while during against between among').split(' ')
)

// --- Topics ----------------------------------------------------------------

/*
 * What a story is about, in two or three words.
 *
 * Taken from the feed's own <category> elements wherever they exist, because
 * that is the publisher saying what they filed it under — a better answer than
 * anything guessed from the prose. Where a feed ships none, the proper nouns in
 * the headline stand in.
 */

/** Categories that say nothing: a section name, a site name, a CMS default. */
const EMPTY_TAG =
  /^(news|uncategorized|uncategorised|general|featured?|features|home|top ?stories|latest|article|blog|all|misc|other|updates?|rss|feed|main|posts?|content|editorial|summary|opinion|video|photos?|slideshow|free|paid|premium|exclusive|breaking)$/i

/**
 * Words that only restate the section. "Gaming" under Games and "Film" under
 * Movies are not topics, they are the shelf the story is already on.
 */
const SECTION_SYNONYMS = {
  tech: ['tech', 'technology', 'gadgets', 'computing'],
  ai: ['ai', 'artificial intelligence', 'machine learning', 'ml'],
  sports: ['sport', 'sports'],
  games: ['games', 'gaming', 'game', 'video games', 'videogames'],
  arena: ['mobile games', 'mobile gaming'],
  movies: ['movies', 'movie', 'film', 'films', 'cinema'],
  lifestyle: ['lifestyle', 'life and style', 'living'],
  youtube: ['youtube'],
}

const TAG_MAX = 4
const TAG_MAX_CHARS = 26

/** Title Case, but leaving acronyms and hyphenated names alone. */
function titleCaseTag(value) {
  return value
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 1) return word.toUpperCase()
      // Already shouting, or a mixed-case brand: leave it.
      if (word === word.toUpperCase() || /[a-z][A-Z]/.test(word)) return word
      return word[0].toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function buildTags(item, title, topic) {
  const raw = []
  for (const node of Array.isArray(item.category) ? item.category : [item.category]) {
    if (node == null) continue
    // Atom puts it in an attribute; RSS in the text.
    const value = typeof node === 'object' ? (node['@_term'] ?? node['@_label'] ?? text(node)) : node
    const cleaned = stripHtml(String(value ?? ''))
      .replace(/\s*[|/>·»]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) continue
    for (const part of cleaned.split(/\s*,\s*/)) raw.push(part.trim())
  }

  const seen = new Set([topic.toLowerCase(), ...(SECTION_SYNONYMS[topic] ?? [])])
  const tags = []
  for (const candidate of raw) {
    if (candidate.length < 3 || candidate.length > TAG_MAX_CHARS) continue
    if (EMPTY_TAG.test(candidate)) continue
    // A slug, an id, or a URL fragment rather than a subject.
    if (!/^[\w&'’.\- ]+$/u.test(candidate)) continue
    if (/^\d+$/.test(candidate)) continue
    const key = candidate.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(titleCaseTag(candidate))
    if (tags.length >= TAG_MAX) break
  }

  /*
   * No fallback. An earlier version filled the gap with the capitalised words
   * from the headline and produced "Watch, Daily, Schedule" — three words that
   * describe nothing. Where a publisher files nothing, the reader shows the
   * section alone, which is at least true.
   */
  return tags
}

// --- The short version -----------------------------------------------------

/*
 * Bullets, not paragraphs.
 *
 * A news app is read standing up, so the reader leads with three or four points
 * rather than an excerpt you have to work through. These are extracted, never
 * generated: each bullet is a sentence the publisher actually wrote, picked for
 * how much it carries. Nothing is paraphrased, because paraphrasing someone
 * else's reporting without their words is how a summary starts saying things the
 * article did not.
 */

/** Split prose into sentences without breaking on "U.S." or "Mr. Smith". */
function splitSentences(text) {
  const guarded = String(text)
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Co|Corp|Gen|Sgt|Capt|Rev|Hon|Est|approx|No)\.\s/g,
      (m) => m.replace('.', '\u0001'))
    // Initials and acronyms: U.S., U.K., A.I., 3.5, $1.2bn.
    .replace(/\b([A-Z])\.(?=[A-Z]\.)/g, '$1\u0001')
    .replace(/\b([A-Z])\.(?=\s[a-z])/g, '$1\u0001')
    .replace(/(\d)\.(?=\d)/g, '$1\u0001')

  return guarded
    // A truncation ellipsis ends a sentence too, and treating it as one is what
    // stops a cut-off dek from being welded to the paragraph that follows it.
    .split(/(?<=[.!?\u2026])["\u2019\u201d)]?\s+(?=["\u201c(]?[A-Z0-9])/)
    .map((part) => part.replace(/\u0001/g, '.').trim())
    .filter(Boolean)
}

/** Words the headline is about, used to score a sentence's relevance. */
function titleTerms(title) {
  return new Set(
    proseKey(title)
      .split(' ')
      .filter((word) => word.length > 3 && !STOPWORDS.has(word))
  )
}

/**
 * How much a sentence earns its place: does it name what the headline is about,
 * does it carry a figure, a date or a quote — the things a reader is actually
 * scanning for — and is it a sentence rather than a fragment or a whole
 * paragraph. Earlier sentences win ties, because news is written top-down.
 */
function scoreSentence(sentence, terms, index) {
  const key = proseKey(sentence)
  const words = key.split(' ')
  if (words.length < 8) return -1

  let score = Math.max(0, 14 - index * 1.6)
  const overlap = words.filter((word) => terms.has(word)).length
  score += Math.min(12, overlap * 3)
  if (/\d/.test(sentence)) score += 5
  if (/[\u201c"\u2019']\s?[A-Z]/.test(sentence)) score += 3
  if (/\b(said|says|announced|confirmed|reported|according to|will|plans to|expected)\b/i.test(sentence)) score += 4
  if (/\b(per cent|percent|%|\$|\u00a3|\u20ac|million|billion)\b/i.test(sentence)) score += 3
  // Length: reward a full sentence, punish a paragraph masquerading as one.
  if (sentence.length > POINT_SOURCE_MAX) score -= 8
  else if (sentence.length < POINT_MIN_CHARS) score -= 6
  if (/\b(subscribe|newsletter|sign up|cookie|advertisement|follow us)\b/i.test(sentence)) score -= 20
  // An ellipsis means the source text was already cut short. Usable, but a
  // whole sentence saying the same thing is always better.
  if (/\u2026|\.\.\./.test(sentence)) score -= 7
  // A sentence past the cap will be cut mid-thought, so a shorter one that says
  // as much is worth more.
  if (sentence.length > POINT_MAX_CHARS) score -= 5
  return score
}

/**
 * Turn a story's dek and excerpt into the points the reader shows. Kept in the
 * order the publisher wrote them, so the bullets still read as an account of
 * events rather than a ranked list of facts.
 */
function buildPoints(summary, body, title) {
  const terms = titleTerms(title)
  const seen = new Set()
  const candidates = []

  /*
   * Each source block is split on its own rather than concatenated first. The
   * dek is a truncated string, so joining it to the body made its cut-off tail
   * and the article's opening line into one impossible sentence.
   */
  const sentences = [summary, ...body].flatMap((block) => splitSentences(block))

  for (const sentence of sentences) {
    if (sentence.length < POINT_MIN_CHARS) continue
    const key = proseKey(sentence).slice(0, 48)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const index = candidates.length
    const score = scoreSentence(sentence, terms, index)
    if (score <= 0) continue
    candidates.push({ sentence, score, index })
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, POINTS_MAX)
    .sort((a, b) => a.index - b.index)
    .map((candidate) => truncate(candidate.sentence, POINT_MAX_CHARS))
}

// --- Related artwork, for the few stories that still have none --------------


/**
 * Two or three words that name what the story is about. Proper nouns first —
 * they are the part of a headline a photo search can actually match.
 */
function imageKeywords(title) {
  const words = stripHtml(title).replace(/[^\w\s'’-]/g, ' ').split(/\s+/).filter(Boolean)
  const proper = []
  const plain = []
  for (const [index, word] of words.entries()) {
    const bare = word.replace(/['’]s$/, '')
    if (bare.length < 3 || STOPWORDS.has(bare.toLowerCase())) continue
    // A capitalised word that is not merely the first word of the sentence.
    if (index > 0 && /^[A-Z]/.test(bare) && !/^[A-Z]+$/.test(bare)) proper.push(bare)
    else if (/^[A-Z]{2,}$/.test(bare)) proper.push(bare)
    else plain.push(bare.toLowerCase())
  }
  const picked = [...proper.slice(0, 3)]
  for (const word of plain.sort((a, b) => b.length - a.length)) {
    if (picked.length >= 3) break
    picked.push(word)
  }
  return picked.join(' ').trim()
}

/**
 * Openverse: openly licensed photography, no API key, honest attribution.
 *
 * This is the last rung of the ladder and it is deliberately labelled in the
 * UI as a related picture rather than the publisher's own, because it is not
 * the story's artwork — it is a photograph of the same subject. Passing it off
 * as reporting would be a lie; leaving a grey plate in the grid is worse.
 */
async function relatedImage(query) {
  if (!query) return null
  const attempts = [
    `size=large&aspect_ratio=wide&category=photograph`,
    `size=medium&category=photograph`,
    ``,
  ]
  for (const filters of attempts) {
    const url =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
      `&page_size=6&mature=false${filters ? `&${filters}` : ''}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) continue
      const payload = await res.json()
      for (const hit of payload?.results ?? []) {
        const direct = cleanUrl(hit?.url ?? '', 'https://api.openverse.org/')
        const thumb = cleanUrl(hit?.thumbnail ?? '', 'https://api.openverse.org/')
        // Prefer the original file when it is large and plainly an image; the
        // Openverse thumbnail is the reliable fallback.
        const wide = Number(hit?.width) >= 800
        const picked = (wide && isUsableImage(direct) && direct) || thumb || direct
        if (!picked) continue
        const creator = stripHtml(hit?.creator ?? '').slice(0, 40)
        const license = String(hit?.license ?? '').toUpperCase()
        return {
          image: picked,
          credit:
            `Related photo · ${creator || hit?.provider || 'Openverse'}` +
            (license ? ` (${license})` : ''),
          creditUrl: cleanUrl(hit?.foreign_landing_url ?? '', 'https://openverse.org/') || null,
        }
      }
    } catch {
      // Openverse is a courtesy, not a dependency.
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// YouTube — the public per-channel Atom feed, no API key
// ---------------------------------------------------------------------------

/**
 * Creator descriptions are half pitch: affiliate blocks, merch links, socials,
 * chapter lists. Keep the sentences before all that starts.
 */
const VIDEO_PITCH =
  /\b(?:affiliate|sponsor(?:ed|s|ship)?|brought to you by|thanks to [A-Z]|discount code|promo code|use code|coupon|\d+% off|free trial|merch|patreon|shop now|pre-?order (?:yours|now|here)|subscribe|follow me|my socials|instagram|twitter|tiktok|check out my|i invented|link (?:below|in the description)|join (?:this channel|my))\b/i

function cleanVideoDescription(raw) {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
  const kept = []
  for (const line of lines) {
    if (!line) continue
    // Chapter list, timestamped rundown, credits block, or a bare link line.
    if (/^\d{1,2}:\d{2}/.test(line)) break
    if (/^(?:https?:\/\/|www\.)/i.test(line)) continue
    if (/^[-–—•*~=_\s]+$/.test(line)) continue
    if (/^(?:credits?|music|chapters?|timestamps?|filmed|edited|shot on|gear)\b.{0,24}:?$/i.test(line)) break
    if (VIDEO_PITCH.test(line)) {
      // Everything from the pitch onwards is promotional; before it, skip.
      if (kept.length) break
      continue
    }
    // Strip inline URLs but keep the sentence around them.
    const text = line
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s—–-]+$/, '')
      .trim()
    if (text.length < 25) continue
    kept.push(text)
    if (kept.join(' ').length > 700) break
  }
  return kept
}

/**
 * Shorts are a different medium: vertical, seconds long, and with no
 * description worth reading. They also win any views-per-hour race, so left in
 * they would take over the trending board.
 *
 * The public feed does not say which is which, but the Shorts player does — a
 * real Short answers /shorts/<id> with 200, while a normal upload redirects to
 * /watch. One HEAD request per candidate, which is cheap and needs no API key.
 */
async function isShort(video) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${video.videoId}`, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(9000),
    })
    return res.status === 200
  } catch {
    // Unknown: keep it. A missed Short is a smaller failure than a dropped
    // video, and the length heuristics below still apply.
    return false
  }
}

function normalizeVideo(entry, creator) {
  const videoId = text(entry['yt:videoId']).trim()
  const title = stripHtml(text(entry.title))
  if (!videoId || !/^[\w-]{8,15}$/.test(videoId) || title.length < 4) return null

  const group = entry['media:group'] ?? {}
  const paragraphs = cleanVideoDescription(decodeEntities(text(group['media:description'])))
  const summary = truncate(dropEchoedHeadline(paragraphs[0] ?? '', title), SUMMARY_MAX)
  const views = Number(group['media:community']?.['media:statistics']?.['@_views'] ?? 0)
  const rating = Number(group['media:community']?.['media:starRating']?.['@_count'] ?? 0)
  const channel = stripHtml(text(entry.author?.name)) || creator.name

  return {
    id: hash(`yt:${videoId}`),
    kind: 'video',
    topic: creator.topic,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    summary,
    body: summary ? paragraphs.slice(1, BODY_MAX_PARAGRAPHS) : paragraphs.slice(0, BODY_MAX_PARAGRAPHS),
    points: buildPoints(summary, paragraphs, title),
    tags: buildTags(entry, title, creator.topic),
    // Upgraded to the 16:9 master in bestThumbnail once the run knows it exists.
    image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    imageFrom: 'video',
    imageCredit: null,
    imageCreditUrl: null,
    source: channel,
    sourceHost: 'youtube.com',
    tier: 2,
    author: channel,
    publishedAt: parseDate(entry.published, entry.updated),
    videoId,
    channel,
    /** False for channels that feed their section rail but not the board. */
    onBoard: creator.board !== false,
    channelUrl: `https://www.youtube.com/channel/${creator.channelId}`,
    views: Number.isFinite(views) && views > 0 ? views : null,
    likes: Number.isFinite(rating) && rating > 0 ? rating : null,
  }
}

async function fetchCreator(creator) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${creator.channelId}`
  const result = await fetchFeed({ name: creator.name, url, tier: 2 }, creator.topic, (doc) => {
    const entries = doc?.feed?.entry ?? []
    const out = []
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      const video = normalizeVideo(entry, creator)
      if (video) out.push(video)
    }
    return out
  })
  return result
}

/**
 * hqdefault.jpg always exists but is 4:3 with black bars baked in, which looks
 * like a bug in a 16:9 card. maxresdefault only exists for HD uploads, so it is
 * checked rather than assumed.
 */
async function bestThumbnail(video) {
  // A video held over from a previous edition has already been through this, and
  // re-probing it would be two more requests to the host that is throttling us.
  if (!/\/(?:hq|mq)default\.jpg$/.test(video.image ?? '')) return video

  for (const name of ['maxresdefault', 'hq720']) {
    const candidate = `https://i.ytimg.com/vi/${video.videoId}/${name}.jpg`
    try {
      const res = await fetch(candidate, {
        method: 'HEAD',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok && Number(res.headers.get('content-length') ?? 1) > 2000) {
        video.image = candidate
        return video
      }
    } catch {
      // Fall through to the next name, then to the 4:3 default.
    }
  }
  // mqdefault is small but at least the right shape.
  video.image = `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`
  return video
}

/**
 * What is actually trending: views earned per hour since upload, tempered by a
 * plain recency term so a modest video published an hour ago can still lead.
 * Raw view counts alone would pin a 60-million-view MrBeast upload to the top
 * of the board for a fortnight.
 */
function videoScore(video, now) {
  const published = Date.parse(video.publishedAt ?? '') || now
  const ageHours = Math.max(1.5, (now - published) / 3600_000)
  const velocity = video.views ? Math.log10(video.views / ageHours + 1) * 26 : 0
  const recency = Math.max(0, 60 - ageHours * 0.42)
  // A clip with no description and a four-word title is filler, whatever its
  // view count. Something to actually watch and read about ranks above it.
  const substance = (video.summary.length > 80 ? 6 : video.summary ? 2 : -10) +
    (video.title.length < 26 ? -8 : 0)
  return velocity + recency + substance
}

/**
 * Retry a fetch that failed in a way that looks transient.
 *
 * Deliberately treats 404 as retryable, which is normally wrong — but this is
 * only used for YouTube's feed endpoint, which answers 404 when it is shedding
 * load rather than when a channel is missing. A channel that is genuinely gone
 * costs three requests and then drops out; one that is merely throttled comes
 * back, which is the difference between a full video rail and an empty one.
 */
async function withRetry(attempt, attempts = CREATOR_RETRIES, delayMs = CREATOR_RETRY_MS) {
  let last = null
  for (let tries = 0; tries < attempts; tries += 1) {
    if (tries > 0) {
      // Spread the retries out so they do not arrive as another burst.
      const jitter = delayMs * tries + Math.floor(((tries * 37) % 11) * 40)
      await new Promise((resolve) => setTimeout(resolve, jitter))
    }
    last = await attempt()
    if (last.ok && last.items.length) return last
  }
  return last
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
 * How much a publisher's reliability is worth in a close call. Deliberately
 * smaller than the recency term: a tier-1 byline is a tie-breaker, not a
 * licence to lead the section with yesterday's story.
 */
const TIER_BONUS = { 1: 18, 2: 7, 3: 0 }

/**
 * Which twenty stories a section keeps. Recency still dominates — it is a news
 * app — but with only twenty slots the other three things that decide whether a
 * card is worth showing now count too: who reported it, whether there is
 * artwork, and whether there is enough text to be worth opening.
 */
function rank(item, now) {
  const published = Date.parse(item.publishedAt ?? '') || now - 48 * 3600_000
  const ageHours = Math.max(0, (now - published) / 3600_000)
  let score = 120 - Math.min(96, ageHours) * 1.05
  score += TIER_BONUS[item.tier] ?? 4
  if (item.image) score += 10
  if (item.summary.length > 140) score += 8
  else if (item.summary.length > 60) score += 4
  // A headline on its own is a link, not a story. Some feeds (Nature's subject
  // alerts, for one) ship nothing else, and they should lose to anything that
  // gives the reader something to read.
  else if (!item.summary) score -= 14
  if (item.body.length) score += 6
  // An undated item is being trusted, not measured. Don't let it lead.
  if (item.dateEstimated) score -= 8
  return score
}

/**
 * Ranking for the front page. As above, but artwork counts for much more —
 * the lead slot is a large image well, so a great story with no picture makes
 * a worse lead than a good story with one.
 */
function prominence(item, now) {
  const published = Date.parse(item.publishedAt ?? '') || now - 48 * 3600_000
  const ageHours = Math.max(0, (now - published) / 3600_000)
  let score = 100 - Math.min(72, ageHours) * 1.15
  score += (TIER_BONUS[item.tier] ?? 4) * 0.6
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

/**
 * A section of twenty told by three publishers is a syndication feed, not a
 * survey. So each source gets a quota — keyed on the host rather than the feed
 * name, because one newsroom often ships four desks; if that leaves the section
 * short —
 * because half the newsroom's feed was down, or a section only has four
 * publishers — the remainder is backfilled in rank order rather than published
 * thin.
 */
function capBySource(items, cap, target, keyOf = (item) => item.sourceHost || item.source) {
  const used = new Map()
  const kept = []
  const overflow = []
  for (const item of items) {
    const key = keyOf(item)
    const count = used.get(key) ?? 0
    if (count >= cap) {
      overflow.push(item)
      continue
    }
    used.set(key, count + 1)
    kept.push(item)
  }
  if (kept.length >= target) return kept
  return [...kept, ...overflow].slice(0, Math.max(target, kept.length))
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

/**
 * Whatever the last run wrote, if it is still on disk.
 *
 * In CI that is the copy the checkout brought along, which is what makes
 * carrying an edition forward possible at all.
 */
async function previousEdition(topic) {
  try {
    return JSON.parse(await readFile(resolve(OUT_DIR, `${topic}.json`), 'utf8'))
  } catch {
    // First ever run, or the file is unreadable. Nothing to carry.
    return null
  }
}

/**
 * Videos from a previous edition that are still worth showing: inside the same
 * age window a fresh pull would use, and de-duplicated.
 *
 * This exists because of how YouTube fails. When it starts shedding load, every
 * channel feed 404s at once and the honest result of the run is zero videos —
 * which would empty every rail in the app on the strength of a bad five minutes.
 * The uploads from four hours ago are still real uploads, so they stay up until
 * a pull actually succeeds.
 */
function carryVideos(previous, cutoff, limit) {
  const kept = []
  for (const video of previous ?? []) {
    if (!video || video.kind !== 'video') continue
    if ((Date.parse(video.publishedAt ?? '') || 0) < cutoff) continue
    kept.push(video)
    if (kept.length >= limit) break
  }
  return kept
}

/** The YouTube board is a section in the app but has no RSS newsroom. */
const VIDEO_TOPIC = 'youtube'
const REFRESH_HOURS = 4

async function main() {
  const started = Date.now()
  const config = JSON.parse(await readFile(resolve(HERE, 'feeds.json'), 'utf8'))
  const now = Date.now()
  const generatedAt = new Date(now).toISOString()
  const cutoff = now - MAX_AGE_DAYS * 86_400_000
  const videoCutoff = now - VIDEO_MAX_AGE_DAYS * 86_400_000

  // Keys starting with an underscore are notes for whoever edits the file.
  const topicNames = Object.keys(config).filter(
    (key) => !key.startsWith('_') && key !== 'rejected' && key !== 'creators'
  )
  const creators = config.creators ?? []

  const jobs = []
  for (const topic of topicNames) {
    for (const feed of config[topic]) jobs.push({ topic, feed })
  }

  const previous = new Map(
    await Promise.all(
      [...topicNames, VIDEO_TOPIC].map(async (topic) => [topic, await previousEdition(topic)])
    )
  )

  console.log(
    `\n  BlueLink · ${jobs.length} feeds across ${topicNames.length} sections` +
      ` · ${creators.length} YouTube channels\n`
  )

  // ---- 1. Collect -------------------------------------------------------

  const [results, creatorResults] = await Promise.all([
    mapLimit(jobs, CONCURRENCY, ({ feed, topic }) => fetchFeed(feed, topic)),
    mapLimit(creators, CREATOR_CONCURRENCY, (creator) =>
      withRetry(() => fetchCreator(creator))
    ),
  ])

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

  const allVideos = []
  for (const result of creatorResults) {
    if (!result.ok) {
      failures.push(result)
      continue
    }
    for (const video of result.items) {
      if ((Date.parse(video.publishedAt ?? '') || 0) < videoCutoff) continue
      allVideos.push(video)
    }
  }

  // ---- 2. Select --------------------------------------------------------

  const selection = new Map()
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

    const ranked = dedupe(fresh).sort((a, b) => rank(b, now) - rank(a, now))
    const spread = capBySource(ranked, PER_SOURCE_CAP, PER_TOPIC_LIMIT)
    selection.set(topic, spreadBySource(spread).slice(0, PER_TOPIC_LIMIT))
  }

  let rankedVideos = dedupe(allVideos).sort((a, b) => videoScore(b, now) - videoScore(a, now))

  // Shorts are checked over the plausible candidates only — the tail of the
  // ranking is never published, so paying a request for it would be waste.
  const candidates = rankedVideos.slice(0, SHORTS_CHECK_LIMIT)
  const shorts = new Set()
  await mapLimit(candidates, ENRICH_CONCURRENCY, async (video) => {
    if (await isShort(video)) shorts.add(video.id)
  })
  rankedVideos = rankedVideos.filter((video) => !shorts.has(video.id))
  if (shorts.size) console.log(`  skipped ${shorts.size} Shorts`)

  const videosByTopic = new Map(topicNames.map((topic) => [topic, []]))
  for (const video of rankedVideos) {
    videosByTopic.get(video.topic)?.push(video)
  }
  /*
   * Fresh first, then topped up from the previous edition.
   *
   * Not "carry only when the pull is empty": a throttled run usually returns a
   * few channels rather than none, and replacing eight held videos with the two
   * that happened to answer is a downgrade dressed up as an update. Topping up
   * means a rail can only get better.
   */
  let carried = 0
  for (const topic of topicNames) {
    const fresh = capBySource(
      videosByTopic.get(topic),
      3,
      VIDEOS_PER_TOPIC,
      // Keyed on the channel: every video shares one host.
      (v) => v.source
    ).slice(0, VIDEOS_PER_TOPIC)

    const held = carryVideos(previous.get(topic)?.videos, videoCutoff, VIDEOS_PER_TOPIC)
    const merged = dedupe([...fresh, ...held]).slice(0, VIDEOS_PER_TOPIC)
    carried += merged.length - fresh.length
    videosByTopic.set(topic, merged)
  }

  /*
   * The trending board draws on every channel, not just the ones tagged
   * `youtube`, because "what is going on right now" is a cross-section
   * question — a phone launch review and a Champions League highlight reel are
   * both on it. Two per channel keeps one prolific uploader from owning it.
   */
  let trending = spreadBySource(
    rankedVideos.filter((video) => video.onBoard),
    2
  ).slice(0, YOUTUBE_LIMIT)

  const heldBoard = carryVideos(previous.get(VIDEO_TOPIC)?.articles, videoCutoff, YOUTUBE_LIMIT)
  const boardBefore = trending.length
  trending = dedupe([...trending, ...heldBoard]).slice(0, YOUTUBE_LIMIT)
  if (trending.length > boardBefore) {
    console.log(
      `  board: ${boardBefore} fresh, topped up to ${trending.length} from the last edition`
    )
  }

  // ---- 3. Enrich --------------------------------------------------------

  const kept = topicNames.flatMap((topic) => selection.get(topic))
  console.log(`  reading ${kept.length} article pages for artwork and excerpts…`)
  await mapLimit(kept, ENRICH_CONCURRENCY, (article) => enrichArticle(article))

  // Whatever still has no artwork gets an openly licensed photograph of the
  // same subject, labelled as such. Far fewer requests than it looks: by this
  // point almost everything has a real image.
  const stillBare = kept.filter((article) => !article.image)
  if (stillBare.length) {
    console.log(`  looking up related artwork for ${stillBare.length} story(ies)…`)
    await mapLimit(stillBare, 4, async (article) => {
      const found = await relatedImage(imageKeywords(article.title))
      if (!found) return
      article.image = found.image
      article.imageFrom = 'related'
      article.imageCredit = found.credit
      article.imageCreditUrl = found.creditUrl
    })
  }

  const shownVideos = dedupe([...trending, ...topicNames.flatMap((t) => videosByTopic.get(t))])
  await mapLimit(shownVideos, ENRICH_CONCURRENCY, (video) => bestThumbnail(video))

  /** `onBoard` is a scheduling detail; the app has no use for it. */
  const forPublication = ({ onBoard, ...video }) => video

  // ---- 4. Write ---------------------------------------------------------

  await mkdir(OUT_DIR, { recursive: true })

  const topicSummaries = []
  const everything = []

  for (const topic of topicNames) {
    const articles = selection.get(topic)
    const videos = videosByTopic.get(topic)
    const sources = new Set(articles.map((a) => a.source)).size
    const withArt = articles.filter((a) => a.image).length
    const withBody = articles.filter((a) => a.body.length).length

    await writeFile(
      resolve(OUT_DIR, `${topic}.json`),
      `${JSON.stringify({
        topic,
        generatedAt,
        count: articles.length,
        articles,
        videos: videos.map(forPublication),
      })}\n`
    )

    topicSummaries.push({
      topic,
      count: articles.length,
      sources,
      videoCount: videos.length,
      newestAt: articles[0]?.publishedAt ?? null,
    })
    everything.push(...articles)

    console.log(
      `  ${topic.padEnd(10)} ${String(articles.length).padStart(2)} stories · ` +
        `${sources} publishers · ${withArt} with art · ${withBody} with an excerpt · ` +
        `${videos.length} videos`
    )
  }

  // The YouTube board is written in the same shape as any other section, so
  // the app can route to it without knowing it is special.
  await writeFile(
    resolve(OUT_DIR, `${VIDEO_TOPIC}.json`),
    `${JSON.stringify({
      topic: VIDEO_TOPIC,
      generatedAt,
      count: trending.length,
      articles: trending.map((video) => ({ ...forPublication(video), topic: VIDEO_TOPIC })),
      videos: [],
    })}\n`
  )
  topicSummaries.push({
    topic: VIDEO_TOPIC,
    count: trending.length,
    sources: new Set(trending.map((v) => v.source)).size,
    videoCount: trending.length,
    newestAt: trending[0]?.publishedAt ?? null,
  })
  console.log(
    `  ${VIDEO_TOPIC.padEnd(10)} ${String(trending.length).padStart(2)} trending videos · ` +
      `${new Set(trending.map((v) => v.source)).size} channels`
  )

  // Front page: rank everything, take each topic's best in rotation, then
  // break up any publisher that still lands twice in a row.
  const highlights = spreadBySource(
    interleaveByTopic(
      dedupe(everything).sort((a, b) => prominence(b, now) - prominence(a, now)),
      topicNames
    ).slice(0, HIGHLIGHT_LIMIT),
    1
  )

  await writeFile(
    resolve(OUT_DIR, 'index.json'),
    `${JSON.stringify({
      generatedAt,
      refreshIntervalHours: REFRESH_HOURS,
      nextRefreshAt: new Date(now + REFRESH_HOURS * 3600_000).toISOString(),
      totalArticles: everything.length,
      totalVideos: shownVideos.length,
      topics: topicSummaries,
      feedsAttempted: jobs.length + creators.length,
      feedsFailed: failures.length,
      failures: failures.map((f) => ({ feed: f.feed, reason: f.reason })),
      highlights,
      /** A short rail on the front page; the full board lives in youtube.json. */
      videos: trending.slice(0, 8).map(forPublication),
    })}\n`
  )

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `\n  ${everything.length} stories and ${shownVideos.length} videos written to public/data` +
      ` in ${seconds}s`
  )
  if (carried) console.log(`  ${carried} video(s) held over from the previous edition`)
  const bare = kept.filter((a) => !a.image).length
  if (bare) console.log(`  ${bare} story(ies) still have no artwork of any kind.`)
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
