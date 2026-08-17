import type { CSSProperties } from 'react'
import type { Topic } from '../config/topics'

/**
 * Topic colour is delivered by rebinding two custom properties on a wrapper
 * rather than by a per-topic class. Everything underneath — rules, pills,
 * hover underlines, fallback plates — then picks up the right hue with no
 * knowledge of which section it is in.
 */
export function accent(topic: Topic): CSSProperties {
  return {
    '--accent': topic.accent,
    '--accent-wash': topic.wash,
  } as CSSProperties
}
