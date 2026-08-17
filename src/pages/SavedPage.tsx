import type { Article } from '../types'
import type { Route } from '../lib/useRoute'
import { ArticleCard } from '../components/ArticleCard'

interface Props {
  saved: Article[]
  savedIds: Set<string>
  now: number
  navigate: (route: Route) => void
  onOpen: (article: Article) => void
  onToggleSave: (article: Article) => void
  onClear: () => void
}

export function SavedPage({
  saved,
  savedIds,
  now,
  navigate,
  onOpen,
  onToggleSave,
  onClear,
}: Props) {
  return (
    <div className="page shell">
      <div className="topic-intro">
        <div>
          <h1 className="topic-intro__title">Saved</h1>
          <p className="topic-intro__blurb" style={{ marginTop: 'var(--sp-3)' }}>
            Your reading list, kept on this device.
          </p>
        </div>
        {saved.length > 0 && (
          <button type="button" className="button button--ghost" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>

      {saved.length === 0 ? (
        <div className="state">
          <h2 className="state__title">Nothing saved yet</h2>
          <p className="state__body">
            Tap the bookmark on any story to keep it here. Saved stories stay on this
            device and survive a refresh, so the list is still waiting when the next
            edition lands.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => navigate({ view: 'home' })}
          >
            Back to today
          </button>
        </div>
      ) : (
        <div className="grid grid--4" style={{ paddingTop: 'var(--sp-6)' }}>
          {saved.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              variant="standard"
              saved={savedIds.has(article.id)}
              now={now}
              onOpen={onOpen}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  )
}
