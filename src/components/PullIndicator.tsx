import { PULL_THRESHOLD } from '../lib/usePullToRefresh'

interface Props {
  distance: number
  armed: boolean
  refreshing: boolean
}

/**
 * Floats over the masthead and descends with the gesture, the way a native
 * refresh control does. Purely presentational — it never intercepts the touch
 * that is driving it.
 */
export function PullIndicator({ distance, armed, refreshing }: Props) {
  if (distance <= 0 && !refreshing) return null

  return (
    <div
      className={`pull${refreshing ? ' pull--busy' : ''}${armed ? ' pull--armed' : ''}`}
      style={
        {
          '--pull': `${distance}px`,
          '--pull-progress': Math.min(1, distance / PULL_THRESHOLD),
        } as React.CSSProperties
      }
      role="status"
      aria-live="polite"
    >
      <span className="pull__dot" aria-hidden="true" />
      <span>
        {refreshing ? 'Checking for news' : armed ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  )
}
