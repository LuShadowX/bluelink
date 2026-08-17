import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { loadIndex, loadTopic } from './feed'
import { REFRESH_INTERVAL_MS, TOPIC_IDS, type TopicId } from '../config/topics'
import type { Article, IndexPayload } from '../types'

/** Keeps relative timestamps honest and drives the staleness check. */
const HEARTBEAT_MS = 60_000
/** Never poll the origin more than once every five minutes. */
const MIN_CHECK_GAP_MS = 5 * 60_000

type Status = 'loading' | 'ready' | 'error'

interface NewsValue {
  status: Status
  error: string | null
  index: IndexPayload | null
  /** Ticking clock, so "3h ago" ages without a reload. */
  now: number

  articlesByTopic: Partial<Record<TopicId, Article[]>>
  everyArticle: Article[]
  requestTopic: (topic: TopicId) => void
  isTopicLoading: (topic: TopicId) => boolean

  /** True once the published issue is older than the six-hour window. */
  isStale: boolean
  checking: boolean
  /** Set when a newer issue exists but the reader has not accepted it yet. */
  freshIssueAt: string | null
  checkNow: () => void
  /** Check and adopt in one gesture — used by pull-to-refresh. */
  refreshNow: () => Promise<void>
  applyFreshIssue: () => void
  retry: () => void
}

const NewsContext = createContext<NewsValue | null>(null)

