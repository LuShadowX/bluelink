/**
 * The moving X field the whole app floats over.
 *
 * Three layers, all decorative and all inert: two tiled fields of outlined X
 * marks drifting diagonally at different rates, and one enormous mark turning
 * behind them. Mounted once at the app root and never re-rendered, because it
 * holds no state — the motion is entirely in CSS, which keeps it off the main
 * thread and out of React's way.
 *
 * The big mark is drawn as two crossing bands traced with a hairline, not as a
 * thick stroked X: an outline is what makes it read as draughtsmanship rather
 * than as a giant cross sitting behind the page.
 */
export function XBackdrop() {
  return (
    <div className="xfield" aria-hidden="true">
      <svg className="xfield__mark" viewBox="0 0 100 100" focusable="false">
        <path d="M16 10 L84 88 L78 94 L10 16 Z" />
        <path d="M84 10 L16 88 L10 82 L78 6 Z" />
      </svg>
      <div className="xfield__grid xfield__grid--ink" />
      <div className="xfield__grid xfield__grid--red" />
    </div>
  )
}
