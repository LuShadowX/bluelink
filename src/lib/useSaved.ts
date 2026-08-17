import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Article } from '../types'

const KEY = 'pulse.saved.v1'
/** Enough to be a reading list, not enough to grow unbounded. */
const LIMIT = 200

function read(): Article[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Article =>
        !!item && typeof item === 'object' && typeof (item as Article).id === 'string'
    )
  } catch {
    // Private-mode Safari and disabled storage both throw here.
    return []
  }
}

export function useSaved() {
  const [saved, setSaved] = useState<Article[]>(read)

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(saved))
    } catch {
      // Nothing to do — the list still works for this session.
    }
  }, [saved])

  // Keep two tabs of Pulse in agreement.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setSaved(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const savedIds = useMemo(() => new Set(saved.map((a) => a.id)), [saved])

  const toggle = useCallback((article: Article) => {
    setSaved((prev) =>
      prev.some((a) => a.id === article.id)
        ? prev.filter((a) => a.id !== article.id)
        : [article, ...prev].slice(0, LIMIT)
    )
  }, [])

  const clear = useCallback(() => setSaved([]), [])

  return { saved, savedIds, toggle, clear }
}
