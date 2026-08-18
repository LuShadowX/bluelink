import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'bluelink:theme'

/**
 * The first paint must already be the right theme, so the attribute is set
 * before React mounts — see the inline script in index.html. This reads back
 * what that script decided rather than deciding again, which is what stops the
 * page from flashing white on a dark-mode launch.
 */
function currentTheme(): Theme {
  const attribute = document.documentElement.dataset.theme
  if (attribute === 'dark' || attribute === 'light') return attribute
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Keeps the browser chrome in step: the status bar has to change with the page. */
const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#0a0b10' }

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Private mode, or storage is full. The theme still applies to this visit.
    }
  }, [theme])

  /*
   * Follow the system while the reader has not expressed a preference. Once they
   * have, their choice wins — overriding it because they changed their laptop's
   * appearance would be the app arguing with them.
   */
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      stored = null
    }
    if (stored === 'dark' || stored === 'light') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), [])

  return { theme, toggle }
}
