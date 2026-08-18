export type TopicId =
  | 'tech'
  | 'ai'
  | 'sports'
  | 'games'
  | 'arena'
  | 'movies'
  | 'lifestyle'
  | 'youtube'

export interface Topic {
  id: TopicId
  /** Nav label. Lowercase on purpose — the header sets its own case. */
  label: string
  /** Shown on the section rule and in the article reader. */
  kicker: string
  /** One line of editorial framing, used on the topic landing strip. */
  blurb: string
  /** Accent hue. Saturated on purpose — the whole page is white behind it. */
  accent: string
  /** The same hue darkened, for ink shadows and pressed states. */
  deep: string
  /** Same hue at ~10% for pill and hover washes. */
  wash: string
  /** True for the YouTube board, which carries videos rather than reporting. */
  video?: boolean
}

/*
 * Eight saturated hues that have to sit next to each other on one white page, so
 * each is picked to be unmistakable at the size of a nav pill and dark enough to
 * carry white type: blue, violet, green, magenta, gold, teal, orange, red.
 */
export const TOPICS: readonly Topic[] = [
  {
    id: 'tech',
    label: 'Tech',
    kicker: 'Technology',
    blurb: 'Hardware, software and the companies bending both.',
    accent: '#1554ED',
    deep: '#0B2F8A',
    wash: 'rgba(21, 84, 237, 0.10)',
  },
  {
    id: 'ai',
    label: 'AI',
    kicker: 'Artificial Intelligence',
    blurb: 'Models, research and what they are actually doing out there.',
    accent: '#7C3AED',
    deep: '#4A1D9B',
    wash: 'rgba(124, 58, 237, 0.10)',
  },
  {
    id: 'sports',
    label: 'Sports',
    kicker: 'Sport',
    blurb: 'Results, transfers and the long arc of a season.',
    accent: '#00A25B',
    deep: '#065F38',
    wash: 'rgba(0, 162, 91, 0.10)',
  },
  {
    id: 'games',
    label: 'Games',
    kicker: 'Games',
    blurb: 'Releases, studios and the craft behind the play.',
    accent: '#EC1E79',
    deep: '#96114B',
    wash: 'rgba(236, 30, 121, 0.10)',
  },
  {
    id: 'arena',
    label: 'Clash·Brawl',
    kicker: 'Clash Royale & Brawl Stars',
    blurb: 'Balance changes, meta shifts and what the pros are running.',
    accent: '#B45309',
    deep: '#7C3A06',
    wash: 'rgba(180, 83, 9, 0.10)',
  },
  {
    id: 'movies',
    label: 'Movies',
    kicker: 'Film',
    blurb: 'Releases, casting, box office and the people behind the frame.',
    accent: '#0E7490',
    deep: '#08505F',
    wash: 'rgba(14, 116, 144, 0.10)',
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    kicker: 'Lifestyle',
    blurb: 'Food, health, travel and the texture of a day.',
    accent: '#FF6B00',
    deep: '#A33F00',
    wash: 'rgba(255, 107, 0, 0.10)',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    kicker: 'YouTube',
    blurb: 'What the internet is watching right now, and who just posted.',
    accent: '#FF2233',
    deep: '#A00D19',
    wash: 'rgba(255, 34, 51, 0.10)',
    video: true,
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
export const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000
