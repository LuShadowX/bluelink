import type { MouseEvent } from 'react'
import type { Article } from '../types'
import { getTopic } from '../config/topics'
import { accent } from '../lib/style'
import { isBreaking, shortAgo } from '../lib/time'
import { StoryImage } from './StoryImage'
import { BookmarkIcon, PlayIcon } from './icons'

/** 1_240_000 → "1.2M views". Compact, and never wider than the plate. */
function shortCount(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(views >= 10_000_000 ? 0 : 1)}M`
  if (views >= 1_000) return `${Math.round(views / 1_000)}K`
  return String(views)
}

export type CardVariant = 'lead' | 'feature' | 'standard' | 'row'

interface Props {
  article: Article
  variant?: CardVariant
  /** Rendered as a display numeral on row cards in a ranked rail. */
  index?: number
  saved: boolean
  now: number
  /** The second argument is the artwork the reader panel should grow out of. */
  onOpen: (article: Article, origin?: HTMLElement | null) => void
  onToggleSave: (article: Article) => void
  /** Off on topic pages, where naming the section on every card is noise. */
  showKicker?: boolean
  eagerImage?: boolean
}

const IMAGE_SIZES: Record<CardVariant, string> = {
  lead: '(max-width: 900px) 100vw, 60vw',
  feature: '(max-width: 900px) 50vw, 33vw',
  standard: '(max-width: 560px) 100vw, (max-width: 900px) 50vw, 25vw',
  row: '96px',
}

export function ArticleCard({
  article,
  variant = 'standard',
  index,
  saved,
  now,
  onOpen,
  onToggleSave,
  showKicker = true,
  eagerImage = false,
}: Props) {
  const topic = getTopic(article.topic)
  const isVideo = article.kind === 'video'
  // Kept deliberately narrow. Right after a refresh most of the feed is only
  // hours old, so a generous window flags everything and the badge stops
  // carrying information. Rows are excluded because the ranked rail already
  // says which stories lead.
  const fresh =
    variant !== 'row' && !article.dateEstimated && isBreaking(article.publishedAt, now, 1)

  // The href stays real so middle-click, long-press and "copy link" all behave
  // like a normal link; a plain left click is intercepted for the in-app reader.
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    // Hand over this card's artwork so the panel can expand from it and, on
    // close, settle back onto the exact tile the reader came from.
    onOpen(article, event.currentTarget.querySelector<HTMLElement>('.story-image'))
  }

  return (
    <article className={`card card--${variant}`} style={accent(topic)}>
      <a className="card__link" href={article.url} onClick={open}>
        {variant === 'row' && index !== undefined && (
          <span className="card__index" aria-hidden="true">
            {String(index).padStart(2, '0')}
          </span>
        )}

        <div className="card__media">
          <StoryImage
            src={article.image}
            alt=""
            letter={topic.label.charAt(0)}
            eager={eagerImage}
            sizes={IMAGE_SIZES[variant]}
          />

          {/* A video has to announce itself on the plate. Everything else about
              the card is identical, which is the point — a creator's upload is
              a story in the section, not a separate kind of content. */}
          {isVideo && (
            <>
              <span className="card__play" aria-hidden="true">
                <PlayIcon size={variant === 'lead' || variant === 'feature' ? 20 : 15} />
              </span>
              {variant !== 'row' && (
                <span className="card__vmeta">
                  <span className="card__channel">{article.channel ?? article.source}</span>
                  {article.views ? (
                    <span className="card__views">{shortCount(article.views)} views</span>
                  ) : null}
                </span>
              )}
            </>
          )}
        </div>

        <div className="card__body">
          <div className="card__meta">
            {fresh && <span className="card__new">New</span>}
            {showKicker && <span className="card__kicker">{topic.kicker}</span>}
            {showKicker && <span className="card__meta-sep" aria-hidden="true" />}
            <span className="card__time">{shortAgo(article.publishedAt, now)}</span>
          </div>

          <h3 className="card__title">
            <span className="headline-link">{article.title}</span>
          </h3>

          {article.summary && <p className="card__dek">{article.summary}</p>}

          <div className="card__byline">
            <span className="card__source">{article.source}</span>
            {article.author && variant === 'lead' && (
              <>
                <span className="card__meta-sep" aria-hidden="true" />
                <span>{article.author}</span>
              </>
            )}
          </div>
        </div>
      </a>

      <button
        type="button"
        className={`card__save${saved ? ' card__save--on' : ''}`}
        aria-pressed={saved}
        aria-label={saved ? `Remove “${article.title}” from saved` : `Save “${article.title}”`}
        onClick={() => onToggleSave(article)}
      >
        <BookmarkIcon filled={saved} size={variant === 'row' ? 15 : 16} />
      </button>
    </article>
  )
}
