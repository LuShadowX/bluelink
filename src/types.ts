import type { TopicId } from './config/topics'

/** Where a story's artwork came from, which decides how it is credited. */
export type ImageOrigin = 'feed' | 'page' | 'related' | 'video'

export interface Article {
  id: string
  /** Videos and reporting share this shape so the reader, search and saved
   *  shelf work on both without branching. */
  kind: 'article' | 'video'
  topic: TopicId
  title: string
  url: string
  /** The dek: two or three lines under the headline. */
  summary: string
  /** Excerpt paragraphs, shown in the reader before the handoff link. */
  body: string[]
  image: string | null
  imageFrom: ImageOrigin | null
  /** Set only for `related` artwork, which is not the publisher's own. */
  imageCredit: string | null
  imageCreditUrl: string | null
  source: string
  sourceHost: string
  /** 1 = major newsroom or primary source, 2 = specialist, 3 = looser. */
  tier: number
  author: string
  /** ISO 8601. Always present — undated feed items get the run timestamp. */
  publishedAt: string
  /** True when the feed gave no date and we stamped it ourselves. */
  dateEstimated?: boolean

  // --- Videos only ---
  videoId?: string
  channel?: string
  channelUrl?: string
  views?: number | null
  likes?: number | null
}

export interface TopicPayload {
  topic: TopicId
  generatedAt: string
  count: number
  articles: Article[]
  /** Creator uploads for this section. Empty on the YouTube board itself,
   *  where the videos *are* the articles. */
  videos: Article[]
}

export interface TopicSummary {
  topic: TopicId
  count: number
  sources: number
  videoCount: number
  newestAt: string | null
}

export interface IndexPayload {
  generatedAt: string
  refreshIntervalHours: number
  nextRefreshAt: string
  totalArticles: number
  totalVideos: number
  topics: TopicSummary[]
  feedsAttempted: number
  feedsFailed: number
  failures: { feed: string; reason: string }[]
  highlights: Article[]
  /** A short trending rail for the front page. */
  videos: Article[]
}
