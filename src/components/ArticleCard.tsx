import type { MouseEvent } from 'react'
import type { Article } from '../types'
import { getTopic } from '../config/topics'
import { accent } from '../lib/style'
import { isBreaking, shortAgo } from '../lib/time'
import { StoryImage } from './StoryImage'
import { BookmarkIcon } from './icons'

export type CardVariant = 'lead' | 'feature' | 'standard' | 'row'

interface Props {
  article: Article
  variant?: CardVariant
  /** Rendered as a display numeral on row cards in a ranked rail. */
  index?: number
  saved: boolean
  now: number
  onOpen: (article: Article) => void
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
    onOpen(article)
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
