import { TOPICS, getTopic } from '../config/topics'
import type { Route } from '../lib/useRoute'
import { shortAgo } from '../lib/time'
import { BookmarkIcon, MoonIcon, SearchIcon, SunIcon } from './icons'
import { YinYangMenu } from './YinYangMenu'
import type { Theme } from '../lib/useTheme'

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
  theme: Theme
  onToggleTheme: () => void
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
  theme,
  onToggleTheme,
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
        className={`${className} ${className}--home`}
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
          aria-label="BlueLink — front page"
          onClick={(event) => {
            event.preventDefault()
            navigate({ view: 'home' })
          }}
        >
          {/* Served from public/ rather than imported, so the service worker can
              precache it at a stable URL and the mark survives offline. */}
          <img className="wordmark__mark" src="./mark.png" alt="" width={18} height={26} />
          <span className="wordmark__name">BlueLink</span>
        </a>

        <nav className="nav" aria-label="Sections">
          {links('nav__link')}
        </nav>

        <div className="masthead__tools">
          <YinYangMenu />

          <button
            type="button"
            className="icon-button icon-button--theme"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to day' : 'Switch to night'}
            title={theme === 'dark' ? 'Day' : 'Night'}
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>

          <button
            type="button"
            className={`freshness freshness--${freshnessState}`}
            onClick={freshIssueAt ? onApplyFresh : onCheck}
            aria-label={freshnessLabel}
            title={
              freshIssueAt
                ? 'A newer edition is ready — load it'
                : 'Check for new stories now'
            }
          >
            <span className="freshness__dot" aria-hidden="true" />
            <span className="freshness__label">{freshnessLabel}</span>
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
