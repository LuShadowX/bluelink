# BlueLink

An editorial news reader for tech, AI, sport, games, lifestyle and YouTube.

## Quick start

```bash
npm install
npm run news    # pull the feeds and write public/data/*.json
npm run dev     # start Vite on http://localhost:5173
```

`npm start` does both steps in one command: it fetches the feeds, then boots the dev
server. Run `npm run news` at least once before `npm run dev` — without it there is no
JSON in `public/data/` for the app to read.

## How it works

BlueLink is a static app in front of a static payload. A Node pipeline (`scripts/fetch-news.mjs`)
reads the feed list in `scripts/feeds.json`, requests every RSS feed and every curated YouTube
channel feed server-side, normalises and de-duplicates the items, keeps the best twenty per
section, then reads each of those article pages to recover the artwork and the opening paragraphs
the feed withheld. The result is one JSON file per section in `public/data/` alongside an
`index.json` manifest. The browser only ever fetches those files from BlueLink's own origin, so
there is no CORS proxy to keep alive, no API key to rotate and no per-visitor rate limit to hit —
a thousand readers cost the publishers a single request. It also isolates failure: because each
topic is written independently and the manifest records a `failures[]` list, one publisher going
down degrades a single section rather than breaking the app.

## The four-hour refresh

News refreshes automatically every four hours, in three layers:

1. **Scheduled fetch.** `.github/workflows/refresh-news.yml` runs on a `0 */4 * * *` cron, runs
   the pipeline, and commits `public/data` back to the branch. In practice that is a commit every
   run, because `generatedAt` is restamped each time — deliberately, since the client reads that
   timestamp as the age of the edition and one that stopped advancing would leave every open tab
   convinced it was stale and re-checking on a loop.
2. **Automatic redeploy.** `.github/workflows/deploy.yml` listens for that workflow completing
   (`workflow_run`) as well as pushes to `main`, then rebuilds and republishes to GitHub Pages.
   The fresh JSON is live without anyone pressing a button.
3. **Client-side revalidation.** The app compares `generatedAt` in `index.json` against a
   four-hour window and re-fetches in the background when the payload is stale, so a tab left open
   overnight catches up on its own instead of showing yesterday's front page.

For local development, `npm run news:watch` runs the same fetch immediately and then every four
hours, logging the next scheduled run. Leave it in a second terminal beside `npm run dev`.

## Installing on a phone

BlueLink is an installable web app. Open the live site at
<https://lushadowx.github.io/bluelink/> on the phone, then:

- **Android (Chrome).** Use the menu's **Install app**, or **Add to Home screen** if that is
  the wording offered.
- **iOS (Safari).** Use **Share → Add to Home Screen**.

Installed, BlueLink launches without browser chrome, keeps its own icon on the home screen, and
opens straight into the front page. It reads offline from the last edition it downloaded, and
pulling down at the top of the page refreshes it.

The install metadata lives in `public/manifest.webmanifest`: a standalone display mode,
portrait-primary orientation, the white `#FFFFFF` used for both the theme and the launch
background, and shortcuts that jump directly to Tech, AI, Sports, Games and Saved.

## Offline behaviour

`public/sw.js` is a hand-written service worker — no build plugin and no Workbox — and it picks a
caching strategy per resource type rather than applying one rule to everything.

| Resource | Strategy | Why |
| --- | --- | --- |
| Navigation and `data/*.json` | Network-first | A fresh edition must always win over a cached one. Serving these from cache first would defeat the four-hour refresh. |
| `assets/*` and icons | Cache-first | Vite content-hashes these filenames, so a given URL is immutable and can be served from cache without a check. |
| Google Fonts, publisher images | Stale-while-revalidate | Shown immediately, updated in the background. The image cache is capped at 80 entries because cross-origin image responses are opaque and are padded when counted against the storage quota. |

At install the worker reads `index.html` and extracts the build's own hashed script and
stylesheet URLs so it can precache them. This step is necessary because on a first visit the
page fetches those files before the worker has activated, so nothing intercepts them and nothing
stores them. Without it the app would serve its HTML offline and then fail to boot, because the
JavaScript beside it was never saved.

One edition of news is precached at the same time, so the app is readable immediately after
installing even if the network drops straight away.

Publisher artwork is best-effort. Images are third-party and capped, so an offline story whose
image was never cached falls back to the lettered plate the app uses elsewhere.

## Icons and safe areas

The icon PNGs in `public/icons/` (192, 512, maskable 512 and rounded 512) and
`public/apple-touch-icon.png` are rasterised from `scripts/icon-source.svg`, which is the single
source of truth. Edit the SVG, not the PNGs; regenerating them requires a headless-Chrome
rasterisation step.

The viewport is declared `viewport-fit=cover`, so the stylesheet applies `env(safe-area-inset-*)`
to the masthead, page gutter, footer, reader bar and search overlay. Without those insets the
sticky header slides under an iPhone notch.

## Pull to refresh

