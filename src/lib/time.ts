/** Compact relative stamps. "14m", "3h", "2d" — headline furniture, not prose. */
export function shortAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const seconds = Math.max(0, (now - then) / 1000)
  if (seconds < 90) return 'just now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)}m ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 7) return `${Math.floor(days)}d ago`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Longer form for the article reader, where there is room to be explicit. */
export function fullDate(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  return new Date(then).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function clockTime(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  return new Date(then).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** True when a story landed in the last few hours — drives the NEW flag. */
export function isBreaking(iso: string, now = Date.now(), withinHours = 3): boolean {
  const then = Date.parse(iso)
  return Number.isFinite(then) && now - then < withinHours * 3600_000
}
