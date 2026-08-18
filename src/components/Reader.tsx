import { useCallback, useEffect, useRef, useState } from 'react'
import type { Article } from '../types'
import { getTopic } from '../config/topics'
import { openExternal } from '../lib/feed'
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
  CloseIcon,
  LinkIcon,
  PlayIcon,
} from './icons'

interface Props {
  article: Article
  related: Article[]
  saved: boolean
  savedIds: Set<string>
  now: number
  /** The artwork that was tapped. The panel grows from it and returns to it. */
  origin: HTMLElement | null
  onClose: () => void
  onOpen: (article: Article, origin?: HTMLElement | null) => void
  onToggleSave: (article: Article) => void
}

const DURATION = 420
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The transform that would place `panel` exactly over `origin`.
 *
 * Animating this rather than animating width and height keeps the whole
 * movement on the compositor, so a panel full of text and images still travels
 * at 60fps. A single uniform scale is used even though the two rectangles have
 * different proportions — matching both axes distorts the text mid-flight,
 * which is far more noticeable than the slight crop this leaves.
 */
function transformOnto(panel: DOMRect, origin: DOMRect): string {
  const scale = Math.max(0.12, Math.min(1, origin.width / panel.width))
  const dx = origin.left + origin.width / 2 - (panel.left + panel.width / 2)
  const dy = origin.top + origin.height / 2 - (panel.top + panel.height / 2)
  return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${scale.toFixed(4)})`
}

/** True when the element is still somewhere the reader could fly back to. */
function isOnScreen(rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  )
}

export function Reader({
  article,
  related,
  saved,
  savedIds,
  now,
  origin,
  onClose,
  onOpen,
  onToggleSave,
}: Props) {
  const topic = getTopic(article.topic)
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [copied, setCopied] = useState(false)
  /** Nothing is loaded from YouTube until this is true. */
  const [playing, setPlaying] = useState(false)
  const closingRef = useRef(false)

  /** Animate back to the card, then let the parent unmount us. */
  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true

    const panel = panelRef.current
    const backdrop = backdropRef.current
    if (!panel || reducedMotion()) {
      onClose()
      return
    }

    const rect = panel.getBoundingClientRect()
    const originRect = origin?.getBoundingClientRect()
    // If the card has been scrolled away there is nowhere honest to fly back
    // to, so the panel simply settles instead of shooting off-screen.
    const to =
      originRect && isOnScreen(originRect)
        ? transformOnto(rect, originRect)
        : 'translateY(24px) scale(0.97)'

    backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: DURATION * 0.8,
      easing: 'ease-out',
      fill: 'both',
    })
    const flight = panel.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: to, opacity: 0 },
      ],
      { duration: DURATION, easing: EASE, fill: 'both' }
    )
    flight.onfinish = () => onClose()
    // A dropped animation frame must never strand the reader open.
    window.setTimeout(() => onClose(), DURATION + 120)
  }, [onClose, origin])

  // Grow out of the card that was tapped.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const originRect = origin?.getBoundingClientRect()
    if (!originRect || !isOnScreen(originRect) || reducedMotion()) {
      panel.animate(
        [
          { transform: 'translateY(16px)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: reducedMotion() ? 1 : DURATION * 0.7, easing: EASE, fill: 'both' }
      )
      return
    }

    panel.animate(
      [
        { transform: transformOnto(panel.getBoundingClientRect(), originRect), opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: DURATION, easing: EASE, fill: 'both' }
    )
    // Only run on first mount; opening a related story is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes, and the page behind must not scroll while this is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    // Focus the dialog itself, not the back button. Moving focus is what tells a
    // screen reader the panel has opened, but focusing a control paints a focus
    // ring on it, which on a touch device looks like a rendering fault.
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [requestClose])

  // Opening a related story reuses this component, so reset the scroll.
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
    setProgress(0)
    setCopied(false)
    setPlaying(false)
  }, [article.id])

  const onScroll = useCallback(() => {
    const el = panelRef.current
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
    <div className="reader-layer" style={accent(topic)}>
      {/*
        The page stays visible and dimmed behind the panel rather than being
        replaced. Keeping the front page in view is what makes this read as
        opening a story rather than navigating away from one.
      */}
      <div
        className="reader-backdrop"
        ref={backdropRef}
        onClick={requestClose}
        aria-hidden="true"
      />

      <div
        className="reader"
        role="dialog"
        aria-modal="true"
        aria-label={article.title}
        ref={panelRef}
        tabIndex={-1}
        onScroll={onScroll}
      >
        <div
          className="reader__progress"
          style={{ '--progress': progress } as React.CSSProperties}
        />

        <div className="reader__bar">
          <button type="button" className="reader__back" onClick={requestClose}>
            <ArrowLeftIcon />
            Back
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
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            aria-label="Close"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <article className="reader__article">
          <p className="reader__kicker">
            <span>{topic.kicker}</span>
          </p>

          <h1 className="reader__title">{article.title}</h1>

          <div className="reader__meta">
            <span className="reader__source">{article.source}</span>
            {article.tier === 1 && article.kind === 'article' && (
              <span className="reader__trust" title="A major newsroom or the primary source">
                Verified desk
              </span>
            )}
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

          {/*
            A video plays here rather than throwing the reader out to YouTube —
            but the iframe is only created once the plate is tapped, so opening a
            story never quietly loads a third-party player.
          */}
          {article.kind === 'video' && article.videoId ? (
            <div className="reader__embed">
              {playing ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${article.videoId}?autoplay=1&rel=0`}
                  title={article.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <>
                  <StoryImage
                    src={article.image}
                    alt=""
                    letter={topic.label.charAt(0)}
                    eager
                  />
                  <button
                    type="button"
                    className="reader__embed-play"
                    onClick={() => setPlaying(true)}
                    aria-label={`Play “${article.title}”`}
                  >
                    <span aria-hidden="true">
                      <PlayIcon size={26} />
                    </span>
                  </button>
                </>
              )}
            </div>
          ) : (
            article.image && (
              <figure className="reader__figure">
                <StoryImage src={article.image} alt="" letter={topic.label.charAt(0)} eager />
                <figcaption className="reader__credit" style={{ marginTop: 'var(--sp-2)' }}>
                  {/*
                    Artwork the pipeline had to go and find is credited as
                    exactly that. It is a photograph of the same subject, not the
                    publisher's own picture of the event, and saying so is the
                    difference between an illustration and a small lie.
                  */}
                  {article.imageCredit ? (
                    <>
                      <span>{article.imageCredit}</span>
                      {article.imageCreditUrl && (
                        <a
                          href={article.imageCreditUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => {
                            event.preventDefault()
                            openExternal(article.imageCreditUrl!)
                          }}
                        >
                          Source
                        </a>
                      )}
                    </>
                  ) : (
                    <span>Image: {article.source}</span>
                  )}
                </figcaption>
              </figure>
            )
          )}

          {/*
            The excerpt is the point of this screen. Opening a story should give
            you something to actually read — enough to know what happened and
            whether you care — and only then offer the link. A reader that leads
            with a button is a redirect with extra steps.
          */}
          {article.summary ? (
            <p
              className={`reader__lede${article.summary.length > 150 ? ' reader__lede--drop' : ''}`}
            >
              {article.summary}
            </p>
          ) : (
            <p className="reader__lede reader__lede--bare">
              {article.source} published this one without a summary, so there is nothing
              to preview here.
            </p>
          )}

          {/*
            The paragraphs the pipeline lifted out of the article itself. This is
            what makes opening a story worth the tap: enough of the reporting to
            know what happened, and to decide whether the rest is worth a trip to
            somebody else's site.
          */}
          {article.body.length > 0 && (
            <div className="reader__body">
              {article.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </div>
          )}

          {/*
            BlueLink deliberately stops at the excerpt. The rest of the article
            is the publisher's to serve, with their layout, their advertising
            and their byline.
          */}
          <div className="reader__handoff">
            <p className="reader__handoff-text">
              {article.kind === 'video'
                ? `${article.channel ?? article.source} published this on YouTube.`
                : article.body.length
                  ? `That is the opening of the piece. ${article.source} has the rest.`
                  : article.summary
                    ? `Want the rest? ${article.source} has the full story.`
                    : `${article.source} has the full story on their site.`}
            </p>
            <div className="reader__actions">
              <a
                className="button"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return
                  // Inside a native shell target="_blank" would navigate the
                  // app's own WebView and leave no way back.
                  event.preventDefault()
                  openExternal(article.url)
                }}
              >
                {article.kind === 'video'
                  ? 'Watch on YouTube'
                  : `Continue at ${article.sourceHost || article.source}`}
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
    </div>
  )
}