export function NewsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState<IndexPayload | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [articlesByTopic, setArticlesByTopic] = useState<Partial<Record<TopicId, Article[]>>>({})
  const [loadingTopics, setLoadingTopics] = useState<Set<TopicId>>(new Set())
  const [checking, setChecking] = useState(false)
  const [pending, setPending] = useState<IndexPayload | null>(null)

  const lastCheckedAt = useRef(0)
  const inflight = useRef(new Set<TopicId>())
  const generatedAt = index?.generatedAt ?? null

  // ---- Topic payloads --------------------------------------------------

  const fetchTopic = useCallback(async (topic: TopicId, bustAt?: number) => {
    if (inflight.current.has(topic)) return
    inflight.current.add(topic)
    setLoadingTopics((prev) => new Set(prev).add(topic))
    try {
      const payload = await loadTopic(topic, bustAt)
      setArticlesByTopic((prev) => ({ ...prev, [topic]: payload.articles }))
    } catch {
      // A single missing section is survivable: the topic simply reads empty
      // and the rest of the app is unaffected.
      setArticlesByTopic((prev) => ({ ...prev, [topic]: prev[topic] ?? [] }))
    } finally {
      inflight.current.delete(topic)
      setLoadingTopics((prev) => {
        const next = new Set(prev)
        next.delete(topic)
        return next
      })
    }
  }, [])

  const requestTopic = useCallback(
    (topic: TopicId) => {
      if (articlesByTopic[topic] || inflight.current.has(topic)) return
      void fetchTopic(topic)
    },
    [articlesByTopic, fetchTopic]
  )

  // ---- First load, then quietly warm every section ---------------------

  const bootstrap = useCallback(
    async (bustAt?: number) => {
      setStatus((prev) => (prev === 'ready' ? prev : 'loading'))
      setError(null)
      try {
        const payload = await loadIndex(bustAt)
        setIndex(payload)
        lastCheckedAt.current = Date.now()
        setStatus('ready')

        // Prefetch the rest so section switching and search are instant. Done
        // after the front page is on screen, and deliberately not awaited.
        const warm = () => TOPIC_IDS.forEach((topic) => void fetchTopic(topic, bustAt))
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(warm, { timeout: 2500 })
        } else {
          window.setTimeout(warm, 400)
        }
      } catch (err) {
        setStatus('error')
        setError(
          err instanceof Error
            ? err.message
            : 'Could not reach the newsroom. Check your connection.'
        )
      }
    },
    [fetchTopic]
  )

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void bootstrap()
  }, [bootstrap])

  // ---- Staleness ------------------------------------------------------

  const isStale = useMemo(() => {
    if (!generatedAt) return false
    const published = Date.parse(generatedAt)
    return Number.isFinite(published) && now - published > REFRESH_INTERVAL_MS
  }, [generatedAt, now])

  /**
   * Look for a newer issue without disturbing the page. If one exists we hold
   * it aside rather than swapping it in — re-flowing the grid under someone
   * mid-sentence is worse than a slightly old headline.
   */
  const checkNow = useCallback(async () => {
    if (checking) return
    const at = Date.now()
    lastCheckedAt.current = at
    setChecking(true)
    try {
      const payload = await loadIndex(at)
      if (generatedAt && payload.generatedAt !== generatedAt) {
        setPending(payload)
      }
    } catch {
      // Offline or the origin blinked. The heartbeat will try again.
    } finally {
      setChecking(false)
    }
  }, [checking, generatedAt])

  /**
   * Check and adopt in one step, for pull-to-refresh. The two-step "a newer
   * edition is waiting" dance exists so the page never re-flows under someone
   * mid-sentence — but a deliberate pull gesture *is* the reader asking for it,
   * so holding the result back would just feel broken.
   */
  const refreshNow = useCallback(async () => {
    const at = Date.now()
    lastCheckedAt.current = at
    setChecking(true)
    try {
      const payload = await loadIndex(at)
      if (!generatedAt || payload.generatedAt !== generatedAt) {
        const stamp = Date.parse(payload.generatedAt) || at
        setIndex(payload)
        setPending(null)
        setArticlesByTopic({})
        inflight.current.clear()
        TOPIC_IDS.forEach((topic) => void fetchTopic(topic, stamp))
      }
    } catch {
      // Offline. The gesture simply produces nothing new.
    } finally {
      setChecking(false)
    }
  }, [generatedAt, fetchTopic])

  const applyFreshIssue = useCallback(() => {
    if (!pending) return
    const at = Date.parse(pending.generatedAt) || Date.now()
    setIndex(pending)
    setPending(null)
    setArticlesByTopic({})
    inflight.current.clear()
    TOPIC_IDS.forEach((topic) => void fetchTopic(topic, at))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [pending, fetchTopic])

  // One heartbeat drives both the clock and the six-hour check.
  useEffect(() => {
    const tick = () => {
      const at = Date.now()
      setNow(at)
      const published = generatedAt ? Date.parse(generatedAt) : NaN
      const overdue = Number.isFinite(published) && at - published > REFRESH_INTERVAL_MS
      if (overdue && !pending && at - lastCheckedAt.current > MIN_CHECK_GAP_MS) {
        void checkNow()
      }
    }
    const id = window.setInterval(tick, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [generatedAt, pending, checkNow])

  // Coming back to a parked tab is the most likely moment to be out of date.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      const at = Date.now()
      setNow(at)
      if (at - lastCheckedAt.current > MIN_CHECK_GAP_MS) void checkNow()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [checkNow])

  // ---- Derived --------------------------------------------------------

  const everyArticle = useMemo(() => {
    const seen = new Set<string>()
    const all: Article[] = []
    for (const topic of TOPIC_IDS) {
      for (const article of articlesByTopic[topic] ?? []) {
        if (seen.has(article.id)) continue
        seen.add(article.id)
        all.push(article)
      }
    }
    for (const article of index?.highlights ?? []) {
      if (seen.has(article.id)) continue
      seen.add(article.id)
      all.push(article)
    }
    return all.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  }, [articlesByTopic, index])

  const isTopicLoading = useCallback(
    (topic: TopicId) => loadingTopics.has(topic),
    [loadingTopics]
  )

  const retry = useCallback(() => {
    started.current = true
    void bootstrap(Date.now())
  }, [bootstrap])

  const value = useMemo<NewsValue>(
    () => ({
      status,
      error,
      index,
      now,
      articlesByTopic,
      everyArticle,
      requestTopic,
      isTopicLoading,
      isStale,
      checking,
      freshIssueAt: pending?.generatedAt ?? null,
      checkNow: () => void checkNow(),
      refreshNow,
      applyFreshIssue,
      retry,
    }),
    [
      status,
      error,
      index,
      now,
      articlesByTopic,
      everyArticle,
      requestTopic,
      isTopicLoading,
      isStale,
      checking,
      pending,
      checkNow,
      refreshNow,
      applyFreshIssue,
      retry,
    ]
  )

  return <NewsContext.Provider value={value}>{children}</NewsContext.Provider>
}

export function useNews(): NewsValue {
  const value = useContext(NewsContext)
  if (!value) throw new Error('useNews must be used inside <NewsProvider>')
  return value
}
