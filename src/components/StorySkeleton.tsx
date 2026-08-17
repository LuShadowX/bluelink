/** Placeholder that mirrors the real card geometry, so first paint never jumps. */
export function StorySkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid--4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton skeleton--image" />
          <div className="skeleton skeleton--line" style={{ width: '38%' }} />
          <div className="skeleton skeleton--line" style={{ width: '92%' }} />
          <div className="skeleton skeleton--line" style={{ width: '64%' }} />
        </div>
      ))}
    </div>
  )
}
