import type { Article } from '../types'
import { TOPICS } from '../config/topics'
import { accent } from '../lib/style'
import type { Route } from '../lib/useRoute'
import { ArticleCard } from '../components/ArticleCard'
import { SectionRule } from '../components/SectionRule'
import { StorySkeleton } from '../components/StorySkeleton'
import { ArrowUpRightIcon } from '../components/icons'

interface Props {
  highlights: Article[]
  articlesByTopic: Partial<Record<string, Article[]>>
  savedIds: Set<string>
  now: number
  loading: boolean
  navigate: (route: Route) => void
  onOpen: (article: Article) => void
  onToggleSave: (article: Article) => void
}

/**
 * The front page is composed rather than listed: one lead, a ranked rail, a
 * three-up feature row, then a band per section. The point is that a reader
 * scanning it once knows what today is about and what the five sections are.
 */
export function FrontPage({
  highlights,
  articlesByTopic,
  savedIds,
  now,
  loading,
  navigate,
  onOpen,
  onToggleSave,
}: Props) {
  const [lead, ...rest] = highlights
  const rail = rest.slice(0, 5)
  const features = rest.slice(5, 8)

  const shared = { savedIds, now, onOpen, onToggleSave }

  if (loading && !lead) {
    return (
      <div className="page shell">
        <SectionRule label="Today" />
        <StorySkeleton count={8} />
      </div>
    )
  }

  return (
    <div className="page shell">
      {/* The masthead is a wordmark, and the lead story is a story, not the name
          of the page — so the document's one h1 lives here, for screen readers
          and search engines. */}
      <h1 className="sr-only">
        Pulse — today's news in technology, artificial intelligence, sport, games and
        lifestyle
      </h1>

      {lead && (
        <div className="front-top">
          <div className="front-top__lead">
            <ArticleCard
              article={lead}
              variant="lead"
              saved={savedIds.has(lead.id)}
              now={now}
              onOpen={onOpen}
              onToggleSave={onToggleSave}
              eagerImage
            />
          </div>

          <div className="front-top__rail">
            <h2 className="rail-heading">Also today</h2>
            {rail.map((article, i) => (
              <ArticleCard
                key={article.id}
                article={article}
                variant="row"
                index={i + 2}
                saved={savedIds.has(article.id)}
                {...shared}
              />
            ))}
          </div>
        </div>
      )}

      {features.length > 0 && (
        <>
          <SectionRule label="Worth your time" />
          <div className="grid grid--3">
            {features.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                variant="feature"
                saved={savedIds.has(article.id)}
                {...shared}
              />
            ))}
          </div>
        </>
      )}

      {TOPICS.map((topic) => {
        const band = (articlesByTopic[topic.id] ?? []).slice(0, 4)
        if (band.length === 0) return null
        return (
          <section key={topic.id} style={accent(topic)}>
            <SectionRule
              label={topic.kicker}
              note={
                <a
                  href={`#/${topic.id}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={(event) => {
                    event.preventDefault()
                    navigate({ view: 'topic', topic: topic.id })
                  }}
                >
                  All {topic.label}
                  <ArrowUpRightIcon size={12} />
                </a>
              }
            />
            <div className="grid grid--4">
              {band.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  variant="standard"
                  saved={savedIds.has(article.id)}
                  showKicker={false}
                  {...shared}
                />
              ))}
            </div>
          </section>
        )
      })}

      {loading && <StorySkeleton count={4} />}
    </div>
  )
}
