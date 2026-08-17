import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Article } from '../types'
import { getTopic } from '../config/topics'
import { shortAgo } from '../lib/time'
import { CloseIcon, SearchIcon } from './icons'

interface Props {
  articles: Article[]
  now: number
  onClose: () => void
  onOpen: (article: Article) => void
}

const MAX_RESULTS = 40

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wraps every matched term so the reader can see why a result matched. */
function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const wanted = new Set(terms.map((t) => t.toLowerCase()))
  return text.split(pattern).map((part, i) =>
    wanted.has(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>
  )
}

/**
 * When a story matched on its summary rather than its headline, pull out the
 * sentence fragment that did match. Otherwise the row looks like a false
 * positive and the whole search feels loose.
 */
function matchContext(article: Article, terms: string[]): string | null {
  const title = article.title.toLowerCase()
  if (terms.some((term) => title.includes(term))) return null

  const summary = article.summary
  const haystack = summary.toLowerCase()
  const at = terms.map((term) => haystack.indexOf(term)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (at === undefined) return null

  const start = Math.max(0, at - 48)
  const end = Math.min(summary.length, at + 84)
  return `${start > 0 ? '…' : ''}${summary.slice(start, end).trim()}${end < summary.length ? '…' : ''}`
}

export function SearchOverlay({ articles, now, onClose, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const terms = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1),
    [query]
  )

  const results = useMemo(() => {
    if (terms.length === 0) return []
    const scored: { article: Article; score: number }[] = []

    for (const article of articles) {
      const title = article.title.toLowerCase()
      const summary = article.summary.toLowerCase()
      const source = article.source.toLowerCase()

      let score = 0
      let matchedAll = true
      for (const term of terms) {
        // A word-boundary hit in the headline is what people usually mean.
        if (new RegExp(`\\b${escapeRegExp(term)}`).test(title)) score += 12
        else if (title.includes(term)) score += 7
        else if (summary.includes(term)) score += 3
        else if (source.includes(term)) score += 2
        else matchedAll = false
      }
      if (!matchedAll || score === 0) continue

      // Recency is a mild tiebreak, never the main signal.
      const ageDays = (now - Date.parse(article.publishedAt)) / 86_400_000
      scored.push({ article, score: score - Math.min(6, Math.max(0, ageDays) * 0.5) })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.article)
  }, [articles, terms, now])

  useEffect(() => {
    inputRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => setCursor(0), [query])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results.length])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (c + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (c - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const picked = results[cursor]
      if (picked) onOpen(picked)
    }
  }

  return (
    <div
      className="search"
      role="dialog"
      aria-modal="true"
      aria-label="Search stories"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        // Click the backdrop, not the panel, to dismiss.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="search__panel">
        <div className="search__field">
          <SearchIcon size={20} />
          <input
            ref={inputRef}
            className="search__input"
            type="search"
            value={query}
            placeholder="Search every story"
            aria-label="Search stories"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close search"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="search__results" ref={listRef}>
          {terms.length === 0 ? (
            <p className="search__empty">
              Searching {articles.length} stories across technology, AI, sport, games and
              lifestyle.
            </p>
          ) : results.length === 0 ? (
            <p className="search__empty">
              Nothing matches “{query.trim()}”. Try a shorter phrase, or a publisher name.
            </p>
          ) : (
            results.map((article, i) => {
              const topic = getTopic(article.topic)
              return (
                <button
                  type="button"
                  key={article.id}
                  data-row={i}
                  className="search__result"
                  aria-selected={i === cursor}
                  style={
                    {
                      '--accent': topic.accent,
                      '--accent-wash': topic.wash,
                    } as React.CSSProperties
                  }
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => onOpen(article)}
                >
                  <span className="search__result-topic">{topic.label}</span>
                  <span className="search__result-title">
                    {highlight(article.title, terms)}
                    {(() => {
                      const context = matchContext(article, terms)
                      return context ? (
                        <span className="search__result-context">
                          {highlight(context, terms)}
                        </span>
                      ) : null
                    })()}
                  </span>
                  <span className="search__result-time">
                    {shortAgo(article.publishedAt, now)}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="search__footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> Move
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>esc</kbd> Close
          </span>
          {results.length > 0 && (
            <span style={{ marginLeft: 'auto' }}>
              {results.length}
              {results.length === MAX_RESULTS ? '+' : ''} result
              {results.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
