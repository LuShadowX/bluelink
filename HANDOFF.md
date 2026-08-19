# BlueLink — working notes

Written so a new session (or a future you) can pick this up cold. The README
explains what the app *is*; this file records **why it is the way it is**, what
broke along the way, and what is still open.

- Live: <https://lushadowx.github.io/bluelink/>
- Repo: `github.com/LuShadowX/bluelink` · local: `~/Desktop/news-lua`
- Last updated: 2026-08-19

---

## 1. What it is right now

A static React app in front of static JSON. A Node pipeline reads
`scripts/feeds.json`, pulls every RSS feed plus the public Atom feed of 51
YouTube channels, keeps the best 15 per section, then fetches each of those
pages to recover artwork and prose. The browser only ever loads files from
BlueLink's own origin — no CORS proxy, no API key, no per-visitor rate limit.

**Eight sections**, 15 stories each: `tech`, `ai`, `sports`, `games`, `arena`
(Clash Royale & Brawl Stars), `movies`, `lifestyle`, `youtube` (a trending video
board). Refresh is **every 4 hours**.

A typical edition: 99 stories, ~30–45 videos, 100/100 stories with artwork,
~85/99 with an extracted excerpt.

---

## 2. Commands

```bash
npm run news        # run the pipeline, write public/data/*.json
npm run dev         # Vite on :5173
npm run build       # tsc --noEmit && vite build
npm start           # news, then dev
```

**Verification harness** (`scripts/qa/`) — not part of the build; Playwright is
resolved from the npx cache. Serve a build first: `npm run build && npx vite
preview --port 4173 &`

```bash
node scripts/qa/layout.mjs    # column widths, headline baselines, overflow
node scripts/qa/images.mjs    # every story image actually loads
node scripts/qa/chrome.mjs    # both themes, the menu, About, the reader
node scripts/qa/shots.mjs     # screenshot sweep, desktop + phone
node scripts/qa/refresh.mjs   # the 4-hour refresh, with faked stale editions
node scripts/qa/pwa.mjs       # manifest, service worker, offline, pull-to-refresh
node scripts/qa/icons.mjs     # regenerate app icons from public/mark.png
```

Any of them can target the deployed site:
`BLUELINK_URL=https://lushadowx.github.io/bluelink/ node scripts/qa/pwa.mjs`

**Every real defect in this project was found by one of these or by looking at a
screenshot — never by a passing build.** Keep doing that.

---

## 3. Rules of the road

- **Commit as `Shadow_Lu <xshadowlu13@gmail.com>`** (already set as repo-local
  git config, so plain `git commit` is right). **Never** add a `Co-Authored-By:
  Claude` trailer — the owner wants only their name in GitHub contributors. The
  environment's `chandan.supyal@practicelink.com` is *not* on that GitHub account
  and produces unlinked commits.
- **The 4-hourly cron will have pushed while you were away.** `git fetch` first.
  Those commits only touch `public/data`, so `git rebase -X theirs origin/main`
  (keeping your generated data) and then re-run `npm run news` is the routine.
- **The deploy workflow runs `npm run news` itself** before building, so what
  visitors see is generated at deploy time from GitHub's IP. The committed
  `public/data` is the seed and the carry-forward source, not the live edition.
  If the repo and the site disagree on counts, that is why.
- Adding a data file? Add it to `PRECACHE` in `public/sw.js` **and bump
  `VERSION`** (currently `bluelink-v4`), or installed apps keep the old set.

---

## 4. The pipeline (`scripts/fetch-news.mjs`)

Four stages: **collect → select → enrich → write**.

- **Select.** `rank()` = recency (dominant) + source `tier` + artwork + excerpt
  depth. One publisher may hold at most 4 of a section's 15 slots
  (`capBySource`, keyed on **host** — one newsroom often ships four desks), with
  backfill if that leaves the section short.
- **Enrich.** Every kept story's page is fetched once for `og:image` and
  paragraphs. Plenty of hosts answer a server fetch with a consent wall that is a
  valid 200 and contains no article — **Ars Technica, PC Gamer, NYT, Bloomberg,
  The Kitchn** among them — so the feed's own `content:encoded` is mined too and
  whichever excerpt is *longer* wins. Never overwrite unconditionally.
- **Artwork ladder:** feed image → the page's `og:image`/`twitter:image` →
  an openly licensed Openverse photo of the same subject → a drawn fallback
  plate. The Openverse image is credited in the reader as a *related photo*.
  **Never present a stock photo as the publisher's own.**
- **`points[]`** is what the reader shows: 3–4 sentences extracted and scored on
  figures, dates, attribution and headline overlap. Extracted, **never generated
  or paraphrased** — every bullet is a sentence the publisher wrote. `body[]`
  (paragraphs) is only the fallback when nothing scored.
