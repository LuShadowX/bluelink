#!/usr/bin/env node
// Local dev scheduler: mirrors the 6-hour GitHub Actions cron so a long-running
// `npm run dev` session keeps seeing fresh public/data JSON.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const FETCH_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fetch-news.mjs')

let timer = null
let running = false
let nextRunAt = null

function runFetch() {
  // The interval keeps ticking regardless of how long a fetch takes, so guard
  // against two overlapping runs writing public/data at once.
  if (running) {
    console.warn('[watch-news] previous run still in flight; skipping this cycle')
    return
  }
  running = true
  // Recorded at fire time, which is when setInterval anchors the next tick.
  nextRunAt = new Date(Date.now() + SIX_HOURS_MS)

  const finish = (outcome) => {
    running = false
    console.log(`[watch-news] ${outcome} — next run ${nextRunAt.toLocaleString()}`)
  }

  // process.execPath rather than "node" so the loop uses this exact runtime.
  const child = spawn(process.execPath, [FETCH_SCRIPT], { stdio: 'inherit' })
  child.on('exit', (code, signal) =>
    finish(signal ? `stopped by ${signal}` : code === 0 ? 'fetch complete' : `fetch failed (exit ${code})`),
  )
  // A spawn-level error (missing script, EAGAIN) must not tear down the loop.
  child.on('error', (err) => finish(`fetch could not start: ${err.message}`))
}

function shutdown(signal) {
  console.log(`\n[watch-news] ${signal} received; stopping.`)
  clearInterval(timer)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

console.log('[watch-news] refreshing every 6 hours. Press Ctrl+C to stop.')
runFetch()
timer = setInterval(runFetch, SIX_HOURS_MS)
