import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Article } from './types'
import { getTopic } from './config/topics'
import { NewsProvider, useNews } from './lib/NewsContext'
import { useRoute } from './lib/useRoute'
import { useTheme } from './lib/useTheme'
import { useSaved } from './lib/useSaved'
import { usePullToRefresh } from './lib/usePullToRefresh'
import { PullIndicator } from './components/PullIndicator'
import { XBackdrop } from './components/XBackdrop'
import { Masthead } from './components/Masthead'
import { Ticker } from './components/Ticker'
import { Footer } from './components/Footer'
import { Reader } from './components/Reader'
import { SearchOverlay } from './components/SearchOverlay'
import { FrontPage } from './pages/FrontPage'
import { TopicPage } from './pages/TopicPage'
import { SavedPage } from './pages/SavedPage'
import { RefreshIcon } from './components/icons'

function BlueLink() {
  const {
    status,
    error,
    index,
    now,
    articlesByTopic,
    videosByTopic,
    everyArticle,
    requestTopic,
    isStale,
    checking,
    freshIssueAt,
    checkNow,
    refreshNow,
    applyFreshIssue,
    retry,
  } = useNews()

  const { route, navigate } = useRoute()
  const { theme, toggle: toggleTheme } = useTheme()
  const { saved, savedIds, toggle, clear } = useSaved()
  const pull = usePullToRefresh(refreshNow)

  const [reading, setReading] = useState<Article | null>(null)
  /** The card artwork the open panel grew from, and will shrink back into. */
  const [origin, setOrigin] = useState<HTMLElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const highlights = index?.highlights ?? []

  // Anything the reader might be asked to show, addressable by id — including
  // saved stories, which can outlive the edition they came from.
  const lookup = useMemo(() => {
    const map = new Map<string, Article>()
    for (const article of [...everyArticle, ...highlights, ...saved]) {
      if (!map.has(article.id)) map.set(article.id, article)
    }
    return map
  }, [everyArticle, highlights, saved])

  /*
   * The reader is a history entry rather than plain state, so the browser and
   * Android back gestures close it instead of leaving the app. Opening a
   * related story from inside the reader stacks another entry, which makes back
   * walk the reading trail in the order it happened.
   */
  const openArticle = useCallback((article: Article, origin?: HTMLElement | null) => {
    setSearchOpen(false)
    setOrigin(origin ?? null)
    setReading(article)
    window.history.pushState({ readerArticle: article.id }, '')
  }, [])

  const closeReader = useCallback(() => {
    const state = window.history.state as { readerArticle?: string } | null
    if (state?.readerArticle) window.history.back()
    else setReading(null)
  }, [])

  useEffect(() => {
    const onPop = () => {
      const id = (window.history.state as { readerArticle?: string } | null)?.readerArticle
      setReading(id ? (lookup.get(id) ?? null) : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [lookup])

  // Search shortcuts, ignored while the caret is in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      const shortcut =
        (event.key === '/' && !typing) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
      if (shortcut) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const related = useMemo(() => {
    if (!reading) return []
    const pool = articlesByTopic[reading.topic] ?? everyArticle
    return pool.filter((a) => a.id !== reading.id && a.topic === reading.topic).slice(0, 6)
  }, [reading, articlesByTopic, everyArticle])

  const sourceCount = useMemo(
    () => (index?.topics ?? []).reduce((sum, topic) => sum + topic.sources, 0),
    [index]
  )

  if (status === 'error') {
    return (
      <>
        <XBackdrop />
        <div className="page shell">
          <div className="state" style={{ marginTop: 'var(--sp-8)' }}>
            <h1 className="state__title">Today's edition didn't arrive</h1>
            <p className="state__body">
              {error} The stories are published as static files next to the app, so this
              is usually a connection problem rather than a missing newsroom.
            </p>
            <button type="button" className="button" onClick={retry}>
              <RefreshIcon />
              Try again
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <XBackdrop />

      <PullIndicator {...pull} />

      <Masthead
        route={route}
        navigate={navigate}
        savedCount={saved.length}
        onOpenSearch={() => setSearchOpen(true)}
        generatedAt={index?.generatedAt ?? null}
        now={now}
        isStale={isStale}
        checking={checking}
        freshIssueAt={freshIssueAt}
        onApplyFresh={applyFreshIssue}
        onCheck={checkNow}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <Ticker articles={highlights} onOpen={openArticle} />

      {route.view === 'home' && (
        <FrontPage
          highlights={highlights}
          videos={index?.videos ?? []}
          articlesByTopic={articlesByTopic}
          savedIds={savedIds}
          now={now}
          loading={status === 'loading'}
          navigate={navigate}
          onOpen={openArticle}
          onToggleSave={toggle}
        />
      )}

      {route.view === 'topic' && (
        <TopicPage
          topic={getTopic(route.topic)}
          articles={articlesByTopic[route.topic]}
          videos={videosByTopic[route.topic]}
          savedIds={savedIds}
          now={now}
          onRequest={() => requestTopic(route.topic)}
          onOpen={openArticle}
          onToggleSave={toggle}
        />
      )}

      {route.view === 'saved' && (
        <SavedPage
          saved={saved}
          savedIds={savedIds}
          now={now}
          navigate={navigate}
          onOpen={openArticle}
          onToggleSave={toggle}
          onClear={clear}
        />
      )}

      <Footer
        navigate={navigate}
        generatedAt={index?.generatedAt ?? null}
        totalArticles={index?.totalArticles ?? 0}
        sourceCount={sourceCount}
      />

      {reading && (
        <Reader
          article={reading}
          related={related}
          saved={savedIds.has(reading.id)}
          savedIds={savedIds}
          now={now}
          origin={origin}
          onClose={closeReader}
          onOpen={openArticle}
          onToggleSave={toggle}
        />
      )}

      {searchOpen && (
        <SearchOverlay
          articles={everyArticle}
          now={now}
          onClose={() => setSearchOpen(false)}
          onOpen={openArticle}
        />
      )}
    </>
  )
}

export default function App() {
  return (
    <NewsProvider>
      <BlueLink />
    </NewsProvider>
  )
}
