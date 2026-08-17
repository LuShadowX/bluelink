import { useCallback, useEffect, useRef, useState } from 'react'

/** Drag past this and releasing triggers a refresh. */
const THRESHOLD = 72
/** Travel is damped and capped so the gesture feels weighted, not elastic. */
const MAX_PULL = 108
const DAMPING = 0.55

interface PullState {
  /** Current travel in px, 0 when idle. */
  distance: number
  /** True once past the threshold, so the label can change before release. */
  armed: boolean
  refreshing: boolean
}

/**
 * Pull-to-refresh for the installed app.
 *
 * Installed to a home screen there is no browser chrome and therefore no native
 * pull-to-refresh, so without this the only way to force a new edition is the
 * small freshness pill in the header — which is not what anyone's thumb reaches
 * for. Only ever active at the very top of an unlocked page, so it cannot
 * interfere with ordinary scrolling or with the reader and search overlays.
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void): PullState {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const startY = useRef<number | null>(null)
  const active = useRef(false)
  const refreshingRef = useRef(false)

  const finish = useCallback(
    async (travel: number) => {
      startY.current = null
      active.current = false

      if (travel < THRESHOLD || refreshingRef.current) {
        setDistance(0)
        return
      }

      refreshingRef.current = true
      setRefreshing(true)
      // Hold the indicator at the threshold while the work happens.
      setDistance(THRESHOLD)
      try {
        await onRefresh()
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
        setDistance(0)
      }
    },
    [onRefresh]
  )

  useEffect(() => {
    // A mouse has a scrollbar and a refresh button; this is for thumbs only.
    if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return

    let travel = 0

    const onTouchStart = (event: TouchEvent) => {
      // Overlays lock body scroll — pulling inside one must do nothing.
      if (document.body.style.overflow === 'hidden') return
      if (refreshingRef.current || event.touches.length !== 1) return
      if (window.scrollY > 0) return
      startY.current = event.touches[0]!.clientY
      travel = 0
    }

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null || event.touches.length !== 1) return

      const delta = event.touches[0]!.clientY - startY.current
      if (delta <= 0) {
        // Scrolling up out of the gesture — hand control back immediately.
        if (active.current) {
          active.current = false
          travel = 0
          setDistance(0)
        }
        startY.current = null
        return
      }

      // Ignore a few pixels of slop so a slightly imperfect flick still scrolls.
      if (!active.current && delta < 8) return
      active.current = true

      travel = Math.min(MAX_PULL, delta * DAMPING)
      // Suppresses the platform's own overscroll glow while we own the gesture.
      if (event.cancelable) event.preventDefault()
      setDistance(travel)
    }

    const onTouchEnd = () => {
      if (!active.current) {
        startY.current = null
        return
      }
      void finish(travel)
      travel = 0
    }

    // touchmove must be non-passive, or preventDefault is ignored.
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [finish])

  return { distance, armed: distance >= THRESHOLD, refreshing }
}

export { THRESHOLD as PULL_THRESHOLD }
