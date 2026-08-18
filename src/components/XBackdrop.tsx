/**
 * The moving X field the whole app floats over.
 *
 * Four layers, all decorative and all inert: two tiled X screens drifting at
 * different rates, two slow colour blooms, and one large outlined X turning
 * behind everything. It is mounted once at the app root and never re-renders,
 * because it holds no state — the animation is entirely in CSS, which keeps it
 * off the main thread and out of React's way.
 */
export function XBackdrop() {
  return (
    <div className="xfield" aria-hidden="true">
      <div className="xfield__bloom xfield__bloom--one" />
      <div className="xfield__bloom xfield__bloom--two" />
      <svg className="xfield__mark" viewBox="0 0 100 100" focusable="false">
        <path d="M22 22 L78 78 M78 22 L22 78" />
      </svg>
      <div className="xfield__grid" />
      <div className="xfield__grid xfield__grid--slow" />
    </div>
  )
}
