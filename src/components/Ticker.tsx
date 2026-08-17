import { useMemo } from 'react'
import type { Article } from '../types'
import { getTopic } from '../config/topics'

interface Props {
  articles: Article[]
  onOpen: (article: Article) => void
}

/**
 * A wire strip along the top of the page. The run is rendered twice and the
 * track travels exactly -50%, which makes the loop seamless without measuring
 * anything. Duration scales with headline count so the reading speed stays
 * constant regardless of how much news there is.
 */
export function Ticker({ articles, onOpen }: Props) {
  const run = useMemo(() => articles.slice(0, 14), [articles])
  if (run.length === 0) return null

  const seconds = Math.max(48, run.length * 7)

  const items = (keyPrefix: string, hidden: boolean) =>
    run.map((article, i) => {
      const topic = getTopic(article.topic)
      return (
        <a
          key={`${keyPrefix}-${article.id}-${i}`}
          className="ticker__item"
          href={article.url}
          style={{ '--ticker-accent': topic.accent } as React.CSSProperties}
          tabIndex={hidden ? -1 : 0}
          aria-hidden={hidden || undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) return
            event.preventDefault()
            onOpen(article)
          }}
        >
          <span className="ticker__topic">{topic.label}</span>
          <span>{article.title}</span>
        </a>
      )
    })

  return (
    <div className="ticker">
      <span className="ticker__label">Latest</span>
      <div className="ticker__viewport">
        <div
          className="ticker__track"
          style={{ '--ticker-duration': `${seconds}s` } as React.CSSProperties}
        >
          {items('a', false)}
          {items('b', true)}
        </div>
      </div>
    </div>
  )
}
