import { useEffect } from 'react'
import type { Article } from '../types'
import type { Topic } from '../config/topics'
import { accent } from '../lib/style'
import { shortAgo } from '../lib/time'
import { ArticleCard } from '../components/ArticleCard'
import { SectionRule } from '../components/SectionRule'
import { StorySkeleton } from '../components/StorySkeleton'

interface Props {
  topic: Topic
  articles: Article[] | undefined
  /** Creator uploads for this section. Empty on the YouTube board itself. */
  videos: Article[] | undefined
  savedIds: Set<string>
  now: number
  onRequest: () => void
  onOpen: (article: Article) => void
  onToggleSave: (article: Article) => void
}

export function TopicPage({
  topic,
  articles,
  videos,
  savedIds,
  now,
  onRequest,
  onOpen,
  onToggleSave,
}: Props) {
  // Sections load on first visit; the provider ignores repeat requests.
  useEffect(() => {
    onRequest()
  }, [onRequest, topic.id])

  const shared = { savedIds, now, onOpen, onToggleSave, showKicker: false }
  const [lead, ...rest] = articles ?? []
  const features = rest.slice(0, 3)
  const latest = rest.slice(3)
  const sources = new Set((articles ?? []).map((a) => a.source)).size
  const uploads = videos ?? []

  return (
    <div className="page shell" style={accent(topic)} key={topic.id}>
      <div className="topic-intro">
        <div>
          <h1 className="topic-intro__title">{topic.kicker}</h1>
          <p className="topic-intro__blurb" style={{ marginTop: 'var(--sp-3)' }}>
            {topic.blurb}
          </p>
        </div>
        {articles && articles.length > 0 && (
          <p className="topic-intro__stat">
            {topic.video
              ? `${articles.length} videos · ${sources} channels`
              : `${articles.length} stories · ${sources} publishers`}
            {lead && (
              <>
                <br />
                Newest {shortAgo(lead.publishedAt, now)}
              </>
            )}
          </p>
        )}
      </div>

      {!articles ? (
        <div style={{ paddingTop: 'var(--sp-6)' }}>
          <StorySkeleton count={8} />
        </div>
      ) : articles.length === 0 ? (
        <div className="state">
          <h2 className="state__title">Nothing in this section yet</h2>
          <p className="state__body">
            The {topic.label} feeds came back empty on the last run. The next refresh is
            within four hours, and this page will fill itself in.
          </p>
        </div>
      ) : (
        <>
          {lead && (
            <div style={{ paddingTop: 'var(--sp-6)' }}>
              <ArticleCard
                article={lead}
                variant="lead"
                saved={savedIds.has(lead.id)}
                now={now}
                onOpen={onOpen}
                onToggleSave={onToggleSave}
                showKicker={false}
                eagerImage
              />
            </div>
          )}

          {features.length > 0 && (
            <>
              <SectionRule label="Next" />
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

          {uploads.length > 0 && (
            <>
              <SectionRule
                label="On YouTube"
                note={`${uploads.length} new from creators`}
              />
              <div className="vrail">
                {uploads.map((video) => (
                  <ArticleCard
                    key={video.id}
                    article={video}
                    variant="standard"
                    saved={savedIds.has(video.id)}
                    {...shared}
                  />
                ))}
              </div>
            </>
          )}

          {latest.length > 0 && (
            <>
              <SectionRule
                label="Everything else"
                note={`${latest.length} ${topic.video ? 'videos' : 'stories'}`}
              />
              <div className="grid grid--4">
                {latest.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    variant="standard"
                    saved={savedIds.has(article.id)}
                    {...shared}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
