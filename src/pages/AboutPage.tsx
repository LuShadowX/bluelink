import { openExternal } from '../lib/feed'
import type { Route } from '../lib/useRoute'
import { ArrowUpRightIcon } from '../components/icons'

interface Props {
  navigate: (route: Route) => void
}

/*
 * Placeholder copy. The portrait and the words below are stand-ins the author
 * intends to replace, so they are kept in one block here rather than threaded
 * through the markup — editing this page should mean editing one array and one
 * paragraph, not hunting through JSX.
 */
const PARAGRAPHS = [
  'I build things that read the internet so I do not have to. BlueLink started as a way to stop opening eleven tabs every morning: one page, eight sections, fifteen stories each, and a short version of every one of them so a headline never has to be taken on trust.',
  'Most of what I make lives somewhere between machine learning and systems — dataloaders that were quietly the bottleneck, profilers that disagreed with me, small tools that turn a long afternoon into a short one. I write the interesting failures down on the blog rather than the tidy successes.',
  'When I am not doing that, I am probably losing an even matchup in Clash Royale and blaming the meta.',
]

const ELSEWHERE = [
  { label: 'GitHub', note: '@LuShadowX', href: 'https://github.com/LuShadowX' },
  { label: 'Portfolio', note: 'lushadowx.github.io/Portfolio', href: 'https://lushadowx.github.io/Portfolio/' },
  { label: 'Blue Link — the blog', note: 'lushadowx.github.io', href: 'https://lushadowx.github.io/' },
]

export function AboutPage({ navigate }: Props) {
  return (
    <div className="page shell">
      <div className="about">
        <figure className="about__portrait">
          {/* Served from public/ rather than imported, so the service worker can
              precache it at a stable URL. */}
          <img src="./portrait.jpg" alt="Shadow_Lu" width={735} height={983} />
        </figure>

        <div className="about__body">
          <p className="about__kicker">
            <span>The author</span>
          </p>
          <h1 className="about__name">Shadow_Lu</h1>
          <p className="about__role">
            Builds BlueLink, Lua and Nova · Machine learning, systems, and the code in
            between
          </p>

          {PARAGRAPHS.map((paragraph) => (
            <p key={paragraph.slice(0, 32)} className="about__text">
              {paragraph}
            </p>
          ))}

          <blockquote className="about__quote">
            Luck isn't a result of pure coincidence. It's an underlying element of the
            field, reached only by those who move by their will.
          </blockquote>

          <div className="about__links">
            {ELSEWHERE.map((link) => (
              <a
                key={link.href}
                className="about__link"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return
                  event.preventDefault()
                  openExternal(link.href)
                }}
              >
                <span className="about__link-label">{link.label}</span>
                <span className="about__link-note">{link.note}</span>
                <ArrowUpRightIcon size={13} />
              </a>
            ))}
          </div>

          <button type="button" className="button button--ghost" onClick={() => navigate({ view: 'home' })}>
            Back to the front page
          </button>
        </div>
      </div>
    </div>
  )
}
