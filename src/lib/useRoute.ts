import { useCallback, useEffect, useState } from 'react'
import { isTopicId, type TopicId } from '../config/topics'

export type Route =
  | { view: 'home' }
  | { view: 'topic'; topic: TopicId }
  | { view: 'saved' }

/**
 * Hash routing rather than a router dependency and history API. It costs
 * nothing, survives a static host with no rewrite rules, and works unchanged
 * from a file:// origin inside a native WebView shell.
 */
function parse(hash: string): Route {
  const slug = hash.replace(/^#\/?/, '').split('?')[0]?.trim().toLowerCase() ?? ''
  if (slug === 'saved') return { view: 'saved' }
  if (isTopicId(slug)) return { view: 'topic', topic: slug }
  return { view: 'home' }
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((to: Route) => {
    const hash =
      to.view === 'home' ? '#/' : to.view === 'saved' ? '#/saved' : `#/${to.topic}`
    if (window.location.hash === hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    window.location.hash = hash
    window.scrollTo({ top: 0 })
  }, [])

  return { route, navigate }
}
