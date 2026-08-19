import { useCallback, useEffect, useRef, useState } from 'react'
import { openExternal } from '../lib/feed'
import type { Route } from '../lib/useRoute'
import { ArrowUpRightIcon } from './icons'

interface Link {
  label: string
  note: string
  /** An external destination. Omitted for the in-app page. */
  href?: string
  /** An in-app route, which opens here rather than in a new tab. */
  to?: Route
}

/**
 * Where the yin-yang menu goes. Deliberately a flat list of five: the author,
 * the two sites and the two bots. Anything longer stops being a signature and
 * starts being navigation.
 */
const LINKS: readonly Link[] = [
  {
    label: 'About the author',
    note: "Who's behind BlueLink",
    to: { view: 'about' },
  },
  {
    label: 'Portfolio',
    note: 'lushadowx.github.io/Portfolio',
    href: 'https://lushadowx.github.io/Portfolio/',
  },
  {
    label: 'Blue Link — the blog',
    note: 'Machine learning, systems and the code between',
    href: 'https://lushadowx.github.io/',
  },
  {
    label: 'Lua — anime chatbot',
    // The live interface, not the repository. Both bots are on Render's free
    // tier, which sleeps: the first request can take most of a minute to wake,
    // and saying so beats leaving someone staring at a blank tab.
    note: 'Talk to Lua · takes a moment to wake',
    href: 'https://lua-anime-chatbot.onrender.com',
  },
  {
    label: 'Nova — novel bot',
    note: 'Talk to Nova · takes a moment to wake',
    href: 'https://nova-novel-bot.onrender.com',
  },
]

/**
 * The yin-yang, drawn rather than imported.
 *
 * One path is the whole dark half — the big arc down one side, then the two
 * small arcs that make the S — and the light half is simply the circle showing
 * through behind it. Building it that way means a single fill swap inverts the
 * entire symbol, which is exactly what the open state does: the button turns
 * half a revolution and the two halves trade places.
 */
function YinYang() {
  return (
    <svg className="yinyang" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="yinyang__field" cx="50" cy="50" r="47" />
      <path className="yinyang__half" d="M50 3 A47 47 0 0 1 50 97 A23.5 23.5 0 0 1 50 50 A23.5 23.5 0 0 0 50 3 Z" />
      {/* Named by position, not by colour: which one is dark depends on the
          open state, and the eyes have to swap with the halves. */}
      <circle className="yinyang__eye yinyang__eye--top" cx="50" cy="26.5" r="7.6" />
      <circle className="yinyang__eye yinyang__eye--bottom" cx="50" cy="73.5" r="7.6" />
      <circle className="yinyang__ring" cx="50" cy="50" r="47" />
    </svg>
  )
}

interface MenuProps {
  navigate: (route: Route) => void
}

export function YinYangMenu({ navigate }: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    buttonRef.current?.focus({ preventScroll: true })
  }, [])

  // Escape closes it, and so does anything happening outside it — the two things
  // every reader already expects a menu to do.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, close])

  return (
    <div className="yy" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`yy__button${open ? ' yy__button--open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? 'Close the menu' : 'Open the menu'}
        title="Links"
        onClick={() => setOpen((prev) => !prev)}
      >
        <YinYang />
      </button>

      {open && (
        <div className="yy__panel" role="menu" aria-label="Links">
          <p className="yy__title">Elsewhere</p>
          {LINKS.map((link) => (
            <a
              key={link.label}
              className="yy__item"
              role="menuitem"
              href={link.href ?? '#/about'}
              // Only the outward links get a new tab; the in-app page must not.
              target={link.href ? '_blank' : undefined}
              rel={link.href ? 'noopener noreferrer' : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return
                event.preventDefault()
                if (link.to) navigate(link.to)
                // Inside a native shell target="_blank" navigates the app's own
                // WebView and leaves no way back.
                else if (link.href) openExternal(link.href)
                close()
              }}
            >
              <span className="yy__item-text">
                <span className="yy__item-label">{link.label}</span>
                <span className="yy__item-note">{link.note}</span>
              </span>
              <ArrowUpRightIcon size={13} />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
