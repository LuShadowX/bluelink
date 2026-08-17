export type TopicId = 'tech' | 'ai' | 'sports' | 'games' | 'lifestyle'

export interface Topic {
  id: TopicId
  /** Nav label. Lowercase on purpose — the header sets its own case. */
  label: string
  /** Shown on the section rule and in the article reader. */
  kicker: string
  /** One line of editorial framing, used on the topic landing strip. */
  blurb: string
  /** Accent hue. Muted on purpose so five of them can share one page. */
  accent: string
  /** Same hue at ~8% for pill and hover washes. */
  wash: string
}

export const TOPICS: readonly Topic[] = [
  {
    id: 'tech',
    label: 'Tech',
    kicker: 'Technology',
    blurb: 'Hardware, software and the companies bending both.',
    accent: '#2049C4',
    wash: 'rgba(32, 73, 196, 0.08)',
  },
  {
    id: 'ai',
    label: 'AI',
    kicker: 'Artificial Intelligence',
    blurb: 'Models, research and what they are actually doing out there.',
    accent: '#6A3AD0',
    wash: 'rgba(106, 58, 208, 0.08)',
  },
  {
    id: 'sports',
    label: 'Sports',
    kicker: 'Sport',
    blurb: 'Results, transfers and the long arc of a season.',
    accent: '#0E7550',
    wash: 'rgba(14, 117, 80, 0.08)',
  },
  {
    id: 'games',
    label: 'Games',
    kicker: 'Games',
    blurb: 'Releases, studios and the craft behind the play.',
    accent: '#BC2367',
    wash: 'rgba(188, 35, 103, 0.08)',
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    kicker: 'Lifestyle',
    blurb: 'Food, health, travel and the texture of a day.',
    accent: '#BB5C26',
    wash: 'rgba(187, 92, 38, 0.08)',
  },
] as const

export const TOPIC_IDS = TOPICS.map((t) => t.id)

const TOPIC_BY_ID = new Map<string, Topic>(TOPICS.map((t) => [t.id, t]))

export function getTopic(id: string): Topic {
  return TOPIC_BY_ID.get(id) ?? TOPICS[0]!
}

export function isTopicId(value: string): value is TopicId {
  return TOPIC_BY_ID.has(value)
}

/** How often the feed pipeline is expected to produce a fresh payload. */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