`src/lib/usePullToRefresh.ts` and `src/components/PullIndicator.tsx` add a pull-down gesture. It
is active only on coarse-pointer devices, only at the very top of the page, and is disabled while
the reader or search overlay holds the body scroll lock.

Unlike the header pill, which offers a new edition and waits for a tap, a pull checks for a new
edition and adopts it in the same gesture — a deliberate pull is the reader asking for it.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot module reloading. |
| `npm run build` | Type-check with `tsc --noEmit`, then build to `dist/`. |
| `npm run preview` | Serve the built `dist/` output locally to check a production build. |
| `npm run news` | Fetch all feeds once and write `public/data/*.json`. |
| `npm run news:watch` | Fetch now, then re-fetch every four hours until stopped. |
| `npm start` | `npm run news` followed by `npm run dev`. |
| `npm run typecheck` | Type-check only, no build output. |

## Sources

Every feed is verified live — the most recent pipeline run completed with an empty
`failures[]` list.

| Section | News feeds | YouTube channels |
| --- | --- | --- |
| Tech | 11 | 9 |
| AI | 11 | 9 |
| Sports | 8 | 7 |
| Games | 9 | 7 |
| Lifestyle | 12 | 8 |
| YouTube | — | 11 |

Each feed carries a `tier`: 1 for a major newsroom or the primary source itself, 2 for a
specialist desk, 3 for something looser. Tier feeds the ranking as a tie-breaker, so a
close call goes to the more reliable byline — and one publisher can hold at most five of a
section's twenty slots, keeping a section a survey rather than a syndication feed.

The full list of feed URLs and channel IDs lives in `scripts/feeds.json`.

## Sections, videos and artwork

- **Twenty per section.** A section you can finish reading beats an endless scroll, and it
  is few enough that every kept story can be enriched by fetching its page.
- **Real artwork.** Feed image → the page's own `og:image` → an openly licensed photograph
  of the same subject from Openverse, credited as a related picture rather than passed off
  as the publisher's own → a drawn fallback plate. The last run put artwork on 100 of 100.
- **A real excerpt.** Each story carries `body[]`: a few paragraphs mined from the article
  page, or from the feed's own `content:encoded` for the publishers that refuse a server
  fetch. Opening a story gives you something to read before the link out.
- **YouTube.** Each section gets a rail of new uploads from curated creators, and the
  YouTube board ranks everything by views-per-hour — what is actually moving now, rather
  than whichever channel is biggest. Shorts are detected and dropped, and a video plays
  inside the reader without loading anything from YouTube until it is tapped.

## Project structure

```
scripts/
  fetch-news.mjs      Pipeline: collect, select, enrich, write public/data
  feeds.json          Feeds by section, plus the YouTube channel roster
  watch-news.mjs      Local scheduler for development
  icon-source.svg     Source of truth for every app icon
src/
  config/             Topic definitions: labels, kickers, accent colours
  styles/             Design tokens, base, cards, layout, overlays
  lib/                Data loading, the four-hour refresh, routing, formatting,
                      pull-to-refresh, service worker registration
  components/         Masthead, ticker, cards, reader, search, pull indicator,
                      the animated X backdrop
  pages/              Front page, topic page, saved list
public/
  data/               Generated JSON — one file per section (youtube.json
                      included), plus index.json
  icons/              App icons rasterised from scripts/icon-source.svg
  manifest.webmanifest  Web app manifest: name, display mode, shortcuts
  sw.js               Service worker: precache and per-resource caching
  apple-touch-icon.png  Home screen icon for iOS
.github/
  workflows/          refresh-news.yml (cron fetch) and deploy.yml (Pages)
```

Everything under `public/data/` is generated. Change `scripts/feeds.json` and re-run
`npm run news` rather than editing it by hand.

## Deployment

BlueLink deploys to GitHub Pages from `.github/workflows/deploy.yml`. To enable it on a fresh
clone, open **Settings → Pages** and set **Source** to **GitHub Actions**. No other
configuration is needed — Vite's `base` is `'./'`, so the build works from a project subpath
as well as a custom domain.

## Packaging as a native app

The native shell is not built yet. What follows is groundwork in `src/lib/feed.ts`, not a
shipping app, and there is no APK or IPA.

- **`VITE_DATA_ORIGIN`.** A native build must set this to the live site. Capacitor bundles the web
  assets into the app, so a relative fetch would read the copy of `public/data/` frozen at build
  time forever: the four-hour refresh would appear to run and silently change nothing. Pointing the
  data origin at the deployed site keeps the payload live while the shell stays static.
- **`openExternal()`.** Publisher links are routed through the Capacitor Browser plugin when it is
  present, falling back to normal browser behaviour when it is not. Inside a WebView a plain
  `target="_blank"` navigates the app's own view, which leaves the reader with no way back.

## Attribution

BlueLink is a reader, not a republisher. It links out to publishers and displays only the
headline, excerpt and metadata that each feed provides. Full articles are read on the
publisher's own site, and every headline links there directly.