- **`tags[]`** comes from the feed's own `<category>` entries, cleaned. Nothing
  is guessed: an earlier headline-word fallback produced "Watch, Daily,
  Schedule" and was removed. ~1/3 of stories have no categories in their feed and
  show the section chip alone.
- **`feeds.json`** holds, per feed: `tier` (1 = major newsroom or primary
  source, 2 = specialist, 3 = looser) and an optional **`match`** keyword list
  that keeps only items mentioning one of the terms. Creators have `topic` and
  optional `board: false`.

### Text-quality traps (all previously fixed — don't undo)

- **Block tags carry punctuation.** Replacing `</p>` with a space turned
  "…harm young people" + "More than half…" into one runaway sentence. `stripHtml`
  marks block ends with a NUL (`BLOCK_BREAK`) and `joinBlocks` inserts a full stop
  when the previous piece has no terminal punctuation.
- **`titleKey` caps at 90 characters.** Right for headlines, useless for deciding
  whether a 400-character paragraph is already inside the dek — that bug made the
  reader show the same sentence twice. Use **`proseKey`** for prose.
- Publishers wrap a drop cap in its own element, so tag-stripping yields
  "B uying a vacuum cleaner". Reattached by `^([B-HJ-Z]) (?=[a-z]{2})` — A and I
  are excluded because "A quick fix" is a sentence.
- Boilerplate rules strip leading picture credits ("…: Credit: X."), bare
  "Enlarge", "Summary"/"TL;DR" labels welded to the first sentence, and trailing
  bullet-led related-link lists.
- The Guardian's `og:image` is sometimes `fallback-logo.png`; `BAD_IMAGE` rejects
  it so the Openverse rung can run.
- `LOW_VALUE_TITLE` drops coupon/deal/roundup/puzzle/live-blog filler. A Guardian
  vacuum-cleaner buying guide once led the Tech section.

### YouTube

- Public per-channel Atom feed only. **No API key anywhere.**
- Shorts are detected by `HEAD youtube.com/shorts/<id>`: **200 = a Short, 303 =
  a normal upload**. They win any views-per-hour race, so they must be dropped.
- Trending ranks on **views per hour**, not raw views, or one 60M-view upload
  pins the board for a fortnight.
- **YouTube throttles by IP.** `feeds/videos.xml` starts answering 404/500 to
  *everything* for a while when hit too often — including from GitHub's runners.
  It is **not** the User-Agent (a bare curl fails identically) and not an outage.
  Hence: 4 concurrent, 3 retries treating 404 as transient, a shorter Shorts
  probe, no re-probing of thumbnails already upgraded, and rails that are
  **topped up** from the previous edition rather than replaced. A thin pull must
  never empty a rail. **Don't "fix" the 404s by spoofing headers.**

---

## 5. Design

The look is a **comic cel**: pure-white panels, hard ink outlines
(`--line: 2px`), offset shadows that are never blurred, one saturated hue per
section, always outlined. Depth is drawn, not photographed. The bar and the nav
chips float. Type: Chakra Petch (display), Archivo Black (wordmark, numerals,
drop caps), Inter (body), JetBrains Mono (micro-labels).

**This supersedes the original warm-paper/hairline-rule direction.** The "must
not look AI-made" bar still stands: no uniform rounded cards, no soft shadows
everywhere, no aimless gradients, no emoji icons, no default framework styling.

### Role tokens — read this before touching colour

`--ink` was doing two jobs, type *and* filled surfaces, and those move in
opposite directions when the theme flips. The roles exist so the dark theme is a
palette swap rather than a rewrite:

| token | use |
| --- | --- |
| `--fill-ink` / `--fill-ink-text` / `--fill-ink-muted` | deliberately dark surfaces: ticker, footer, section chips |
| `--on-accent` | type on a saturated accent fill (white in both themes) |
| `--on-pop` | type on the yellow flash — **never white** |
| `--ink-fixed` | ink that sits on top of colour (halftone, strokes on an accent) |
| `--shadow` | the offset shadow colour (ink in light, true black in dark) |

Getting this wrong is invisible in light mode and unreadable in dark.

### Day / night

`data-theme` on `<html>`, decided by an **inline script in `index.html` before
the first paint** — React mounts too late and a dark-mode reader would see a
white flash. Persisted in `bluelink:theme`; the system preference is followed
only until the reader chooses. `useTheme` also rewrites the `theme-color` meta.

### The background

