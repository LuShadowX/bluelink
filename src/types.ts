import type { TopicId } from './config/topics'

export interface Article {
  id: string
  topic: TopicId
  title: string
  url: string
  summary: string
  image: string | null
  source: string
  sourceHost: string
  author: string
  /** ISO 8601. Always present — undated feed items get the run timestamp. */
  publishedAt: string
  /** True when the feed gave no date and we stamped it ourselves. */
  dateEstimated?: boolean
}

export interface TopicPayload {
  topic: TopicId
  generatedAt: string
  count: number
  articles: Article[]
}

export interface TopicSummary {
  topic: TopicId
  count: number
  sources: number
  newestAt: string | null
}

export interface IndexPayload {
  generatedAt: string
  refreshIntervalHours: number
  nextRefreshAt: string
  totalArticles: number
  topics: TopicSummary[]
  feedsAttempted: number
  feedsFailed: number
  failures: { feed: string; reason: string }[]
  highlights: Article[]
}
