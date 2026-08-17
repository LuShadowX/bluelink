import { TOPICS, getTopic } from '../config/topics'
import type { Route } from '../lib/useRoute'
import { shortAgo } from '../lib/time'
import { BookmarkIcon, SearchIcon } from './icons'

interface Props {
  route: Route
  navigate: (route: Route) => void
  savedCount: number
  onOpenSearch: () => void
  generatedAt: string | null
  now: number
  isStale: boolean
  checking: boolean
  freshIssueAt: string | null
  onApplyFresh: () => void
  onCheck: () => void
}

export function Masthead({
  route,
  navigate,
  savedCount,
  onOpenSearch,
  generatedAt,
  now,
  isStale,
  checking,
  freshIssueAt,
  onApplyFresh,
  onCheck,
}: Props) {
  const activeTopic = route.view === 'topic' ? getTopic(route.topic) : null

  const freshnessState = freshIssueAt
    ? 'fresh'
    : checking
      ? 'checking'
      : isStale
        ? 'stale'
        : 'current'

  const freshnessLabel = freshIssueAt
    ? 'New stories — load'
    : checking
      ? 'Checking for news'
      : generatedAt
        ? `Updated ${shortAgo(generatedAt, now)}`
        : 'Loading'

  const links = (className: string) => (
    <>
      <a
        className={className}
        href="#/"
        aria-current={route.view === 'home' ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault()
          navigate({ view: 'home' })
        }}
      >
        Today
      </a>
      {TOPICS.map((topic) => (
        <a
          key={topic.id}
          className={className}
          href={`#/${topic.id}`}
          style={{ '--nav-accent': topic.accent } as React.CSSProperties}
          aria-current={route.view === 'topic' && route.topic === topic.id ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault()
            navigate({ view: 'topic', topic: topic.id })
          }}
        >
          {topic.label}
        </a>
      ))}
    </>
  )

  return (
    <header
      className="masthead"
      style={activeTopic ? ({ '--accent': activeTopic.accent } as React.CSSProperties) : undefined}
    >
      <div className="shell masthead__bar">
        <a
          className="wordmark"
          href="#/"
          onClick={(event) => {
            event.preventDefault()
            navigate({ view: 'home' })
          }}
        >
          Pulse
          <span className="wordmark__dot" aria-hidden="true" />
        </a>

        <nav className="nav" aria-label="Sections">
          {links('nav__link')}
        </nav>

        <div className="masthead__tools">
          <button
            type="button"
            className={`freshness freshness--${freshnessState}`}
            onClick={freshIssueAt ? onApplyFresh : onCheck}
            title={
              freshIssueAt
                ? 'A newer edition is ready — load it'
                : 'Check for new stories now'
            }
          >
            <span className="freshness__dot" aria-hidden="true" />
            <span>{freshnessLabel}</span>
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={onOpenSearch}
            aria-label="Search stories"
            title="Search — press / or ⌘K"
          >
            <SearchIcon />
          </button>

          <button
            type="button"
            className={`icon-button${route.view === 'saved' ? ' icon-button--on' : ''}`}
            onClick={() => navigate({ view: 'saved' })}
            aria-label={`Saved stories (${savedCount})`}
            title="Saved stories"
          >
            <BookmarkIcon filled={route.view === 'saved'} />
            {savedCount > 0 && (
              <span className="icon-button__count" aria-hidden="true">
                {savedCount > 99 ? '99+' : savedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <nav className="nav-rail" aria-label="Sections">
        {links('nav__link')}
      </nav>
    </header>
  )
}
