import { useCallback, useEffect, useRef, useState } from 'react'
import type { Article } from '../types'
import { getTopic } from '../config/topics'
import { accent } from '../lib/style'
import { clockTime, fullDate, shortAgo } from '../lib/time'
import { ArticleCard } from './ArticleCard'
import { SectionRule } from './SectionRule'
import { StoryImage } from './StoryImage'
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BookmarkIcon,
  CheckIcon,
  LinkIcon,
} from './icons'

interface Props {
  article: Article
  related: Article[]
  saved: boolean
  savedIds: Set<string>
  now: number
  onClose: () => void
  onOpen: (article: Article) => void
  onToggleSave: (article: Article) => void
}

export function Reader({
  article,
  related,
  saved,
  savedIds,
  now,
  onClose,
  onOpen,
  onToggleSave,
}: Props) {
  const topic = getTopic(article.topic)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [progress, setProgress] = useState(0)
  const [copied, setCopied] = useState(false)

  // Escape closes, and the page behind must not scroll while this is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Opening a related story reuses this component, so reset the scroll.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 })
    setProgress(0)
    setCopied(false)
  }, [article.id])

  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const travel = el.scrollHeight - el.clientHeight
    setProgress(travel > 40 ? Math.min(1, el.scrollTop / travel) : 0)
  }, [])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(article.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1900)
    } catch {
      // Clipboard is unavailable over insecure origins; the link is on screen.
    }
  }

  return (
    <div
      className="reader"
      role="dialog"
      aria-modal="true"
      aria-label={article.title}
      ref={scrollerRef}
      onScroll={onScroll}
      style={accent(topic)}
    >
      <div className="reader__progress" style={{ '--progress': progress } as React.CSSProperties} />

      <div className="reader__bar">
        <button type="button" className="reader__back" onClick={onClose} ref={closeRef}>
          <ArrowLeftIcon />
          Back to Pulse
        </button>
        <span className="reader__bar-spacer" />
        <button
          type="button"
          className={`icon-button${saved ? ' icon-button--on' : ''}`}
          onClick={() => onToggleSave(article)}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved' : 'Save this story'}
          title={saved ? 'Saved' : 'Save for later'}
        >
          <BookmarkIcon filled={saved} />
        </button>
        <button
          type="button"
          className={`icon-button${copied ? ' icon-button--on' : ''}`}
          onClick={copyLink}
          aria-label="Copy link to this story"
          title={copied ? 'Link copied' : 'Copy link'}
        >
          {copied ? <CheckIcon /> : <LinkIcon />}
        </button>
      </div>

      <article className="reader__article">
        <p className="reader__kicker">{topic.kicker}</p>

        <h1 className="reader__title">{article.title}</h1>

        <div className="reader__meta">
          <span className="reader__source">{article.source}</span>
          {article.author && (
            <>
              <span className="card__meta-sep" aria-hidden="true" />
              <span>{article.author}</span>
            </>
          )}
          <span className="card__meta-sep" aria-hidden="true" />
          <span>
            {article.dateEstimated
              ? shortAgo(article.publishedAt, now)
              : `${fullDate(article.publishedAt)} · ${clockTime(article.publishedAt)}`}
          </span>
        </div>

        {article.image && (
          <figure className="reader__figure">
            <StoryImage src={article.image} alt="" letter={topic.label.charAt(0)} eager />
            <figcaption className="reader__credit" style={{ marginTop: 'var(--sp-2)' }}>
              Image: {article.source}
            </figcaption>
          </figure>
        )}

        {article.summary && (
          <p
            className={`reader__lede${article.summary.length > 150 ? ' reader__lede--drop' : ''}`}
          >
            {article.summary}
          </p>
        )}

        {/*
          Pulse deliberately stops here. The excerpt is what the publisher put
          in their feed; the article itself is theirs to serve, with their
          layout, their advertising and their byline.
        */}
        <div className="reader__handoff">
          <p className="reader__handoff-text">
            This is the excerpt {article.source} publishes in their feed. Continue on
            their site for the full story.
          </p>
          <div className="reader__actions">
            <a
              className="button"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Read at {article.sourceHost || article.source}
              <ArrowUpRightIcon />
            </a>
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <div className="reader__related">
          <SectionRule label={`More in ${topic.label}`} />
          {related.map((item, i) => (
            <ArticleCard
              key={item.id}
              article={item}
              variant="row"
              index={i + 1}
              saved={savedIds.has(item.id)}
              now={now}
              onOpen={onOpen}
              onToggleSave={onToggleSave}
              showKicker={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}
