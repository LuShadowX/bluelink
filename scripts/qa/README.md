# QA harness

Checks that the app actually looks and behaves correctly, rather than merely
compiling. Every defect worth fixing in this project so far was found by one of
these, not by the build.

These scripts are **not** part of the build and Playwright is deliberately not a
dependency — it is only needed to inspect the app. Chrome is driven through
`channel: 'chrome'`, so the system browser is used and nothing large is
downloaded.

## Setup

```bash
npx playwright@latest --version   # once, to populate the npx cache
```

`scripts/qa/browser.mjs` finds Playwright in a local `node_modules` if one
exists, and falls back to that cache otherwise.

## Running

Serve a build first, then point the scripts at it:

```bash
npm run build
npx vite preview --port 4173 &

node scripts/qa/layout.mjs    # column widths, headline baselines, overflow
node scripts/qa/images.mjs    # every story image actually loads
node scripts/qa/visual.mjs    # screenshots + reader, search, saving
node scripts/qa/shots.mjs     # screenshot sweep: front, section, YouTube, reader
node scripts/qa/refresh.mjs   # the four-hour refresh, with faked stale editions
node scripts/qa/pwa.mjs       # manifest, service worker, offline, pull-to-refresh
node scripts/qa/icons.mjs     # regenerate app icons from scripts/icon-source.svg
```

Any deployment can be targeted instead of localhost:

```bash
BLUELINK_URL=https://lushadowx.github.io/pulse-news/ node scripts/qa/pwa.mjs
```

Screenshots are written to `.qa-output/` (gitignored); override with
`BLUELINK_QA_OUT`.

## Notes worth knowing

- **`refresh.mjs` blocks service workers on purpose.** It fakes stale editions
  with `page.route()`, and page-level interception does not apply to requests a
  service worker makes itself — with one active the fake payloads are bypassed
  and the test silently checks the real server instead. Service-worker behaviour
  is covered by `pwa.mjs`.
- **`images.mjs` is the authority on image health, not `visual.mjs`.** It waits
  for every image to settle; the quicker sweep in `visual.mjs` reports images as
  broken when they are merely still loading.
- An occasional 403 from a publisher's image CDN is rate limiting, not a bug.
  Those stories fall back to the lettered plate by design.
