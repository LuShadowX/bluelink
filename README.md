# Pulse

An editorial news reader for tech, AI, sport, games and lifestyle.

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

Pulse is a static app in front of a static payload. A Node pipeline (`scripts/fetch-news.mjs`)
reads the feed list in `scripts/feeds.json`, requests all 43 RSS feeds server-side, normalises
and de-duplicates the items, and writes one JSON file per topic into `public/data/` alongside an
`index.json` manifest. The browser only ever fetches those files from Pulse's own origin, so
there is no CORS proxy to keep alive, no API key to rotate and no per-visitor rate limit to hit —
a thousand readers cost the publishers a single request. It also isolates failure: because each
topic is written independently and the manifest records a `failures[]` list, one publisher going
down degrades a single section rather than breaking the app.

## The six-hour refresh

News refreshes automatically every six hours, in three layers:

1. **Scheduled fetch.** `.github/workflows/refresh-news.yml` runs on a `0 */6 * * *` cron, runs
   the pipeline, and commits `public/data` back to the branch — but only when the output actually
   changed, so the history stays free of empty commits.
2. **Automatic redeploy.** `.github/workflows/deploy.yml` listens for that workflow completing
   (`workflow_run`) as well as pushes to `main`, then rebuilds and republishes to GitHub Pages.
   The fresh JSON is live without anyone pressing a button.
3. **Client-side revalidation.** The app compares `generatedAt` in `index.json` against a
   six-hour window and re-fetches in the background when the payload is stale, so a tab left open
   overnight catches up on its own instead of showing yesterday's front page.

For local development, `npm run news:watch` runs the same fetch immediately and then every six
hours, logging the next scheduled run. Leave it in a second terminal beside `npm run dev`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot module reloading. |
| `npm run build` | Type-check with `tsc --noEmit`, then build to `dist/`. |
| `npm run preview` | Serve the built `dist/` output locally to check a production build. |
| `npm run news` | Fetch all feeds once and write `public/data/*.json`. |
| `npm run news:watch` | Fetch now, then re-fetch every six hours until stopped. |
| `npm start` | `npm run news` followed by `npm run dev`. |
| `npm run typecheck` | Type-check only, no build output. |

## Sources

All 43 feeds are verified live — the most recent pipeline run completed with an empty
`failures[]` list.

| Topic | Publishers |
| --- | --- |
| Tech | 9 |
| AI | 8 |
| Sports | 7 |
| Games | 9 |
| Lifestyle | 10 |

The full list of feed URLs lives in `scripts/feeds.json`.

## Project structure

```
scripts/
  fetch-news.mjs      RSS pipeline: fetch, normalise, write public/data
  feeds.json          The 43 feeds, grouped by topic
  watch-news.mjs      Local 6-hour scheduler for development
src/
  config/             Topic definitions: labels, kickers, accent colours
  styles/             Design tokens and base stylesheet
  lib/                Data loading, the six-hour refresh, routing, formatting
  components/         Masthead, ticker, cards, reader, search
  pages/              Front page, topic page, saved list
public/
  data/               Generated JSON — one file per topic, plus index.json
.github/
  workflows/          refresh-news.yml (cron fetch) and deploy.yml (Pages)
```

Everything under `public/data/` is generated. Change `scripts/feeds.json` and re-run
`npm run news` rather than editing it by hand.

## Deployment

Pulse deploys to GitHub Pages from `.github/workflows/deploy.yml`. To enable it on a fresh
clone, open **Settings → Pages** and set **Source** to **GitHub Actions**. No other
configuration is needed — Vite's `base` is `'./'`, so the build works from a project subpath
as well as a custom domain.

## Attribution

Pulse is a reader, not a republisher. It links out to publishers and displays only the
headline, excerpt and metadata that each feed provides. Full articles are read on the
publisher's own site, and every headline links there directly.