`ParticleField.tsx` — a deliberate port of the field on the owner's portfolio
(<https://lushadowx.github.io/Portfolio>, config in its `assets/js/particles.js`):
electric-blue particles on ghost lavender `#fbf8ff`, neon-purple links between
them and to the cursor, a burst on click, plus grain and scanline overlays. Two
deliberate departures from the original: `setTransform` instead of its cumulative
`ctx.scale(dpr, dpr)` (which multiplies on every resize), and a particle cap that
scales with the viewport because the link pass is O(n²).

The earlier tbhx-style **X field was removed at the owner's request. Don't
reintroduce it.**

### Other UI decisions

- **The reader** is a panel over a dimmed page that grows out of the tapped card
  and shrinks back (animates `transform`, not width/height; falls back to a fade
  when the card is scrolled off screen). It leads with topics, then the artwork,
  then **bullets** — the dek paragraph is hidden when points exist, because it
  *is* the first bullet. The link is a quiet ruled row at the end. The owner
  objected, correctly, that opening a story "just gave a link".
- A video plays **inside** the reader, and nothing is loaded from YouTube until
  the plate is tapped.
- **The yin-yang menu** (`YinYangMenu.tsx`): one circle plus the dark half drawn
  over it, so swapping two custom properties inverts the whole symbol. Opening
  rotates 180° and swaps; closing rotates back. Items: About (in-app), Portfolio,
  the blog, Lua, Nova.
- **About** is an in-app page at `#/about` (`src/pages/AboutPage.tsx`) with
  `public/portrait.jpg` and **placeholder copy the owner intends to rewrite**.
- **Lua and Nova link to the live chatbots**, not the repos:
  `lua-anime-chatbot.onrender.com`, `nova-novel-bot.onrender.com`. Render free
  tier, so they sleep and the first load takes ~25s — the menu says so.
- **Logo:** sea blue on white. `scripts/qa/icons.mjs` recolours
  `public/mark.png` preserving each pixel's luminance (so the gradient and
  antialiased edges survive) and rebuilds every icon from it, never scaling up.
  Only ever use the emblem, never the lockup with the name.
- Hash routing + `base: './'`, so one build works on the Pages subpath and later
  inside a WebView. **Don't switch to a history router.**
- Service worker: `data/*.json` is **network-first on purpose** — cache-first
  would silently defeat the refresh.

### Layout traps (all fixed — don't undo)

- A **fixed background layer must be `z-index: -1`**. At `0` it is still a
  *positioned* box, and CSS paints those after every in-flow static one: it
  covered the footer completely while leaving the cards visible, because cards are
  `position: relative` and later in tree order.
- `.nav-rail .nav__link` needs `:not([aria-current='page'])`, or it wins on equal
  specificity and paints the active chip **white on white**.
- `.vrail` may only bleed vertically. A negative *horizontal* margin (there to
  give offset shadows room) gave the document 4px of horizontal overflow at 390px.
- `.section-rule` must wrap: "Clash Royale & Brawl Stars" plus its "all of this"
  link does not fit a phone.
- Nine nav pills do not fit beside the wordmark, so the scrolling rail takes over
  at **1180px**, not 900.
- Below 720px the freshness pill drops to its dot, and the menu panel is pinned
  to the viewport (anchored to the button it ran off the left edge).
- `.card__meta` has a fixed `min-height` so neighbouring headlines share a
  baseline — the chips are not all the same height.
- `StoryImage` checks `img.complete` in an effect: **a cached image finishes
  before React attaches `onLoad`**, the event never fires, and a perfectly good
  photograph sits at `opacity: 0`. Only reproducible on a second visit.

---

## 6. Declined — do not start unasked

- **Native Android APK via Capacitor.** Too costly/slow. Groundwork exists in
  `VITE_DATA_ORIGIN` + `openExternal()`.
- **Play Store.** $25, plus Google's 12-testers-for-14-days rule.

---

## 7. Open items

- **Movies and Lifestyle have no video rails** — narrowing the YouTube roster to
  Clash/Brawl, cricket/football/basketball/Olympics, freeCodeCamp, PC hardware
  and AI/ML left no creators for them. Add channels to `feeds.json` if rails are
  wanted there.
- **`arena` returns ~5–12 stories, not 15.** No publisher runs a Clash Royale
  feed; the section is RoyaleAPI plus keyword-filtered mobile/esports feeds.
- **~14% of bullets end in an ellipsis** where the publisher's sentence ran past
  `POINT_MAX_CHARS` (200). Could be improved by preferring shorter complete
  sentences more aggressively.
- **Unexplained:** `layout.mjs` twice reported 4px of horizontal overflow at
  390px that never reproduced across eight further runs or a purpose-built probe
  (`scrollWidth == clientWidth`, no unclipped element). `body` clips it, so
  nothing is visible. If it resurfaces, suspect the video rail mid-layout.
- Video coverage varies run to run while YouTube is shedding load. The top-up
  logic means rails only improve; they refill as soon as one pull succeeds.
- The menu's Portfolio/blog entries point at the **live sites**; the owner asked
  for "links from GitHub", and repo URLs are the other reading if they prefer.
