import { TOPICS } from '../config/topics'
import type { Route } from '../lib/useRoute'
import { fullDate } from '../lib/time'

interface Props {
  navigate: (route: Route) => void
  generatedAt: string | null
  totalArticles: number
  sourceCount: number
}

export function Footer({ navigate, generatedAt, totalArticles, sourceCount }: Props) {
  return (
    <footer className="footer">
      <div className="shell footer__grid">
        <div>
          <p className="meta" style={{ marginBottom: 'var(--sp-3)' }}>
            Pulse — {totalArticles} stories from {sourceCount} publishers
          </p>
          <p className="footer__note">
            Pulse gathers headlines and excerpts from publishers' own feeds and links
            straight back to them. Full articles are always read on the publisher's site,
            where the reporting belongs.
            {generatedAt && ` This edition was assembled on ${fullDate(generatedAt)}.`}
          </p>
        </div>

        <nav className="footer__links" aria-label="Sections">
          <a
            href="#/"
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
              href={`#/${topic.id}`}
              onClick={(event) => {
                event.preventDefault()
                navigate({ view: 'topic', topic: topic.id })
              }}
            >
              {topic.label}
            </a>
          ))}
          <a
            href="#/saved"
            onClick={(event) => {
              event.preventDefault()
              navigate({ view: 'saved' })
            }}
          >
            Saved
          </a>
        </nav>
      </div>
    </footer>
  )
}
